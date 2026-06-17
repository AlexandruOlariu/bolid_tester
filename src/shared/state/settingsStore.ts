/** Cross-cutting runtime settings + the adapter I/O log. Persisted across launches (except the live
 *  log) via expo-file-system — see persistStorage.ts and docs/features/settings.md. */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { fileStateStorage } from './persistStorage';

export type AdapterSource = 'mock' | 'ble';
export type ThemePref = 'system' | 'light' | 'dark';

export interface LogEntry {
  dir: 'tx' | 'rx';
  text: string;
  ts: number;
}

/** Structured-output mode for the AI request (see obd-core `buildChatRequestBody`). */
export type AiJsonMode = 'schema' | 'object' | 'off';

/** Connection + behaviour settings for the AI auto-diagnosis feature (an OpenAI-compatible server
 *  such as LM Studio). Mirrors `AiClientConfig` in obd-core, plus an `enabled` toggle. */
export interface AiSettings {
  enabled: boolean;
  /** Server base URL, with or without a trailing `/v1` (normalised when used). */
  baseUrl: string;
  model: string;
  /** Optional bearer token; most local servers ignore it. */
  apiKey: string;
  timeoutMs: number;
  /** Structured-output mode: 'schema' (json_schema), 'object' (json_object), or 'off' (plain text). */
  jsonMode: AiJsonMode;
}

interface SettingsState {
  adapterSource: AdapterSource;
  simulatedVehicleId: string;
  injectedDtcs: string[];
  units: 'metric';
  pollIntervalMs: number;
  theme: ThemePref;
  ai: AiSettings;
  log: LogEntry[];
  setAdapterSource: (s: AdapterSource) => void;
  setSimulatedVehicle: (id: string) => void;
  setInjectedDtcs: (codes: string[]) => void;
  setPollInterval: (ms: number) => void;
  setTheme: (t: ThemePref) => void;
  setAi: (patch: Partial<AiSettings>) => void;
  appendLog: (e: LogEntry) => void;
  clearLog: () => void;
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  enabled: true,
  baseUrl: '',
  model: '',
  apiKey: '',
  timeoutMs: 30000,
  jsonMode: 'schema',
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      adapterSource: 'mock',
      simulatedVehicleId: 'golf-plus-2009-20tdi',
      injectedDtcs: ['P0299'],
      units: 'metric',
      pollIntervalMs: 1000,
      theme: 'dark',
      ai: DEFAULT_AI_SETTINGS,
      log: [],
      setAdapterSource: (adapterSource) => set({ adapterSource }),
      setSimulatedVehicle: (simulatedVehicleId) => set({ simulatedVehicleId }),
      setInjectedDtcs: (injectedDtcs) => set({ injectedDtcs }),
      setPollInterval: (pollIntervalMs) => set({ pollIntervalMs }),
      setTheme: (theme) => set({ theme }),
      setAi: (patch) => set((s) => ({ ai: { ...s.ai, ...patch } })),
      appendLog: (e) => set((s) => ({ log: [...s.log.slice(-300), e] })),
      clearLog: () => set({ log: [] }),
    }),
    {
      name: 'bolid.settings',
      version: 1,
      storage: createJSONStorage(() => fileStateStorage),
      // Persist user config only — never the live adapter I/O log.
      partialize: (s) => ({
        adapterSource: s.adapterSource,
        simulatedVehicleId: s.simulatedVehicleId,
        injectedDtcs: s.injectedDtcs,
        pollIntervalMs: s.pollIntervalMs,
        theme: s.theme,
        ai: s.ai,
      }),
      // Deep-merge `ai` so new default fields survive an older persisted blob.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<SettingsState>;
        return { ...current, ...p, ai: { ...current.ai, ...(p.ai ?? {}) } };
      },
    },
  ),
);
