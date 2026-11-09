/** apiKey hydration/migration + redaction logic (finding F8) and the per-provider keystore slots
 *  (plan 19). Importing secureApiKey pulls in errorLogStore -> persistStorage -> expo-file-system
 *  (ESM, not transformed for the node test env), so we mock it to a no-op file system. The keystore
 *  is an in-memory double injected with `setSecureStoreModule`, so the tests never depend on the
 *  variable-specifier `import()` resolving under Jest. */
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: '/tmp/bolid-test/',
  cacheDirectory: '/tmp/bolid-test/',
  getInfoAsync: jest.fn(async () => ({ exists: false })),
  readAsStringAsync: jest.fn(async () => ''),
  writeAsStringAsync: jest.fn(async () => undefined),
  deleteAsync: jest.fn(async () => undefined),
}));

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
  API_KEY_STORE_KEY,
  apiKeyStoreKey,
  planApiKeyHydration,
  redactApiKey,
  secureDeleteLegacyApiKey,
  secureGetApiKey,
  secureGetLegacyApiKey,
  secureSetApiKey,
  setSecureStoreModule,
} from './secureApiKey';

beforeAll(() => setSecureStoreModule(memoryKeystore));
afterAll(() => setSecureStoreModule(undefined));

describe('per-provider keystore slots', () => {
  beforeEach(() => keystore.clear());

  it('each provider has its own stable slot', () => {
    expect(apiKeyStoreKey('openai')).toBe('bolid.ai.apiKey.openai');
    expect(apiKeyStoreKey('anthropic')).toBe('bolid.ai.apiKey.anthropic');
    expect(apiKeyStoreKey('local')).not.toBe(API_KEY_STORE_KEY);
  });

  it('an OpenAI key and an Anthropic key never overwrite each other', async () => {
    expect(await secureSetApiKey('openai', 'sk-openai')).toBe(true);
    expect(await secureSetApiKey('anthropic', 'sk-ant')).toBe(true);
    expect(await secureGetApiKey('openai')).toBe('sk-openai');
    expect(await secureGetApiKey('anthropic')).toBe('sk-ant');
    expect(await secureGetApiKey('custom')).toBeNull();
    expect([...keystore.keys()].sort()).toEqual([
      'bolid.ai.apiKey.anthropic',
      'bolid.ai.apiKey.openai',
    ]);
  });

  it('an empty key deletes only that provider slot', async () => {
    await secureSetApiKey('openai', 'sk-openai');
    await secureSetApiKey('anthropic', 'sk-ant');
    await secureSetApiKey('openai', '');
    expect(await secureGetApiKey('openai')).toBeNull();
    expect(await secureGetApiKey('anthropic')).toBe('sk-ant');
  });

  it('reads and deletes the legacy single slot', async () => {
    keystore.set(API_KEY_STORE_KEY, 'sk-legacy');
    expect(await secureGetLegacyApiKey()).toBe('sk-legacy');
    await secureDeleteLegacyApiKey();
    expect(keystore.has(API_KEY_STORE_KEY)).toBe(false);
  });
});

describe('planApiKeyHydration', () => {
  it('migrates a plaintext file key into the provider slot regardless of keystore contents', () => {
    expect(planApiKeyHydration('openai', 'sk-file', null)).toEqual({
      action: 'migrate',
      provider: 'openai',
      key: 'sk-file',
      from: 'file',
      dropLegacy: false,
    });
    // The file key always wins: the file is the thing we must clear.
    expect(planApiKeyHydration('openai', 'sk-file', 'sk-secure', 'sk-legacy')).toEqual({
      action: 'migrate',
      provider: 'openai',
      key: 'sk-file',
      from: 'file',
      dropLegacy: true,
    });
  });

  it('loads the provider slot when the settings file carries none', () => {
    expect(planApiKeyHydration('anthropic', '', 'sk-secure')).toEqual({
      action: 'load',
      provider: 'anthropic',
      key: 'sk-secure',
      dropLegacy: false,
    });
    expect(planApiKeyHydration('anthropic', null, 'sk-secure').action).toBe('load');
    expect(planApiKeyHydration('anthropic', undefined, 'sk-secure').action).toBe('load');
  });

  it('moves a pre-plan-19 single-slot key into the current provider slot', () => {
    expect(planApiKeyHydration('openai', '', null, 'sk-legacy')).toEqual({
      action: 'migrate',
      provider: 'openai',
      key: 'sk-legacy',
      from: 'legacy-slot',
      dropLegacy: true,
    });
  });

  it('keeps the provider slot over a stale legacy key but still drops the legacy slot', () => {
    expect(planApiKeyHydration('openai', '', 'sk-new', 'sk-old')).toEqual({
      action: 'load',
      provider: 'openai',
      key: 'sk-new',
      dropLegacy: true,
    });
  });

  it('does nothing when no source has a key', () => {
    expect(planApiKeyHydration('local', '', null)).toEqual({
      action: 'none',
      provider: 'local',
      dropLegacy: false,
    });
    expect(planApiKeyHydration('local', undefined, undefined, undefined).action).toBe('none');
  });

  it('treats whitespace-only keys as absent', () => {
    expect(planApiKeyHydration('custom', '   ', '  ', ' ').action).toBe('none');
    expect(planApiKeyHydration('custom', '   ', 'sk-secure')).toMatchObject({
      action: 'load',
      key: 'sk-secure',
    });
  });
});

describe('redactApiKey', () => {
  it('blanks the apiKey and leaves every other field intact', () => {
    const ai = {
      enabled: true,
      provider: 'anthropic',
      baseUrl: 'http://x',
      model: 'm',
      apiKey: 'sk-secret',
      timeoutMs: 42,
      jsonMode: 'off',
      remembered: { local: { baseUrl: 'http://y', model: 'q', jsonMode: 'schema' } },
    };
    expect(redactApiKey(ai)).toEqual({ ...ai, apiKey: '' });
  });

  it('does not mutate its input (no secret leak through aliasing)', () => {
    const ai = { apiKey: 'sk-secret', model: 'm' };
    const out = redactApiKey(ai);
    expect(ai.apiKey).toBe('sk-secret');
    expect(out.apiKey).toBe('');
    expect(out).not.toBe(ai);
  });
});
