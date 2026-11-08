/** Production defaults + the v1 → v2 settings migration (plan 01). settingsStore pulls in
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

  it('persists at schema version 2', () => {
    expect(SETTINGS_VERSION).toBe(2);
    expect(useSettingsStore.persist.getOptions().version).toBe(2);
  });
});

describe('migrateSettings', () => {
  it('v1 → v2 keeps an explicit simulator choice and its injected codes', () => {
    expect(migrateSettings({ adapterSource: 'mock', injectedDtcs: ['P0299'] }, 1)).toEqual({
      adapterSource: 'mock',
      injectedDtcs: ['P0299'],
    });
  });

  it('v1 → v2 fills missing fields with the production defaults', () => {
    expect(migrateSettings({ theme: 'dark' }, 1)).toEqual({
      theme: 'dark',
      adapterSource: 'ble',
      injectedDtcs: [],
    });
    expect(migrateSettings(undefined, 1)).toEqual({ adapterSource: 'ble', injectedDtcs: [] });
  });

  it('is the identity from v2 on', () => {
    const blob = {
      adapterSource: 'mock' as const,
      injectedDtcs: ['P0420'],
      theme: 'light' as const,
    };
    expect(migrateSettings(blob, 2)).toEqual(blob);
    const partial = { theme: 'dark' as const };
    expect(migrateSettings(partial, 2)).toEqual(partial);
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
