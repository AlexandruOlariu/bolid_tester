import { create } from 'zustand';
import type { NotifPrefs, MaintenanceReminder, NotifCategory } from '@/shared/obd-core';

const defaultPrefs: NotifPrefs = {
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

export const useNotificationsStore = create<NotificationsState>((set) => ({
  prefs: defaultPrefs,
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
}));
