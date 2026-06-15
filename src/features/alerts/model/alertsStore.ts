import { create } from 'zustand';
import type { AlertRule, ActiveAlert } from '@/shared/obd-core';

interface AlertsState {
  rules: AlertRule[];
  active: ActiveAlert[];
  setRules: (r: AlertRule[]) => void;
  addRule: (r: AlertRule) => void;
  removeRule: (id: string) => void;
  toggleRule: (id: string) => void;
  setActive: (a: ActiveAlert[]) => void;
}

export const useAlertsStore = create<AlertsState>((set) => ({
  rules: [],
  active: [],
  setRules: (rules) => set({ rules }),
  addRule: (r) => set((s) => ({ rules: [...s.rules, r] })),
  removeRule: (id) => set((s) => ({ rules: s.rules.filter((r) => r.id !== id) })),
  toggleRule: (id) =>
    set((s) => ({
      rules: s.rules.map((r) => (r.id === id ? { ...r, enabled: r.enabled === false } : r)),
    })),
  setActive: (active) => set({ active }),
}));
