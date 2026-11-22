/** Plugin resolution (plan 23): scope matching, pinning, the three badge states, the write
 *  decision, and reading / installing / deleting plugin files. Node-safe: the file system is an
 *  in-memory map. The plugin is a TEST VECTOR (seed XOR 0xFFFF), not a routine. */
const files = new Map<string, string>();

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: '/tmp/bolid-test/',
  cacheDirectory: '/tmp/bolid-test/',
  getInfoAsync: jest.fn(async (uri: string) => ({
    exists: files.has(uri),
    size: files.get(uri)?.length,
  })),
  readAsStringAsync: jest.fn(async (uri: string) => {
    const v = files.get(uri);
    if (v === undefined) throw new Error(`ENOENT ${uri}`);
    return v;
  }),
  writeAsStringAsync: jest.fn(async (uri: string, value: string) => {
    files.set(uri, value);
  }),
  deleteAsync: jest.fn(async (uri: string) => {
    files.delete(uri);
  }),
  makeDirectoryAsync: jest.fn(async () => undefined),
}));

import type { SeedKeyPluginV1 } from '@/shared/obd-core';
import {
  sanitizeSeedKeyIndex,
  useSeedKeyStore,
  type SeedKeyIndexEntry,
} from '@/shared/state/seedKeyStore';
import {
  NO_PLUGIN_MESSAGE,
  decideSecurity,
  matchSeedKeyPlugin,
  resolveSeedKey,
  resolveSeedToKey,
  seedKeyVehicleKeys,
  unlockStatusFor,
} from './resolveSeedKey';
import {
  installSeedKeyPlugin,
  pickSeedKeyFile,
  readSeedKeyProgram,
  removeSeedKeyPlugin,
  seedKeyPluginId,
  type SeedKeyModules,
} from './seedKeyFiles';
import { testSeedKeyPluginInSimulator } from './simulatorCheck';

const TOY: SeedKeyPluginV1 = {
  schema: 'bolid.seedkey.v1',
  name: 'Test vector BCM',
  applies: { reqHeader: '70E', level: 3 },
  seedBytes: 2,
  keyBytes: 2,
  program: [{ op: 'load', from: 'seed' }, { op: 'xor', value: 0xffff }, { op: 'store' }],
};

const entry = (id: string, extra: Partial<SeedKeyIndexEntry> = {}): SeedKeyIndexEntry => ({
  id,
  name: id,
  applies: { reqHeader: '70E', level: 3 },
  seedBytes: 2,
  keyBytes: 2,
  fileUri: `/tmp/bolid-test/seedkeys/${id}.json`,
  importedAt: 1,
  ...extra,
});

const fsMod = jest.requireMock('expo-file-system/legacy') as SeedKeyModules['FileSystem'];
const mods = (picked?: string, size?: number): SeedKeyModules => ({
  FileSystem: fsMod,
  Picker:
    picked === undefined
      ? null
      : {
          getDocumentAsync: async () => {
            files.set('/cache/plugin.json', picked);
            return {
              canceled: false,
              assets: [{ uri: '/cache/plugin.json', name: 'plugin.json', size }],
            };
          },
        },
});

beforeEach(() => {
  files.clear();
  useSeedKeyStore.setState({ plugins: [] });
  // The failure paths log a warning (dev builds echo it to the console).
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('matchSeedKeyPlugin', () => {
  const target = { reqHeader: '70E', level: 3, vehicleKeys: ['vin:CAR1', 'id:golf'] };

  it('a header + level match beats a part-number prefix match', () => {
    const list = [
      entry('prefix', { applies: { partNumberPrefix: '1K0937', level: 3 } }),
      entry('header'),
    ];
    expect(matchSeedKeyPlugin(list, { ...target, partNumber: '1K0937087D' })?.id).toBe('header');
    expect(matchSeedKeyPlugin(list.slice(0, 1), { ...target, partNumber: '1K0937087D' })?.id).toBe(
      'prefix',
    );
  });

  it('needs the same level, and the VAG address matches like the header', () => {
    expect(matchSeedKeyPlugin([entry('a')], { ...target, level: 1 })).toBeNull();
    const byAddress = entry('addr', { applies: { address: '09', level: 3 } });
    expect(
      matchSeedKeyPlugin([byAddress], { ...target, reqHeader: '7E0', address: '09' })?.id,
    ).toBe('addr');
    expect(matchSeedKeyPlugin([byAddress], { ...target, reqHeader: '7E0' })).toBeNull();
  });

  it('a pinned plugin is used for its own car only, and wins over an unpinned one there', () => {
    const pinned = entry('pinned', { vehicleKey: 'vin:CAR1' });
    expect(
      matchSeedKeyPlugin([pinned], { ...target, vehicleKeys: ['vin:CAR2', 'id:golf'] }),
    ).toBeNull();
    expect(matchSeedKeyPlugin([pinned], { reqHeader: '70E', level: 3 })).toBeNull();
    expect(matchSeedKeyPlugin([entry('any'), pinned], target)?.id).toBe('pinned');
  });

  it('a prefix never matches an unknown or different part number (fail closed)', () => {
    const narrowed = entry('n', {
      applies: { reqHeader: '70E', partNumberPrefix: '1K0937', level: 3 },
    });
    expect(matchSeedKeyPlugin([narrowed], target)).toBeNull();
    expect(matchSeedKeyPlugin([narrowed], { ...target, partNumber: '5K0937087' })).toBeNull();
    expect(matchSeedKeyPlugin([narrowed], { ...target, partNumber: '1k0 937 087 d' })?.id).toBe(
      'n',
    );
  });

  it('nothing installed → null; the newest of equals wins', () => {
    expect(matchSeedKeyPlugin([], target)).toBeNull();
    expect(matchSeedKeyPlugin([entry('new'), entry('old')], target)?.id).toBe('new');
  });

  it('vehicle keys: VIN first, then the profile id', () => {
    expect(seedKeyVehicleKeys('golf', 'WVW1')).toEqual(['vin:WVW1', 'id:golf']);
    expect(seedKeyVehicleKeys('golf', null)).toEqual(['id:golf']);
  });
});

describe('unlockStatusFor / decideSecurity', () => {
  it('has three states', () => {
    expect(unlockStatusFor(undefined, null)).toEqual({ state: 'none-required' });
    expect(unlockStatusFor({ level: 3 }, { name: 'Mine' })).toEqual({
      state: 'unlockable',
      pluginName: 'Mine',
      level: 3,
    });
    expect(unlockStatusFor({ level: 3 }, null)).toEqual({ state: 'locked', level: 3 });
  });

  it('refuses a secured write without a routine — never the identity key', () => {
    expect(decideSecurity(undefined, null)).toEqual({ kind: 'none' });
    expect(decideSecurity({ level: 3 }, null)).toEqual({
      kind: 'refuse',
      message: NO_PLUGIN_MESSAGE,
    });
    expect(decideSecurity({ level: 3 }, { entry: null, seedToKey: null })).toEqual({
      kind: 'refuse',
      message: NO_PLUGIN_MESSAGE,
    });
    const problem = decideSecurity(
      { level: 3 },
      { entry: entry('x'), seedToKey: null, problem: 'File gone.' },
    );
    expect(problem).toEqual({ kind: 'refuse', message: 'Locked. File gone. Nothing was sent.' });
    const k = (s: number[]) => s;
    expect(decideSecurity({ level: 3 }, { entry: null, seedToKey: k })).toEqual({
      kind: 'unlock',
      security: { level: 3, seedToKey: k },
    });
  });
});

describe('plugin files', () => {
  it('pick → install → resolve → a routine that turns 12 34 into ED CB', async () => {
    const picked = await pickSeedKeyFile(mods(JSON.stringify(TOY)));
    expect(picked).toMatchObject({ status: 'picked', name: 'plugin.json', result: { ok: true } });
    if (picked.status !== 'picked' || !picked.result.ok) throw new Error('not picked');
    const res = await installSeedKeyPlugin(mods(), picked.result.plugin, { now: 1700000000000 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.entry.fileUri).toBe(
      `/tmp/bolid-test/seedkeys/${seedKeyPluginId(TOY.name, 1700000000000)}.json`,
    );
    expect(useSeedKeyStore.getState().plugins.map((p) => p.id)).toEqual([res.entry.id]);
    // The index never holds the program.
    expect(JSON.stringify(useSeedKeyStore.getState().plugins)).not.toMatch(/program|xor/);
    const k = await resolveSeedToKey({ reqHeader: '70E', level: 3 });
    expect(k?.([0x12, 0x34])).toEqual([0xed, 0xcb]);
    expect(await resolveSeedToKey({ reqHeader: '7E0', level: 3 })).toBeNull();
  });

  it('pick: unavailable, cancelled, oversize and invalid files', async () => {
    expect(await pickSeedKeyFile(mods())).toEqual({ status: 'unavailable' });
    const cancelled: SeedKeyModules = {
      FileSystem: fsMod,
      Picker: { getDocumentAsync: async () => ({ canceled: true, assets: null }) },
    };
    expect(await pickSeedKeyFile(cancelled)).toEqual({ status: 'cancelled' });
    expect(await pickSeedKeyFile(mods('{}', 300_000))).toMatchObject({
      result: { ok: false, error: expect.stringMatching(/too large/) },
    });
    expect(await pickSeedKeyFile(mods('{"schema":"bolid.seedkey.v1"}'))).toMatchObject({
      result: { ok: false, error: 'This security-access plugin is not valid.' },
    });
  });

  it('a missing or edited file is a problem, never a routine', async () => {
    const res = await installSeedKeyPlugin(mods(), TOY, { now: 5 });
    if (!res.ok) throw new Error(res.error);
    files.set(
      res.entry.fileUri,
      JSON.stringify({ ...TOY, applies: { reqHeader: '70E', level: 5 } }),
    );
    expect(await readSeedKeyProgram(fsMod, res.entry)).toMatchObject({
      ok: false,
      problem: expect.stringMatching(/changed since it was imported/),
    });
    files.set(res.entry.fileUri, '{ broken');
    expect((await resolveSeedKey({ reqHeader: '70E', level: 3 })).problem).toMatch(
      /no longer valid/,
    );
    files.delete(res.entry.fileUri);
    const missing = await resolveSeedKey({ reqHeader: '70E', level: 3 });
    expect(missing).toMatchObject({ seedToKey: null, problem: expect.stringMatching(/missing/) });
    expect(decideSecurity({ level: 3 }, missing).kind).toBe('refuse');
  });

  it('delete removes the file and the index entry', async () => {
    const res = await installSeedKeyPlugin(mods(), TOY, { now: 6 });
    if (!res.ok) throw new Error(res.error);
    await removeSeedKeyPlugin(mods(), res.entry.id);
    expect(files.has(res.entry.fileUri)).toBe(false);
    expect(useSeedKeyStore.getState().plugins).toEqual([]);
    expect(await resolveSeedToKey({ reqHeader: '70E', level: 3 })).toBeNull();
  });

  it('a pinned install matches only that car', async () => {
    await installSeedKeyPlugin(mods(), TOY, { now: 7, vehicleKey: 'vin:CAR1' });
    expect(
      await resolveSeedToKey({ reqHeader: '70E', level: 3, vehicleKeys: ['vin:CAR2'] }),
    ).toBeNull();
    expect(
      await resolveSeedToKey({ reqHeader: '70E', level: 3, vehicleKeys: ['vin:CAR1'] }),
    ).not.toBeNull();
  });

  it('the persisted index is re-validated entry by entry', () => {
    expect(
      sanitizeSeedKeyIndex({
        plugins: [entry('ok'), { ...entry('bad'), seedBytes: 3 }, entry('ok'), { id: 'x' }],
      }).map((p) => p.id),
    ).toEqual(['ok']);
    expect(sanitizeSeedKeyIndex(null)).toEqual([]);
  });
});

describe('testSeedKeyPluginInSimulator', () => {
  it('passes for a usable plugin and says what it cannot prove', async () => {
    const r = await testSeedKeyPluginInSimulator(TOY);
    expect(r).toMatchObject({ ok: true, seed: [0x12, 0x34], key: [0xed, 0xcb], steps: 3 });
    expect(r.message).toMatch(/^Passed in the simulator/);
    expect(r.message).toMatch(/only the car can/);
  });

  it('runs 4-byte widths and a 29-bit header too', async () => {
    const r = await testSeedKeyPluginInSimulator({
      ...TOY,
      applies: { reqHeader: '18DA40F1', level: 1 },
      seedBytes: 4,
      keyBytes: 4,
      program: [{ op: 'load', from: 'seed' }, { op: 'bswap' }, { op: 'store' }],
    });
    expect(r).toMatchObject({ ok: true, key: [0x78, 0x56, 0x34, 0x12] });
  });

  it('fails a program over the limits without touching the simulator', async () => {
    const r = await testSeedKeyPluginInSimulator({
      ...TOY,
      program: [
        { op: 'repeat', count: 64, body: [{ op: 'repeat', count: 64, body: [{ op: 'not' }] }] },
        { op: 'store' },
      ],
    });
    expect(r).toMatchObject({ ok: false, key: null });
    expect(r.message).toMatch(/^Failed in the simulator: .*4096 steps/);
  });
});
