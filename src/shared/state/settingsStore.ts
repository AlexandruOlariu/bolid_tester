/** Cross-cutting runtime settings, persisted across launches via expo-file-system — see
 *  persistStorage.ts and docs/features/settings.md.
 *
 *  The adapter I/O log used to live here as a zustand array, but it churned state per BLE chunk
 *  (finding F5). It now lives in its own module-level ring buffer with a throttled publish — see
 *  `adapterLog.ts`. This store no longer holds any log.
 *
 *  The AI `apiKey` is kept in runtime state but is NOT written to the settings file — it lives in the
 *  OS keystore (expo-secure-store), moved there on startup by `hydrateApiKey()` (finding F8). */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { fileStateStorage } from './persistStorage';
import { logError } from './errorLogStore';
import { secureGetApiKey, secureSetApiKey, redactApiKey, planApiKeyHydration } from './secureApiKey';

export type AdapterSource = 'mock' | 'ble';
export type ThemePref = 'system' | 'light' | 'dark';
/** Display unit system. obd-core always decodes to metric/SI; this only affects rendering (see
 *  shared/lib/units.ts). */
export type UnitSystem = 'metric' | 'imperial';

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
  units: UnitSystem;
  pollIntervalMs: number;
  /** Automatically retry the last device with backoff after an unexpected link drop. Default off. */
  autoReconnect: boolean;
  theme: ThemePref;
  ai: AiSettings;
  setAdapterSource: (s: AdapterSource) => void;
  setSimulatedVehicle: (id: string) => void;
  setInjectedDtcs: (codes: string[]) => void;
  setUnits: (u: UnitSystem) => void;
  setPollInterval: (ms: number) => void;
  setAutoReconnect: (v: boolean) => void;
  setTheme: (t: ThemePref) => void;
  setAi: (patch: Partial<AiSettings>) => void;
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
      autoReconnect: false,
      theme: 'dark',
      ai: DEFAULT_AI_SETTINGS,
      setAdapterSource: (adapterSource) => set({ adapterSource }),
      setSimulatedVehicle: (simulatedVehicleId) => set({ simulatedVehicleId }),
      setInjectedDtcs: (injectedDtcs) => set({ injectedDtcs }),
      setUnits: (units) => set({ units }),
      setPollInterval: (pollIntervalMs) => set({ pollIntervalMs }),
      setAutoReconnect: (autoReconnect) => set({ autoReconnect }),
      setTheme: (theme) => set({ theme }),
      setAi: (patch) =>
        set((s) => {
          // A changed apiKey is written to the OS keystore, never to the settings file (F8).
          // Best-effort: secureSetApiKey logs a warning and returns false when the keystore is
          // unavailable, in which case the key lives only in memory for the session.
          if (patch.apiKey !== undefined) void secureSetApiKey(patch.apiKey);
          return { ai: { ...s.ai, ...patch } };
        }),
    }),
    {
      name: 'bolid.settings',
      version: 1,
      storage: createJSONStorage(() => fileStateStorage),
      // Persist user config only — never the live adapter I/O log, and never the AI apiKey (redacted
      // here; it is stored in the OS keystore instead — finding F8).
      partialize: (s) => ({
        adapterSource: s.adapterSource,
        simulatedVehicleId: s.simulatedVehicleId,
        injectedDtcs: s.injectedDtcs,
        units: s.units,
        pollIntervalMs: s.pollIntervalMs,
        autoReconnect: s.autoReconnect,
        theme: s.theme,
        ai: redactApiKey(s.ai),
      }),
      // Deep-merge `ai` so new default fields survive an older persisted blob. A *legacy* blob may
      // still carry a plaintext apiKey here; it lands in runtime state, and `hydrateApiKey()` (below)
      // then migrates it into the keystore and rewrites the file without it.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<SettingsState>;
        return { ...current, ...p, ai: { ...current.ai, ...(p.ai ?? {}) } };
      },
      // Once the persisted blob is in memory, reconcile the apiKey with the keystore (migrate a legacy
      // plaintext key out of the file, or load the stored key into runtime state).
      onRehydrateStorage: () => (state, error) => {
        if (error || !state) return;
        void hydrateApiKey();
      },
    },
  ),
);

/** Startup reconciliation of the AI apiKey with the OS keystore (finding F8). Runs once the settings
 *  store has hydrated (wired to `onRehydrateStorage`):
 *   - a legacy plaintext key found in the settings blob is moved into the keystore, then a partialized
 *     rewrite strips it from `bolid.settings.json` (the key stays in runtime state), and
 *   - otherwise the keystore key, if any, is loaded into runtime state.
 *  Best-effort and idempotent — degrades to in-memory-only when the keystore is unavailable. */
export async function hydrateApiKey(): Promise<void> {
  try {
    const blobKey = useSettingsStore.getState().ai.apiKey;
    // Only touch the keystore when there is no legacy key to migrate (migration overwrites it anyway).
    const secureKey = blobKey && blobKey.trim() ? null : await secureGetApiKey();
    const plan = planApiKeyHydration(blobKey, secureKey);
    if (plan.action === 'migrate') {
      await secureSetApiKey(plan.key);
      // Force a partialized write so the plaintext key leaves bolid.settings.json now; the spread
      // keeps the key in runtime state (partialize redacts it on the way to disk).
      useSettingsStore.setState((s) => ({ ai: { ...s.ai } }));
    } else if (plan.action === 'load') {
      useSettingsStore.getState().setAi({ apiKey: plan.key });
    }
  } catch (e) {
    logError({ source: 'secure-store/hydrate', error: e, severity: 'warning' });
  }
}
