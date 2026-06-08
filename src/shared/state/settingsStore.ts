/** Cross-cutting runtime settings + the adapter I/O log. See docs/features/settings.md. */
import { create } from 'zustand';

export type AdapterSource = 'mock' | 'ble';
export type ThemePref = 'system' | 'light' | 'dark';

export interface LogEntry {
  dir: 'tx' | 'rx';
  text: string;
  ts: number;
}

interface SettingsState {
  adapterSource: AdapterSource;
  simulatedVehicleId: string;
  injectedDtcs: string[];
  units: 'metric';
  pollIntervalMs: number;
  theme: ThemePref;
  log: LogEntry[];
  setAdapterSource: (s: AdapterSource) => void;
  setSimulatedVehicle: (id: string) => void;
  setInjectedDtcs: (codes: string[]) => void;
  setPollInterval: (ms: number) => void;
  setTheme: (t: ThemePref) => void;
  appendLog: (e: LogEntry) => void;
  clearLog: () => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  adapterSource: 'mock',
  simulatedVehicleId: 'golf-plus-2009-20tdi',
  injectedDtcs: ['P0299'],
  units: 'metric',
  pollIntervalMs: 1000,
  theme: 'dark',
  log: [],
  setAdapterSource: (adapterSource) => set({ adapterSource }),
  setSimulatedVehicle: (simulatedVehicleId) => set({ simulatedVehicleId }),
  setInjectedDtcs: (injectedDtcs) => set({ injectedDtcs }),
  setPollInterval: (pollIntervalMs) => set({ pollIntervalMs }),
  setTheme: (theme) => set({ theme }),
  appendLog: (e) => set((s) => ({ log: [...s.log.slice(-300), e] })),
  clearLog: () => set({ log: [] }),
}));
