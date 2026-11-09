/** Garage store (plan 06). Node-safe like the other store tests: the file system behind the persist
 *  storage is an in-memory map, which also lets the rehydration tests run the real `merge`. */
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

import { readAsStringAsync } from 'expo-file-system/legacy';
import { resolveProfile, simulatorSourceFor } from '@/shared/vehicles/resolve';
import {
  garageExportJson,
  sanitizeGarage,
  useGarageStore,
  type NewUserVehicle,
} from './garageStore';

const GARAGE_FILE = '/tmp/bolid-test/bolid.garage.json';

const LOGAN: NewUserVehicle = { name: 'Dacia Logan', fuel: 'petrol', baseProfileId: 'generic' };

beforeEach(() => {
  files.clear();
  useGarageStore.setState({ vehicles: [] });
});

describe('garageStore', () => {
  it('add returns a user: id with timestamps and stores the car', () => {
    const v = useGarageStore.getState().add(LOGAN);
    expect(v.id.startsWith('user:')).toBe(true);
    expect(v.createdAt).toBe(v.updatedAt);
    expect(useGarageStore.getState().vehicles).toEqual([v]);
    const w = useGarageStore.getState().add(LOGAN);
    expect(w.id).not.toBe(v.id);
  });

  it('update patches fields and bumps updatedAt, never id or createdAt', () => {
    const v = useGarageStore.getState().add(LOGAN);
    useGarageStore.getState().update(v.id, { name: 'Logan MCV', year: 2015 });
    const u = useGarageStore.getState().vehicles[0];
    expect(u.name).toBe('Logan MCV');
    expect(u.year).toBe(2015);
    expect(u.id).toBe(v.id);
    expect(u.createdAt).toBe(v.createdAt);
    expect(u.updatedAt).toBeGreaterThan(v.updatedAt);
  });

  it('setLearned stores the identity and bumps updatedAt', () => {
    const v = useGarageStore.getState().add(LOGAN);
    const learned = {
      protocol: 'ISO_15765_4_CAN_11_500' as const,
      supportedPids: ['010C'],
      vin: 'UU1LSDAAH12345678',
      calibrationId: null,
      learnedAt: 7,
    };
    useGarageStore.getState().setLearned(v.id, learned);
    const u = useGarageStore.getState().vehicles[0];
    expect(u.learned).toEqual(learned);
    expect(u.updatedAt).toBeGreaterThan(v.updatedAt);
  });

  it('remove drops only that car', () => {
    const a = useGarageStore.getState().add(LOGAN);
    const b = useGarageStore.getState().add({ ...LOGAN, name: 'Other' });
    useGarageStore.getState().remove(a.id);
    expect(useGarageStore.getState().vehicles.map((v) => v.id)).toEqual([b.id]);
  });

  it('persists as bolid.garage v1 and rehydrates the cars', async () => {
    const v = useGarageStore.getState().add(LOGAN);
    const blob = JSON.parse(files.get(GARAGE_FILE) ?? '{}');
    expect(blob.version).toBe(1);
    expect(blob.state.vehicles[0].id).toBe(v.id);

    useGarageStore.setState({ vehicles: [] });
    files.set(GARAGE_FILE, JSON.stringify(blob));
    await useGarageStore.persist.rehydrate();
    expect(useGarageStore.getState().vehicles.map((x) => x.id)).toEqual([v.id]);
  });

  it('sanitizeGarage drops records without a usable id / name / base', () => {
    const kept = {
      id: 'user:a',
      name: 'A',
      baseProfileId: 'generic',
      fuel: 'petrol',
      createdAt: 1,
      updatedAt: 1,
    };
    expect(
      sanitizeGarage({
        vehicles: [
          kept,
          { id: 'golf-plus-2009-20tdi', name: 'x', baseProfileId: 'generic' },
          null,
          3,
        ],
      }),
    ).toEqual([kept]);
    expect(sanitizeGarage(null)).toEqual([]);
    expect(sanitizeGarage({ vehicles: 'nope' })).toEqual([]);
  });

  it('sanitizeGarage strips a malformed learned block and keeps the car', () => {
    const base = {
      name: 'A',
      baseProfileId: 'generic',
      fuel: 'petrol',
      createdAt: 1,
      updatedAt: 1,
    };
    const good = {
      ...base,
      id: 'user:good',
      learned: {
        protocol: 'ISO_15765_4_CAN_11_500',
        supportedPids: ['010C'],
        vin: null,
        calibrationId: null,
        learnedAt: 1,
      },
    };
    const out = sanitizeGarage({
      vehicles: [
        good,
        { ...base, id: 'user:no-pids', learned: { protocol: 'AUTO', vin: null, learnedAt: 1 } },
        { ...base, id: 'user:bad-pids', learned: { ...good.learned, supportedPids: [1, 2] } },
        { ...base, id: 'user:not-object', learned: 'x' },
      ],
    });
    expect(out.map((v) => v.id)).toEqual([
      'user:good',
      'user:no-pids',
      'user:bad-pids',
      'user:not-object',
    ]);
    expect(out[0]).toEqual(good);
    expect(out.slice(1).every((v) => !('learned' in v))).toBe(true);
    // The stripped cars resolve and build like any unlearned car.
    expect(resolveProfile('user:no-pids', out).id).toBe('user:no-pids');
    expect(simulatorSourceFor('user:no-pids', out)).toEqual({
      profileId: 'generic',
      overrides: {},
    });
  });

  it('sanitizeGarage keeps well-formed discovered modules and drops the rest (plan 25)', () => {
    const base = {
      name: 'A',
      baseProfileId: 'generic',
      fuel: 'petrol',
      createdAt: 1,
      updatedAt: 1,
    };
    const hvac = {
      address: '08',
      name: 'HVAC',
      transport: 'uds',
      reqHeader: '746',
      rxFilter: '7B0',
      experimental: true,
    };
    const out = sanitizeGarage({
      vehicles: [
        { ...base, id: 'user:a', modules: [hvac, { address: 'x' }] },
        { ...base, id: 'user:b', modules: [{ address: 'x' }] },
      ],
    });
    expect(out[0].modules).toEqual([hvac]);
    expect('modules' in out[1]).toBe(false);
    expect(resolveProfile('user:a', out).modules).toEqual([hvac]);
  });

  it('rehydration keeps a car added during the async read and drops malformed records', async () => {
    const stored = {
      id: 'user:stored',
      name: 'Stored',
      baseProfileId: 'generic',
      fuel: 'diesel',
      createdAt: 1,
      updatedAt: 1,
    };
    const blob = JSON.stringify({
      state: { vehicles: [stored, { id: 'not-a-user-id', name: 'x', baseProfileId: 'generic' }] },
      version: 1,
    });
    files.set(GARAGE_FILE, blob);
    // The add below rewrites the file synchronously; the in-flight read still sees the old content.
    (readAsStringAsync as jest.Mock).mockImplementationOnce(async () => blob);

    const pending = useGarageStore.persist.rehydrate();
    const added = useGarageStore.getState().add(LOGAN);
    await pending;

    expect(useGarageStore.getState().vehicles.map((v) => v.id)).toEqual([stored.id, added.id]);
    const saved = JSON.parse(files.get(GARAGE_FILE) ?? '{}');
    expect(saved.state.vehicles.map((v: { id: string }) => v.id)).toEqual([stored.id, added.id]);
  });

  it('exports the garage as tagged JSON', () => {
    const v = useGarageStore.getState().add(LOGAN);
    const out = JSON.parse(
      garageExportJson(useGarageStore.getState().vehicles, Date.UTC(2026, 10, 9)),
    );
    expect(out.kind).toBe('bolid.garage');
    expect(out.version).toBe(1);
    expect(out.exportedAt).toBe('2026-11-09T00:00:00.000Z');
    expect(out.vehicles).toEqual([v]);
  });
});
