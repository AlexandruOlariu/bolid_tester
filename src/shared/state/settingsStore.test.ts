/** Production defaults + the settings migrations (v1 → v2 plan 01, v2 → v3 plan 12). settingsStore pulls in
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

import { migrateSettings, parseDtcList, SETTINGS_VERSION, useSettingsStore } from './settingsStore';

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

  it('persists at schema version 3', () => {
    expect(SETTINGS_VERSION).toBe(3);
    expect(useSettingsStore.persist.getOptions().version).toBe(3);
  });
});

describe('migrateSettings', () => {
  it('v1 → v3 keeps an explicit simulator choice, its injected codes and auto-reconnect', () => {
    expect(
      migrateSettings({ adapterSource: 'mock', injectedDtcs: ['P0299'], autoReconnect: false }, 1),
    ).toEqual({
      adapterSource: 'mock',
      injectedDtcs: ['P0299'],
      autoReconnect: false,
    });
  });

  it('v1 → v3 fills missing fields with the production defaults', () => {
    expect(migrateSettings({ theme: 'dark' }, 1)).toEqual({
      theme: 'dark',
      adapterSource: 'ble',
      injectedDtcs: [],
      autoReconnect: true,
    });
    expect(migrateSettings(undefined, 1)).toEqual({
      adapterSource: 'ble',
      injectedDtcs: [],
      autoReconnect: true,
    });
  });

  it('v2 → v3 keeps a stored auto-reconnect choice and defaults a missing one to on', () => {
    const blob = { adapterSource: 'mock' as const, injectedDtcs: ['P0420'], autoReconnect: false };
    expect(migrateSettings(blob, 2)).toEqual(blob);
    expect(migrateSettings({ theme: 'light' as const }, 2)).toEqual({
      theme: 'light',
      autoReconnect: true,
    });
  });

  it('is the identity from v3 on', () => {
    const blob = {
      adapterSource: 'mock' as const,
      injectedDtcs: ['P0420'],
      theme: 'light' as const,
    };
    expect(migrateSettings(blob, 3)).toEqual(blob);
    const partial = { theme: 'dark' as const };
    expect(migrateSettings(partial, 3)).toEqual(partial);
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
