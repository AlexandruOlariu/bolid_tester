/** Notification preferences (per-category toggles, mute, quiet hours) and maintenance reminders.
 *  Persisted as `bolid.notifications` (before plan 18 this store was in memory only, so every
 *  launch forgot the user's choices); the OS permission state is live and is never written.
 *  See docs/features/notifications.md. */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { fileStateStorage } from '@/shared/state/persistStorage';
import type { NotifPrefs, MaintenanceReminder, NotifCategory } from '@/shared/obd-core';

export const NOTIFICATIONS_VERSION = 1;

export const DEFAULT_NOTIF_PREFS: NotifPrefs = {
  categories: { alert: true, connection: true, diagnostic: true, trip: true, maintenance: true },
};

interface NotificationsState {
  prefs: NotifPrefs;
  reminders: MaintenanceReminder[];
  permission: 'unknown' | 'granted' | 'denied';
  setPermission: (p: NotificationsState['permission']) => void;
  toggleCategory: (c: NotifCategory) => void;
  setMuted: (m: boolean) => void;
  addReminder: (r: MaintenanceReminder) => void;
  removeReminder: (id: string) => void;
}

/** Persisted prefs over the defaults: every category the app knows today keeps a boolean even when
 *  the file predates it, and a non-boolean value falls back to the default. Exported for tests. */
export function mergeNotifPrefs(
  persisted: unknown,
  base: NotifPrefs = DEFAULT_NOTIF_PREFS,
): NotifPrefs {
  const p = (persisted ?? {}) as Partial<NotifPrefs>;
  const categories = { ...base.categories };
  const stored = (p.categories ?? {}) as Partial<Record<NotifCategory, unknown>>;
  for (const c of Object.keys(categories) as NotifCategory[]) {
    if (typeof stored[c] === 'boolean') categories[c] = stored[c] as boolean;
  }
  const out: NotifPrefs = { ...base, categories };
  if (typeof p.muted === 'boolean') out.muted = p.muted;
  if (
    p.quietHours &&
    typeof p.quietHours.startMin === 'number' &&
    typeof p.quietHours.endMin === 'number'
  ) {
    out.quietHours = { startMin: p.quietHours.startMin, endMin: p.quietHours.endMin };
  }
  return out;
}

export const useNotificationsStore = create<NotificationsState>()(
  persist(
    (set) => ({
      prefs: DEFAULT_NOTIF_PREFS,
      reminders: [],
      permission: 'unknown',
      setPermission: (permission) => set({ permission }),
      toggleCategory: (c) =>
        set((s) => ({
          prefs: { ...s.prefs, categories: { ...s.prefs.categories, [c]: !s.prefs.categories[c] } },
        })),
      setMuted: (muted) => set((s) => ({ prefs: { ...s.prefs, muted } })),
      addReminder: (r) => set((s) => ({ reminders: [...s.reminders, r] })),
      removeReminder: (id) => set((s) => ({ reminders: s.reminders.filter((r) => r.id !== id) })),
    }),
    {
      name: 'bolid.notifications',
      version: NOTIFICATIONS_VERSION,
      storage: createJSONStorage(() => fileStateStorage),
      partialize: (s) => ({ prefs: s.prefs, reminders: s.reminders }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as { prefs?: unknown; reminders?: unknown };
        return {
          ...current,
          prefs: p.prefs === undefined ? current.prefs : mergeNotifPrefs(p.prefs),
          reminders: Array.isArray(p.reminders)
            ? (p.reminders as MaintenanceReminder[]).filter(
                (r) => !!r && typeof r.id === 'string' && typeof r.title === 'string',
              )
            : current.reminders,
        };
      },
    },
  ),
);
