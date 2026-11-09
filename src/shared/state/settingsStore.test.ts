/** Production defaults + the settings migrations (v1 → v2 plan 01, v2 → v3 plan 12, v3 → v4 plan 06,
 *  v4 → v5 plan 19) and the AI provider switch with per-provider keys (plan 19). settingsStore pulls in
 *  persistStorage -> expo-file-system (ESM, not transformed for the node test env), so the file system
 *  is mocked with an in-memory map; that also lets the persist round-trip below exercise the real
 *  `migrate` wiring, not just the pure helper. */
const files = new Map<string, string>();

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: '/tmp/bolid-test/',
  cacheDirectory: '/tmp/bolid-test/',
  getInfoAsync: jest.fn(async (uri: string) => ({ exists: files.has(uri) })),
  readAsStringAsync: jest.fn(async (uri: string) => files.get(uri) ?? ''),
  writeAsStringAsync: jest.fn(async (uri: string, value: string) => {
    files.set(uri, value);
  }),
  deleteAsync: jest.fn(async (uri: string) => {
    files.delete(uri);
  }),
}));

// In-memory keystore, injected (setSecureStoreModule) so no test depends on the variable-specifier
// import() of expo-secure-store resolving under Jest.
const keystore = new Map<string, string>();
const memoryKeystore = {
  getItemAsync: async (k: string) => keystore.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => {
    keystore.set(k, v);
  },
  deleteItemAsync: async (k: string) => {
    keystore.delete(k);
  },
};

import {
  DEFAULT_AI_SETTINGS,
  hydrateApiKey,
  migrateSettings,
  isAdapterSourceSupported,
  parseDtcList,
  setSettingsPlatform,
  SETTINGS_VERSION,
  SPP_FALLBACK_NOTICE,
  WEB_SOURCE_FALLBACK_NOTICE,
  useSettingsStore,
} from './settingsStore';
import { setSecureStoreModule } from './secureApiKey';
import { DEFAULT_WIFI_ENDPOINT } from '@/shared/transports/tcp/endpoint';

const WIFI = DEFAULT_WIFI_ENDPOINT;

beforeAll(() => setSecureStoreModule(memoryKeystore));
afterAll(() => setSecureStoreModule(undefined));

const SETTINGS_FILE = '/tmp/bolid-test/bolid.settings.json';

describe('settings defaults', () => {
  it('a fresh install uses the real adapter and injects no fault', () => {
    const fresh = useSettingsStore.getInitialState();
    expect(fresh.adapterSource).toBe('ble');
    expect(fresh.injectedDtcs).toEqual([]);
    expect(fresh.simulatedVehicleId).toBe('golf-plus-2009-20tdi');
  });

  it('a fresh install has auto-reconnect on (plan 12)', () => {
    expect(useSettingsStore.getInitialState().autoReconnect).toBe(true);
  });

  it('a fresh install auto-selects garage cars by VIN (plan 06)', () => {
    expect(useSettingsStore.getInitialState().autoSelectByVin).toBe(true);
  });

  it('persists at schema version 7', () => {
    expect(SETTINGS_VERSION).toBe(7);
    expect(useSettingsStore.persist.getOptions().version).toBe(7);
  });

  it('a fresh install has the default Wi-Fi adapter endpoint, persisted (plan 26)', () => {
    expect(useSettingsStore.getInitialState().wifi).toEqual(DEFAULT_WIFI_ENDPOINT);
    const partialize = useSettingsStore.persist.getOptions().partialize!;
    expect(partialize(useSettingsStore.getInitialState())).toHaveProperty('wifi', {
      host: '192.168.0.10',
      port: 35000,
    });
  });

  it('is metric only: no units field in state or in the written file (plan 07)', () => {
    expect(useSettingsStore.getInitialState()).not.toHaveProperty('units');
    expect(useSettingsStore.getInitialState()).not.toHaveProperty('setUnits');
    const partialize = useSettingsStore.persist.getOptions().partialize!;
    expect(partialize(useSettingsStore.getInitialState())).not.toHaveProperty('units');
  });

  it('a fresh install starts on the local-server provider (plan 19)', () => {
    expect(useSettingsStore.getInitialState().ai.provider).toBe('local');
    expect(DEFAULT_AI_SETTINGS.remembered).toEqual({});
  });
});

describe('migrateSettings', () => {
  it('v1 → v4 keeps an explicit simulator choice, its injected codes and auto-reconnect', () => {
    expect(
      migrateSettings({ adapterSource: 'mock', injectedDtcs: ['P0299'], autoReconnect: false }, 1),
    ).toEqual({
      adapterSource: 'mock',
      injectedDtcs: ['P0299'],
      autoReconnect: false,
      autoSelectByVin: true,
      wifi: DEFAULT_WIFI_ENDPOINT,
    });
  });

  it('v1 → v4 fills missing fields with the production defaults', () => {
    expect(migrateSettings({ theme: 'dark' }, 1)).toEqual({
      theme: 'dark',
      adapterSource: 'ble',
      injectedDtcs: [],
      autoReconnect: true,
      autoSelectByVin: true,
      wifi: DEFAULT_WIFI_ENDPOINT,
    });
    expect(migrateSettings(undefined, 1)).toEqual({
      adapterSource: 'ble',
      injectedDtcs: [],
      autoReconnect: true,
      autoSelectByVin: true,
      wifi: DEFAULT_WIFI_ENDPOINT,
    });
  });

  it('v2 → v4 keeps a stored auto-reconnect choice and defaults a missing one to on', () => {
    const blob = { adapterSource: 'mock' as const, injectedDtcs: ['P0420'], autoReconnect: false };
    expect(migrateSettings(blob, 2)).toEqual({ ...blob, autoSelectByVin: true, wifi: WIFI });
    expect(migrateSettings({ theme: 'light' as const }, 2)).toEqual({
      theme: 'light',
      autoReconnect: true,
      autoSelectByVin: true,
      wifi: WIFI,
    });
  });

  it('v3 → v4 adds VIN auto-select (on) and keeps every v3 field', () => {
    const blob = {
      adapterSource: 'mock' as const,
      injectedDtcs: ['P0420'],
      autoReconnect: false,
      theme: 'light' as const,
    };
    expect(migrateSettings(blob, 3)).toEqual({ ...blob, autoSelectByVin: true, wifi: WIFI });
    expect(migrateSettings({ ...blob, autoSelectByVin: false }, 3)).toEqual({
      ...blob,
      autoSelectByVin: false,
      wifi: WIFI,
    });
  });

  it('v4 → v5 infers the AI provider from the stored server URL (plan 19)', () => {
    const ai = (baseUrl: string) => ({ ...DEFAULT_AI_SETTINGS, baseUrl, provider: undefined });
    const provider = (baseUrl: string) =>
      migrateSettings({ ai: ai(baseUrl) } as never, 4).ai?.provider;
    expect(provider('https://api.openai.com/v1')).toBe('openai');
    expect(provider('https://api.anthropic.com')).toBe('anthropic');
    expect(provider('')).toBe('local');
    expect(provider('http://192.168.1.50:1234')).toBe('custom');
    // every other ai field is kept
    expect(migrateSettings({ ai: ai('http://h:1') } as never, 4).ai).toMatchObject({
      baseUrl: 'http://h:1',
      model: '',
      jsonMode: 'schema',
    });
    // a blob without an ai section stays without one (merge fills the defaults)
    expect(migrateSettings({ theme: 'dark' as const }, 4)).toEqual({ theme: 'dark', wifi: WIFI });
  });

  it('v5 → v6 drops the dead units key and keeps everything else (plan 07)', () => {
    const blob = { theme: 'light' as const, pollIntervalMs: 500 };
    expect(migrateSettings({ ...blob, units: 'metric' }, 5)).toEqual({ ...blob, wifi: WIFI });
    expect(migrateSettings({ ...blob, units: 'metric' }, 1)).not.toHaveProperty('units');
    expect(migrateSettings(blob, 5)).toEqual({ ...blob, wifi: WIFI });
  });

  it('v6 → v7 fills the Wi-Fi endpoint and keeps a stored one (plan 26)', () => {
    const blob = { adapterSource: 'ble' as const, theme: 'light' as const };
    expect(migrateSettings(blob, 6)).toEqual({ ...blob, wifi: WIFI });
    const custom = { ...blob, wifi: { host: '192.168.4.1', port: 23 } };
    expect(migrateSettings(custom, 6)).toEqual(custom);
    // A fresh copy: the frozen default is never handed out as mutable state.
    expect(migrateSettings(blob, 6).wifi).not.toBe(DEFAULT_WIFI_ENDPOINT);
  });

  it('is the identity from v7 on', () => {
    const blob = {
      adapterSource: 'mock' as const,
      injectedDtcs: ['P0420'],
      theme: 'light' as const,
      ai: { ...DEFAULT_AI_SETTINGS, provider: 'local' as const, baseUrl: 'https://api.openai.com' },
    };
    expect(migrateSettings(blob, 7)).toEqual(blob);
    const partial = { theme: 'dark' as const };
    expect(migrateSettings(partial, 7)).toEqual(partial);
  });
});

describe('persisted v1 blob rehydration', () => {
  beforeEach(() => {
    files.clear();
    useSettingsStore.setState(useSettingsStore.getInitialState(), true);
  });

  const writeBlob = (state: Record<string, unknown>, version: number) =>
    files.set(SETTINGS_FILE, JSON.stringify({ state, version }));

  it('a v1 tester blob still opens in simulator mode after the upgrade', async () => {
    writeBlob({ adapterSource: 'mock', injectedDtcs: ['P0299'], theme: 'light' }, 1);
    await useSettingsStore.persist.rehydrate();
    const s = useSettingsStore.getState();
    expect(s.adapterSource).toBe('mock');
    expect(s.injectedDtcs).toEqual(['P0299']);
    expect(s.theme).toBe('light');
  });

  // Defensive only: v1's partialize always wrote adapterSource/injectedDtcs, so a real v1 file never
  // lacks them (known limitation, docs/features/settings.md). This covers hand-edited/partial blobs.
  it('a partial v1 blob without an adapter choice gets the real adapter', async () => {
    writeBlob({ theme: 'light', pollIntervalMs: 500 }, 1);
    await useSettingsStore.persist.rehydrate();
    const s = useSettingsStore.getState();
    expect(s.adapterSource).toBe('ble');
    expect(s.injectedDtcs).toEqual([]);
    expect(s.pollIntervalMs).toBe(500);
  });

  it('a v5 blob with the dead units key rehydrates without it, in state and in the file', async () => {
    writeBlob({ adapterSource: 'ble', injectedDtcs: [], theme: 'light', units: 'metric' }, 5);
    await useSettingsStore.persist.rehydrate();
    expect(useSettingsStore.getState()).not.toHaveProperty('units');
    expect(useSettingsStore.getState().theme).toBe('light');
    useSettingsStore.getState().setTheme('dark'); // the next write
    expect(JSON.parse(files.get(SETTINGS_FILE) ?? '{}').state).not.toHaveProperty('units');
  });

  it('a v2 blob that turned auto-reconnect off keeps it off', async () => {
    writeBlob({ adapterSource: 'ble', injectedDtcs: [], autoReconnect: false }, 2);
    await useSettingsStore.persist.rehydrate();
    expect(useSettingsStore.getState().autoReconnect).toBe(false);
  });

  it('a v2 blob without an auto-reconnect field gets it on', async () => {
    // Runtime state starts "off" (setState persists, so the blob is written after it): only the
    // v2 -> v3 migration can turn it on.
    useSettingsStore.setState({ autoReconnect: false });
    writeBlob({ adapterSource: 'ble', injectedDtcs: [], theme: 'light' }, 2);
    await useSettingsStore.persist.rehydrate();
    expect(useSettingsStore.getState().autoReconnect).toBe(true);
  });

  it('a v3 blob (no VIN auto-select field yet) gets it on and keeps its other choices', async () => {
    useSettingsStore.setState({ autoSelectByVin: false });
    writeBlob({ adapterSource: 'mock', injectedDtcs: [], autoReconnect: false }, 3);
    await useSettingsStore.persist.rehydrate();
    const s = useSettingsStore.getState();
    expect(s.autoSelectByVin).toBe(true);
    expect(s.adapterSource).toBe('mock');
    expect(s.autoReconnect).toBe(false);
  });
});

describe('persisted v4 blob rehydration (plan 19)', () => {
  beforeEach(() => {
    files.clear();
    keystore.clear();
    useSettingsStore.setState(useSettingsStore.getInitialState(), true);
  });

  it('a v4 blob pointing at OpenAI opens on the OpenAI provider', async () => {
    files.set(
      SETTINGS_FILE,
      JSON.stringify({
        state: {
          ai: {
            enabled: true,
            baseUrl: 'https://api.openai.com',
            model: 'gpt-x',
            apiKey: '',
            timeoutMs: 30000,
            jsonMode: 'schema',
          },
        },
        version: 4,
      }),
    );
    await useSettingsStore.persist.rehydrate();
    const { ai } = useSettingsStore.getState();
    expect(ai.provider).toBe('openai');
    expect(ai.model).toBe('gpt-x');
    expect(ai.remembered).toEqual({});
  });
});

describe('AI provider switch and per-provider keys (plan 19)', () => {
  const flush = () => new Promise((r) => setTimeout(r, 0));
  beforeEach(() => {
    files.clear();
    keystore.clear();
    useSettingsStore.setState(useSettingsStore.getInitialState(), true);
  });

  it('switching to Anthropic applies the preset and keeps the local URL for later', () => {
    const { setAi } = useSettingsStore.getState();
    setAi({ baseUrl: 'http://192.168.1.50:1234', model: 'qwen' });
    setAi({ provider: 'anthropic' });
    let ai = useSettingsStore.getState().ai;
    expect(ai).toMatchObject({
      provider: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      model: 'claude-sonnet-5-5',
      jsonMode: 'off',
    });
    setAi({ provider: 'local' });
    ai = useSettingsStore.getState().ai;
    expect(ai).toMatchObject({
      provider: 'local',
      baseUrl: 'http://192.168.1.50:1234',
      model: 'qwen',
    });
  });

  it('a patch without a provider change never re-applies the preset', () => {
    const { setAi } = useSettingsStore.getState();
    setAi({ provider: 'anthropic' });
    setAi({ model: 'claude-opus-5-5' });
    setAi({ provider: 'anthropic', timeoutMs: 60000 });
    expect(useSettingsStore.getState().ai).toMatchObject({
      model: 'claude-opus-5-5',
      timeoutMs: 60000,
    });
  });

  it('each provider keeps its own key: one keystore slot per provider, none in the file', async () => {
    const { setAi } = useSettingsStore.getState();
    setAi({ provider: 'openai' });
    setAi({ apiKey: 'sk-openai' });
    setAi({ provider: 'anthropic' });
    expect(useSettingsStore.getState().ai.apiKey).toBe('');
    setAi({ apiKey: 'sk-ant' });
    setAi({ provider: 'openai' });
    expect(useSettingsStore.getState().ai.apiKey).toBe('sk-openai');
    await flush();
    expect(keystore.get('bolid.ai.apiKey.openai')).toBe('sk-openai');
    expect(keystore.get('bolid.ai.apiKey.anthropic')).toBe('sk-ant');
    expect(files.get(SETTINGS_FILE) ?? '').not.toContain('sk-');
  });

  it('switching provider loads that provider key from the keystore', async () => {
    keystore.set('bolid.ai.apiKey.anthropic', 'sk-ant-stored');
    useSettingsStore.getState().setAi({ provider: 'anthropic' });
    await flush();
    await flush();
    expect(useSettingsStore.getState().ai.apiKey).toBe('sk-ant-stored');
  });

  it('hydrateApiKey moves a pre-plan-19 single-slot key into the current provider slot', async () => {
    keystore.set('bolid.ai.apiKey', 'sk-legacy');
    useSettingsStore.setState((s) => ({ ai: { ...s.ai, provider: 'custom' } }));
    await hydrateApiKey();
    expect(keystore.get('bolid.ai.apiKey.custom')).toBe('sk-legacy');
    expect(keystore.has('bolid.ai.apiKey')).toBe(false);
    expect(useSettingsStore.getState().ai.apiKey).toBe('sk-legacy');
  });

  it('hydrateApiKey keeps the single-slot key when moving it into the provider slot fails', async () => {
    keystore.set('bolid.ai.apiKey', 'sk-legacy');
    useSettingsStore.setState((s) => ({ ai: { ...s.ai, provider: 'custom', apiKey: '' } }));
    const failingWrites = {
      ...memoryKeystore,
      setItemAsync: async () => {
        throw new Error('keystore locked');
      },
    };
    setSecureStoreModule(failingWrites);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await hydrateApiKey();
    } finally {
      setSecureStoreModule(memoryKeystore);
      warn.mockRestore();
    }
    expect(keystore.has('bolid.ai.apiKey.custom')).toBe(false);
    expect(keystore.get('bolid.ai.apiKey')).toBe('sk-legacy');
    expect(useSettingsStore.getState().ai.apiKey).toBe('sk-legacy');
  });

  it('hydrateApiKey moves a plaintext file key out of the file into the provider slot', async () => {
    useSettingsStore.setState((s) => ({ ai: { ...s.ai, provider: 'openai', apiKey: 'sk-file' } }));
    await hydrateApiKey();
    await flush();
    expect(keystore.get('bolid.ai.apiKey.openai')).toBe('sk-file');
    expect(useSettingsStore.getState().ai.apiKey).toBe('sk-file');
    expect(files.get(SETTINGS_FILE) ?? '').not.toContain('sk-file');
  });
});

describe('parseDtcList (Custom… injection)', () => {
  it('uppercases, trims and keeps only valid codes', () => {
    expect(parseDtcList('p0135, P0420 ,xyz, C1234,U0100')).toEqual([
      'P0135',
      'P0420',
      'C1234',
      'U0100',
    ]);
  });

  it('rejects malformed codes and drops duplicates', () => {
    expect(parseDtcList('P013, P01355, Q0135, P0G35, B1A2F, b1a2f')).toEqual(['B1A2F']);
    // The first digit is 2 bits on the wire: 4–F would read back as a different code.
    expect(parseDtcList('P4135, C8000, UF123, P3FFF')).toEqual(['P3FFF']);
    expect(parseDtcList('')).toEqual([]);
    expect(parseDtcList(' , ,')).toEqual([]);
  });
});

describe('Wi-Fi adapter endpoint (plan 26)', () => {
  beforeEach(() => {
    files.clear();
    useSettingsStore.setState(useSettingsStore.getInitialState(), true);
  });

  const writeBlob = (state: Record<string, unknown>, version: number) =>
    files.set(SETTINGS_FILE, JSON.stringify({ state, version }));

  it('a v6 blob rehydrates with the default endpoint and keeps its adapter choice', async () => {
    useSettingsStore.setState({ wifi: { host: '10.0.0.9', port: 1 } });
    writeBlob({ adapterSource: 'mock', injectedDtcs: [], theme: 'light' }, 6);
    await useSettingsStore.persist.rehydrate();
    const s = useSettingsStore.getState();
    expect(s.wifi).toEqual(DEFAULT_WIFI_ENDPOINT);
    expect(s.adapterSource).toBe('mock');
  });

  it('a v7 blob keeps its Wi-Fi source and endpoint', async () => {
    writeBlob({ adapterSource: 'wifi', wifi: { host: '192.168.4.1', port: 23 } }, 7);
    await useSettingsStore.persist.rehydrate();
    expect(useSettingsStore.getState().adapterSource).toBe('wifi');
    expect(useSettingsStore.getState().wifi).toEqual({ host: '192.168.4.1', port: 23 });
  });

  it('an unusable stored endpoint is ignored on rehydrate', async () => {
    writeBlob({ wifi: { host: 'bad host', port: 99999 } }, 7);
    await useSettingsStore.persist.rehydrate();
    expect(useSettingsStore.getState().wifi).toEqual(DEFAULT_WIFI_ENDPOINT);
  });

  it('setWifi applies a valid patch and ignores an invalid one', () => {
    useSettingsStore.getState().setWifi({ host: '192.168.4.1' });
    expect(useSettingsStore.getState().wifi).toEqual({ host: '192.168.4.1', port: 35000 });
    useSettingsStore.getState().setWifi({ port: 23 });
    expect(useSettingsStore.getState().wifi).toEqual({ host: '192.168.4.1', port: 23 });
    useSettingsStore.getState().setWifi({ port: 0 });
    useSettingsStore.getState().setWifi({ host: '192.168.0.300' });
    expect(useSettingsStore.getState().wifi).toEqual({ host: '192.168.4.1', port: 23 });
    expect(JSON.parse(files.get(SETTINGS_FILE) ?? '{}').state.wifi).toEqual({
      host: '192.168.4.1',
      port: 23,
    });
  });
});

describe('Classic Bluetooth source on iOS (plan 27)', () => {
  beforeEach(() => {
    files.clear();
    useSettingsStore.setState(useSettingsStore.getInitialState(), true);
  });
  afterEach(() => setSettingsPlatform(null));

  const writeBlob = (state: Record<string, unknown>, version: number) =>
    files.set(SETTINGS_FILE, JSON.stringify({ state, version }));

  it('only Android supports the Classic Bluetooth source', () => {
    expect(isAdapterSourceSupported('spp', 'android')).toBe(true);
    expect(isAdapterSourceSupported('spp', 'ios')).toBe(false);
    expect(isAdapterSourceSupported('spp', 'web')).toBe(false);
    expect(isAdapterSourceSupported('ble', 'ios')).toBe(true);
    expect(isAdapterSourceSupported('wifi', 'ios')).toBe(true);
  });

  it('a stored spp source survives hydration on Android', async () => {
    setSettingsPlatform('android');
    writeBlob({ adapterSource: 'spp' }, SETTINGS_VERSION);
    await useSettingsStore.persist.rehydrate();
    expect(useSettingsStore.getState().adapterSource).toBe('spp');
    expect(useSettingsStore.getState().adapterSourceNotice).toBeNull();
  });

  it('a stored spp source falls back to Bluetooth LE on iOS, with a one-time notice', async () => {
    setSettingsPlatform('ios');
    writeBlob({ adapterSource: 'spp' }, SETTINGS_VERSION);
    await useSettingsStore.persist.rehydrate();
    const s = useSettingsStore.getState();
    expect(s.adapterSource).toBe('ble');
    expect(s.adapterSourceNotice).toBe(SPP_FALLBACK_NOTICE);
    // The fallback is written back by hydration itself (no other setting change needed), so the
    // next launch reads 'ble' and the notice is truly one-time; the notice is runtime only.
    const saved = JSON.parse(files.get(SETTINGS_FILE) ?? '{}').state;
    expect(saved.adapterSource).toBe('ble');
    expect(saved).not.toHaveProperty('adapterSourceNotice');
    s.dismissAdapterSourceNotice();
    expect(useSettingsStore.getState().adapterSourceNotice).toBeNull();
    // Next cold start: the file already says 'ble', so no notice comes back.
    useSettingsStore.setState(useSettingsStore.getInitialState(), true);
    await useSettingsStore.persist.rehydrate();
    expect(useSettingsStore.getState().adapterSource).toBe('ble');
    expect(useSettingsStore.getState().adapterSourceNotice).toBeNull();
  });

  it('falls back when the platform is learned after hydration', async () => {
    writeBlob({ adapterSource: 'spp' }, SETTINGS_VERSION);
    await useSettingsStore.persist.rehydrate();
    expect(useSettingsStore.getState().adapterSource).toBe('spp');
    setSettingsPlatform('ios');
    expect(useSettingsStore.getState().adapterSource).toBe('ble');
    expect(useSettingsStore.getState().adapterSourceNotice).toBe(SPP_FALLBACK_NOTICE);
  });

  it('leaves every other source alone on iOS', async () => {
    setSettingsPlatform('ios');
    writeBlob({ adapterSource: 'wifi' }, SETTINGS_VERSION);
    await useSettingsStore.persist.rehydrate();
    expect(useSettingsStore.getState().adapterSource).toBe('wifi');
    expect(useSettingsStore.getState().adapterSourceNotice).toBeNull();
  });
});

describe('adapter sources in the browser (plan 28)', () => {
  beforeEach(() => {
    files.clear();
    useSettingsStore.setState(useSettingsStore.getInitialState(), true);
  });
  afterEach(() => setSettingsPlatform(null));

  it('the web offers Bluetooth LE and the simulator only', () => {
    expect(isAdapterSourceSupported('ble', 'web')).toBe(true);
    expect(isAdapterSourceSupported('mock', 'web')).toBe(true);
    expect(isAdapterSourceSupported('wifi', 'web')).toBe(false);
    expect(isAdapterSourceSupported('spp', 'web')).toBe(false);
    expect(isAdapterSourceSupported('wifi', 'android')).toBe(true);
  });

  it.each(['wifi', 'spp'] as const)(
    'a stored %s source (a phone backup) falls back to Bluetooth LE with the web notice',
    async (source) => {
      setSettingsPlatform('web');
      files.set(
        SETTINGS_FILE,
        JSON.stringify({ state: { adapterSource: source }, version: SETTINGS_VERSION }),
      );
      await useSettingsStore.persist.rehydrate();
      expect(useSettingsStore.getState().adapterSource).toBe('ble');
      expect(useSettingsStore.getState().adapterSourceNotice).toBe(WEB_SOURCE_FALLBACK_NOTICE);
    },
  );

  it('a Wi-Fi source chosen before the platform was known falls back once it is', () => {
    useSettingsStore.setState({ adapterSource: 'wifi' });
    setSettingsPlatform('web');
    expect(useSettingsStore.getState().adapterSource).toBe('ble');
  });
});
