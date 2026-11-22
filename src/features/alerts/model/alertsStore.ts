/** Threshold alert rules and the alerts active right now. The **rules** persist (`bolid.alerts`, so
 *  a custom or disabled rule survives a restart — before plan 18 this store was in memory only and
 *  every launch re-seeded the defaults); the active alerts are live state and are never written.
 *
 *  Starter rules are offered **once per rule id** (`seededIds`, persisted with the rules): each
 *  connect adds the defaults the car supports that were never offered before, so a later car that
 *  reports 0142 still gets the low-voltage rule, and a starter rule the user deleted (or an emptied
 *  list) is never brought back. See docs/features/alerts.md. */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { fileStateStorage } from '@/shared/state/persistStorage';
import { defaultRules, type AlertRule, type ActiveAlert } from '@/shared/obd-core';

export const ALERTS_VERSION = 1;

/** Every starter rule id (`defaultRules` of all the PIDs it knows). */
const DEFAULT_RULE_IDS = defaultRules(['0105', '0142', '010C']).map((r) => r.id);

interface AlertsState {
  rules: AlertRule[];
  /** Starter-rule ids already offered (added once; never re-added after a delete). */
  seededIds: string[];
  active: ActiveAlert[];
  setRules: (r: AlertRule[]) => void;
  /** Add the starter rules for `supportedPids` that were never offered. No write when none is new. */
  seedDefaults: (supportedPids: string[]) => void;
  addRule: (r: AlertRule) => void;
  removeRule: (id: string) => void;
  toggleRule: (id: string) => void;
  setActive: (a: ActiveAlert[]) => void;
}

function isRule(x: unknown): x is AlertRule {
  const r = x as Partial<AlertRule> | null;
  return (
    !!r &&
    typeof r.id === 'string' &&
    typeof r.pid === 'string' &&
    typeof r.op === 'string' &&
    typeof r.value === 'number'
  );
}

/** The persisted rules, keeping only well-formed ones (a hand-edited backup cannot crash the
 *  evaluator). Exported for tests. */
export function sanitizeAlertRules(persisted: unknown): AlertRule[] {
  const p = (persisted ?? {}) as { rules?: unknown };
  return Array.isArray(p.rules) ? p.rules.filter(isRule) : [];
}

/** The persisted `seededIds`. A file without them (written before they existed) that holds rules
 *  counts every starter rule as offered — the old "rules exist, seed nothing" behaviour. */
export function sanitizeSeededIds(persisted: unknown, rules: AlertRule[]): string[] {
  const p = (persisted ?? {}) as { seededIds?: unknown };
  if (Array.isArray(p.seededIds)) return p.seededIds.filter((x) => typeof x === 'string');
  return rules.length > 0 ? [...DEFAULT_RULE_IDS] : [];
}

export const useAlertsStore = create<AlertsState>()(
  persist(
    (set, get) => ({
      rules: [],
      seededIds: [],
      active: [],
      setRules: (rules) => set({ rules }),
      seedDefaults: (supportedPids) => {
        const { rules, seededIds } = get();
        const fresh = defaultRules(supportedPids).filter(
          (r) => !seededIds.includes(r.id) && !rules.some((x) => x.id === r.id),
        );
        if (fresh.length === 0) return;
        set({
          rules: [...rules, ...fresh],
          seededIds: [...seededIds, ...fresh.map((r) => r.id)],
        });
      },
      addRule: (r) => set((s) => ({ rules: [...s.rules, r] })),
      removeRule: (id) => set((s) => ({ rules: s.rules.filter((r) => r.id !== id) })),
      toggleRule: (id) =>
        set((s) => ({
          rules: s.rules.map((r) => (r.id === id ? { ...r, enabled: r.enabled === false } : r)),
        })),
      setActive: (active) => set({ active }),
    }),
    {
      name: 'bolid.alerts',
      version: ALERTS_VERSION,
      storage: createJSONStorage(() => fileStateStorage),
      partialize: (s) => ({ rules: s.rules, seededIds: s.seededIds }),
      // The stored rules win — an emptied list included. With no file (first launch) or an
      // unreadable one, keep memory. A starter rule EngineHost seeded in memory during the start-up
      // hydration window survives only when the file never offered it (so a deleted one stays gone).
      merge: (persisted, current) => {
        if (!persisted || typeof persisted !== 'object') return current;
        const stored = sanitizeAlertRules(persisted);
        const offered = sanitizeSeededIds(persisted, stored);
        const late = current.rules.filter(
          (r) =>
            current.seededIds.includes(r.id) &&
            !offered.includes(r.id) &&
            !stored.some((x) => x.id === r.id),
        );
        return {
          ...current,
          rules: [...stored, ...late],
          seededIds: [...offered, ...current.seededIds.filter((id) => !offered.includes(id))],
        };
      },
    },
  ),
);
