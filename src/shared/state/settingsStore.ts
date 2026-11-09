/** Cross-cutting runtime settings, persisted across launches via expo-file-system — see
 *  persistStorage.ts and docs/features/settings.md.
 *
 *  The adapter I/O log used to live here as a zustand array, but it churned state per BLE chunk
 *  (finding F5). It now lives in its own module-level ring buffer with a throttled publish — see
 *  `adapterLog.ts`. This store no longer holds any log.
 *
 *  The AI `apiKey` is kept in runtime state but is NOT written to the settings file — it lives in the
 *  OS keystore (expo-secure-store), one slot per AI provider, moved there on startup by
 *  `hydrateApiKey()` (finding F8, plan 19). */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { fileStateStorage } from './persistStorage';
import { logError } from './errorLogStore';
import {
  secureGetApiKey,
  secureSetApiKey,
  secureGetLegacyApiKey,
  secureDeleteLegacyApiKey,
  redactApiKey,
  planApiKeyHydration,
} from './secureApiKey';
import {
  type AiProviderId,
  type AiProviderMemory,
  AI_PROVIDER_IDS,
  applyProviderPreset,
  inferProvider,
  isAiProviderId,
} from '@/shared/obd-core';
import {
  DEFAULT_WIFI_ENDPOINT,
  isValidEndpoint,
  type TcpEndpoint,
} from '@/shared/transports/tcp/endpoint';

/** Where the app gets its adapter: the simulator, a Bluetooth LE ELM327, a Wi-Fi ELM327 over TCP
 *  (plan 26), or a Classic Bluetooth (SPP) ELM327 — Android only (plan 27). */
export type AdapterSource = 'mock' | 'ble' | 'wifi' | 'spp';

/** Whether `source` can be used on platform `os` (`Platform.OS`): Classic Bluetooth is Android
 *  only — iOS opens classic accessories only through Apple's MFi programme, which ELM327 clones are
 *  not part of. */
export function isAdapterSourceSupported(source: AdapterSource, os: string): boolean {
  return source !== 'spp' || os === 'android';
}

/** The one-time notice shown when a stored Classic Bluetooth source was replaced on iOS. */
export const SPP_FALLBACK_NOTICE =
  'Classic Bluetooth adapters work only on Android, so the app switched to Bluetooth LE. ' +
  'Use a Bluetooth LE or Wi-Fi OBD2 adapter on this device.';

/** `Platform.OS`, once the app told the store (`setSettingsPlatform`); null = unknown (tests, or
 *  before startup), in which case no source is replaced. Kept out of the store module's imports so
 *  this file stays free of React Native (it runs in the Node test project). Declared before the
 *  store, because a synchronous storage would run `merge` during `create()`. */
let settingsPlatform: string | null = null;

/** Set by `merge` when hydration replaced an unusable stored source. zustand's persist writes the
 *  file after hydration only when a migration ran, so `onRehydrateStorage` writes the fallback back
 *  itself — otherwise the file keeps `'spp'` and the "one-time" notice returns on every launch. */
let fallbackNeedsWrite = false;

export type ThemePref = 'system' | 'light' | 'dark';

/** Structured-output mode for the AI request (see obd-core `buildChatRequestBody`). */
export type AiJsonMode = 'schema' | 'object' | 'off';

/** Connection + behaviour settings for the AI auto-diagnosis feature. Mirrors `AiClientConfig` in
 *  obd-core, plus an `enabled` toggle and the provider preset (plan 19). */
export interface AiSettings {
  enabled: boolean;
  /** Which provider preset the settings follow (local server, OpenAI, Anthropic, custom). Picks the
   *  wire in `getAiClient` and the keystore slot of `apiKey`. */
  provider: AiProviderId;
  /** Server base URL, with or without a trailing `/v1` (normalised when used). */
  baseUrl: string;
  model: string;
  /** The current provider's API key, runtime only: never written to the settings file (it lives in
   *  the keystore slot `bolid.ai.apiKey.<provider>`). Most local servers ignore it. */
  apiKey: string;
  timeoutMs: number;
  /** Structured-output mode: 'schema' (json_schema), 'object' (json_object), or 'off' (plain text). */
  jsonMode: AiJsonMode;
  /** URL / model / output mode last used with each other provider, restored when switching back
   *  (`applyProviderPreset`). Never holds a key. */
  remembered: Partial<Record<AiProviderId, AiProviderMemory>>;
}

export interface SettingsState {
  adapterSource: AdapterSource;
  simulatedVehicleId: string;
  injectedDtcs: string[];
  pollIntervalMs: number;
  /** Automatically retry the last device with backoff after an unexpected link drop. Default on
   *  (plan 12); connectionService's flap guard pauses it after 3 drops in a minute. */
  autoReconnect: boolean;
  /** On connect, select the garage car whose learned VIN matches the car's VIN. Default on (plan 06). */
  autoSelectByVin: boolean;
  theme: ThemePref;
  ai: AiSettings;
  /** The Wi-Fi adapter's TCP address (plan 26), used when `adapterSource` is `'wifi'`. */
  wifi: TcpEndpoint;
  /** Runtime only (never persisted): set when hydration replaced an adapter source this platform
   *  cannot use (a stored `'spp'` on iOS, plan 27). The Connect screen shows it once. */
  adapterSourceNotice: string | null;
  dismissAdapterSourceNotice: () => void;
  setAdapterSource: (s: AdapterSource) => void;
  setSimulatedVehicle: (id: string) => void;
  setInjectedDtcs: (codes: string[]) => void;
  setPollInterval: (ms: number) => void;
  setAutoReconnect: (v: boolean) => void;
  setAutoSelectByVin: (v: boolean) => void;
  setTheme: (t: ThemePref) => void;
  setAi: (patch: Partial<AiSettings>) => void;
  /** Change the Wi-Fi endpoint; an invalid result (bad host, port out of 1–65535) is ignored. */
  setWifi: (patch: Partial<TcpEndpoint>) => void;
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  enabled: true,
  provider: 'local',
  baseUrl: '',
  model: '',
  apiKey: '',
  timeoutMs: 30000,
  jsonMode: 'schema',
  remembered: {},
};

/** Codes the simulator accepts for injection: a letter (P/C/B/U), a first digit 0–3, then three hex
 *  digits. The first digit is only 2 bits in the wire encoding (SAE J2012 / `encodeDtc`), so e.g.
 *  `P4135` would silently read back as `P0135` — reject it instead. */
const DTC_CODE_RE = /^[PCBU][0-3][0-9A-F]{3}$/i;

/** Parse a comma/whitespace-separated list of DTC codes for the simulator's "Custom…" injection.
 *  Each code is trimmed and uppercased; invalid entries are ignored and duplicates dropped. */
export function parseDtcList(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[,\s]+/)) {
    const code = raw.trim().toUpperCase();
    if (code && DTC_CODE_RE.test(code) && !out.includes(code)) out.push(code);
  }
  return out;
}

/** Persisted settings schema version. v2 = production defaults (real adapter, no injected DTC);
 *  v3 = auto-reconnect on by default (plan 12); v4 = VIN auto-select of garage cars (plan 06);
 *  v5 = AI provider presets (plan 19); v6 = metric only, the dead `units` field dropped (plan 07);
 *  v7 = the Wi-Fi adapter endpoint (plan 26). */
export const SETTINGS_VERSION = 7;

/** Step a persisted blob up to `SETTINGS_VERSION`. Each step only fills *missing* fields with the new
 *  default — an explicit stored choice always survives (a tester who chose the simulator, or turned
 *  auto-reconnect off, must not be flipped under them).
 *   - v1 → v2: production defaults (`adapterSource: 'ble'`, `injectedDtcs: []`).
 *   - v2 → v3: `autoReconnect: true`.
 *   - v3 → v4: `autoSelectByVin: true`.
 *   - v4 → v5: `ai.provider` inferred from the stored server URL (`inferProvider`: api.openai.com →
 *     openai, api.anthropic.com → anthropic, blank → local, anything else → custom).
 *   - v5 → v6: the app is metric only (plan 07): a stale `units` key is dropped.
 *   - v6 → v7: `wifi` (the Wi-Fi adapter endpoint, plan 26) defaults to `192.168.0.10:35000`. */
export function migrateSettings(persisted: unknown, fromVersion: number): Partial<SettingsState> {
  let p = { ...((persisted ?? {}) as Partial<SettingsState>) };
  if (fromVersion < 2) {
    p = { ...p, adapterSource: p.adapterSource ?? 'ble', injectedDtcs: p.injectedDtcs ?? [] };
  }
  if (fromVersion < 3) {
    p = { ...p, autoReconnect: p.autoReconnect ?? true };
  }
  if (fromVersion < 4) {
    p = { ...p, autoSelectByVin: p.autoSelectByVin ?? true };
  }
  if (fromVersion < 5 && p.ai) {
    const ai = p.ai as Partial<AiSettings>;
    p = {
      ...p,
      ai: {
        ...ai,
        provider: isAiProviderId(ai.provider) ? ai.provider : inferProvider(ai.baseUrl ?? ''),
      } as AiSettings,
    };
  }
  if (fromVersion < 6) p = withoutUnits(p);
  if (fromVersion < 7) p = { ...p, wifi: p.wifi ?? { ...DEFAULT_WIFI_ENDPOINT } };
  return p;
}

/** A copy of a persisted blob without the pre-plan-07 `units` key (metric only, nothing to keep). */
function withoutUnits<T extends object>(blob: T): T {
  if (!('units' in blob)) return blob;
  const { units: _units, ...rest } = blob as T & { units?: unknown };
  return rest as T;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      // Production defaults (plan 01): a fresh install offers the real Bluetooth adapter; the
      // simulator is an explicit opt-in and never injects a fault unless asked.
      adapterSource: 'ble',
      simulatedVehicleId: 'golf-plus-2009-20tdi',
      injectedDtcs: [],
      pollIntervalMs: 1000,
      // On by default (plan 12): a drop on the Live tab reconnects on its own; the flap guard in
      // connectionService pauses it after 3 drops in a minute.
      autoReconnect: true,
      // On by default (plan 06): reconnecting a car you added to the garage selects it again.
      autoSelectByVin: true,
      theme: 'dark',
      ai: DEFAULT_AI_SETTINGS,
      wifi: { ...DEFAULT_WIFI_ENDPOINT },
      adapterSourceNotice: null,
      dismissAdapterSourceNotice: () => set({ adapterSourceNotice: null }),
      setAdapterSource: (adapterSource) => set({ adapterSource }),
      setSimulatedVehicle: (simulatedVehicleId) => set({ simulatedVehicleId }),
      setInjectedDtcs: (injectedDtcs) => set({ injectedDtcs }),
      setPollInterval: (pollIntervalMs) => set({ pollIntervalMs }),
      setAutoReconnect: (autoReconnect) => set({ autoReconnect }),
      setAutoSelectByVin: (autoSelectByVin) => set({ autoSelectByVin }),
      setTheme: (theme) => set({ theme }),
      setWifi: (patch) => {
        const next = { ...useSettingsStore.getState().wifi, ...patch };
        if (isValidEndpoint(next)) set({ wifi: { host: next.host, port: next.port } });
      },
      setAi: (patch) => {
        const prev = useSettingsStore.getState().ai;
        const { provider, ...rest } = patch;
        const switching = provider !== undefined && provider !== prev.provider;
        // A provider switch applies that provider's preset (URL / model / output mode) and swaps in
        // its own key: the in-memory one at once, then the keystore slot (loadApiKeyFor).
        let next: AiSettings = switching ? applyProviderPreset(prev, provider) : prev;
        if (switching) next = { ...next, apiKey: sessionKeys.get(next.provider) ?? '' };
        next = { ...next, ...rest };
        // A changed apiKey is written to the provider's keystore slot, never to the settings file
        // (F8). Best-effort: secureSetApiKey logs a warning and returns false when the keystore is
        // unavailable, in which case the key lives only in memory for the session.
        if (rest.apiKey !== undefined) {
          sessionKeys.set(next.provider, rest.apiKey);
          void secureSetApiKey(next.provider, rest.apiKey);
        }
        set({ ai: next });
        if (switching && rest.apiKey === undefined) void loadApiKeyFor(next.provider, next.apiKey);
      },
    }),
    {
      name: 'bolid.settings',
      version: SETTINGS_VERSION,
      storage: createJSONStorage(() => fileStateStorage),
      migrate: (persisted, version) => migrateSettings(persisted, version) as SettingsState,
      // Persist user config only — never the live adapter I/O log, and never the AI apiKey (redacted
      // here; it is stored in the OS keystore instead — finding F8).
      partialize: (s) => ({
        adapterSource: s.adapterSource,
        simulatedVehicleId: s.simulatedVehicleId,
        injectedDtcs: s.injectedDtcs,
        pollIntervalMs: s.pollIntervalMs,
        autoReconnect: s.autoReconnect,
        autoSelectByVin: s.autoSelectByVin,
        theme: s.theme,
        ai: redactApiKey(s.ai),
        wifi: s.wifi,
      }),
      // Deep-merge `ai` so new default fields survive an older persisted blob. A *legacy* blob may
      // still carry a plaintext apiKey here; it lands in runtime state, and `hydrateApiKey()` (below)
      // then migrates it into the keystore and rewrites the file without it.
      merge: (persisted, current) => {
        // `withoutUnits` again: a restored or hand-edited v6 file may still carry the dead key.
        const p = withoutUnits((persisted ?? {}) as Partial<SettingsState>);
        const ai = { ...current.ai, ...(p.ai ?? {}) };
        if (!isAiProviderId(ai.provider)) ai.provider = inferProvider(ai.baseUrl);
        // A restored or hand-edited file with an unusable endpoint keeps the current one.
        const wifi = isValidEndpoint(p.wifi) ? p.wifi : current.wifi;
        const merged = { ...current, ...p, ai, wifi };
        // Classic Bluetooth on iOS (a backup restored from an Android phone): fall back to BLE,
        // and have onRehydrateStorage write that back to the file.
        const fallback = platformFallback(merged.adapterSource);
        if (fallback.adapterSource) fallbackNeedsWrite = true;
        return { ...merged, ...fallback };
      },
      // Once the persisted blob is in memory, reconcile the apiKey with the keystore (migrate a legacy
      // plaintext key out of the file, or load the stored key into runtime state).
      onRehydrateStorage: () => (state, error) => {
        if (error || !state) return;
        if (fallbackNeedsWrite) {
          fallbackNeedsWrite = false;
          // The persisted setState writes the partialized state (adapterSource 'ble') to the file.
          useSettingsStore.setState({ adapterSource: state.adapterSource });
        }
        void hydrateApiKey();
      },
    },
  ),
);

/** The state patch that replaces an adapter source this platform cannot use, or `{}`. */
function platformFallback(
  source: AdapterSource | undefined,
): Partial<Pick<SettingsState, 'adapterSource' | 'adapterSourceNotice'>> {
  if (!source || settingsPlatform === null || isAdapterSourceSupported(source, settingsPlatform)) {
    return {};
  }
  return { adapterSource: 'ble', adapterSourceNotice: SPP_FALLBACK_NOTICE };
}

/** Tell the store which platform it runs on (`Platform.OS`; called once at app start, from the
 *  root layout). A stored source this platform cannot use — Classic Bluetooth on iOS — falls back
 *  to Bluetooth LE with a one-time notice, whether hydration already ran or runs later (`merge`).
 *  `null` forgets the platform (tests). */
export function setSettingsPlatform(os: string | null): void {
  settingsPlatform = os;
  const patch = platformFallback(useSettingsStore.getState().adapterSource);
  if (patch.adapterSource) useSettingsStore.setState(patch);
}

/** Keys entered this session, per provider. Keeps a provider switch working when the keystore is
 *  unavailable (Expo Go, web, tests), where keys live in memory only (documented degradation). */
const sessionKeys = new Map<AiProviderId, string>();

/** Forget every AI key (Settings → Reset all app data, plan 07): this session's keys in memory, each
 *  provider's keystore slot and the pre-plan-19 single slot. Best-effort: without the keystore
 *  (tests, web) only the memory is cleared. The runtime `ai.apiKey` is the caller's to reset. */
export async function forgetAllApiKeys(): Promise<void> {
  sessionKeys.clear();
  await Promise.all([
    ...AI_PROVIDER_IDS.map((p) => secureSetApiKey(p, '')),
    secureDeleteLegacyApiKey(),
  ]);
}

/** Load `provider`'s key from its keystore slot into runtime state, unless the user switched away
 *  again or typed a key meanwhile (the runtime key is no longer `shownKey`, the one set on the
 *  switch). Writes runtime state only; never the keystore. */
async function loadApiKeyFor(provider: AiProviderId, shownKey: string): Promise<void> {
  try {
    const key = await secureGetApiKey(provider);
    if (key === null) return;
    const { ai } = useSettingsStore.getState();
    if (ai.provider !== provider || ai.apiKey !== shownKey) return;
    useSettingsStore.setState({ ai: { ...ai, apiKey: key } });
  } catch (e) {
    logError({ source: 'secure-store/load', error: e, severity: 'warning' });
  }
}

/** Startup reconciliation of the AI apiKey with the OS keystore (finding F8, per provider since
 *  plan 19). Runs once the settings store has hydrated (wired to `onRehydrateStorage`):
 *   - a pre-F8 plaintext key found in the settings blob is moved into the current provider's slot,
 *     then a partialized rewrite strips it from `bolid.settings.json` (the key stays in runtime state),
 *   - otherwise the provider's slot key, if any, is loaded into runtime state,
 *   - otherwise a pre-plan-19 single-slot key (`bolid.ai.apiKey`) is moved into the provider's slot,
 *  and the legacy single slot is deleted once read, but only when its key is safe (loaded from the
 *  provider slot, or the move into it succeeded). Best-effort and idempotent — degrades to
 *  in-memory-only when the keystore is unavailable. */
export async function hydrateApiKey(): Promise<void> {
  try {
    const { provider, apiKey: blobKey } = useSettingsStore.getState().ai;
    const hasPlaintext = !!(blobKey && blobKey.trim());
    // Only touch the provider slot when there is no plaintext key to migrate (migration overwrites it).
    const secureKey = hasPlaintext ? null : await secureGetApiKey(provider);
    const legacyKey = await secureGetLegacyApiKey();
    const plan = planApiKeyHydration(provider, blobKey, secureKey, legacyKey);
    // The legacy slot may only go once its key is safe elsewhere: a failed move keeps it, so the
    // next start retries the migration instead of losing the key.
    let legacySafeToDrop = plan.action !== 'migrate';
    if (plan.action === 'migrate') {
      legacySafeToDrop = await secureSetApiKey(plan.provider, plan.key);
      sessionKeys.set(plan.provider, plan.key);
      // Force a partialized write so a plaintext key leaves bolid.settings.json now; the key is set
      // in runtime state (partialize redacts it on the way to disk).
      useSettingsStore.setState((s) =>
        s.ai.provider === plan.provider
          ? { ai: { ...s.ai, apiKey: plan.key } }
          : { ai: { ...s.ai } },
      );
    } else if (plan.action === 'load') {
      const { ai } = useSettingsStore.getState();
      if (ai.provider === plan.provider && !ai.apiKey)
        useSettingsStore.setState({ ai: { ...ai, apiKey: plan.key } });
    }
    if (plan.dropLegacy && legacySafeToDrop) await secureDeleteLegacyApiKey();
  } catch (e) {
    logError({ source: 'secure-store/hydrate', error: e, severity: 'warning' });
  }
}
