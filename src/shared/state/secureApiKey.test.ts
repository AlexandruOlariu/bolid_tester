/** Pure apiKey hydration/migration + redaction logic (finding F8). Importing secureApiKey pulls in
 *  errorLogStore -> persistStorage -> expo-file-system (ESM, not transformed for the node test env),
 *  so we mock it to a no-op file system; the pure functions under test touch none of it. */
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: '/tmp/bolid-test/',
  cacheDirectory: '/tmp/bolid-test/',
  getInfoAsync: jest.fn(async () => ({ exists: false })),
  readAsStringAsync: jest.fn(async () => ''),
  writeAsStringAsync: jest.fn(async () => undefined),
  deleteAsync: jest.fn(async () => undefined),
}));

import { planApiKeyHydration, redactApiKey } from './secureApiKey';

describe('planApiKeyHydration', () => {
  it('migrates a legacy plaintext key regardless of keystore contents', () => {
    expect(planApiKeyHydration('sk-legacy', null)).toEqual({ action: 'migrate', key: 'sk-legacy' });
    // A legacy key always wins — the file is the thing we must clear.
    expect(planApiKeyHydration('sk-legacy', 'sk-secure')).toEqual({ action: 'migrate', key: 'sk-legacy' });
  });

  it('loads the keystore key when the settings file carries none', () => {
    expect(planApiKeyHydration('', 'sk-secure')).toEqual({ action: 'load', key: 'sk-secure' });
    expect(planApiKeyHydration(null, 'sk-secure')).toEqual({ action: 'load', key: 'sk-secure' });
    expect(planApiKeyHydration(undefined, 'sk-secure')).toEqual({ action: 'load', key: 'sk-secure' });
  });

  it('does nothing when neither source has a key', () => {
    expect(planApiKeyHydration('', null)).toEqual({ action: 'none' });
    expect(planApiKeyHydration(undefined, undefined)).toEqual({ action: 'none' });
  });

  it('treats whitespace-only keys as absent', () => {
    expect(planApiKeyHydration('   ', '  ')).toEqual({ action: 'none' });
    expect(planApiKeyHydration('   ', 'sk-secure')).toEqual({ action: 'load', key: 'sk-secure' });
  });
});

describe('redactApiKey', () => {
  it('blanks the apiKey and leaves every other field intact', () => {
    const ai = { enabled: true, baseUrl: 'http://x', model: 'm', apiKey: 'sk-secret', timeoutMs: 42, jsonMode: 'off' };
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
