/** Per-car maintenance logbook (plan 06): buckets per vehicle key, and the v1 → v2 migration of a
 *  real v1 file (one global logbook) under the car that was selected — whichever of the two stores
 *  hydrates first. The file system behind the persist storage is an in-memory map. */
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

import { useGarageStore } from '@/shared/state/garageStore';
import { useVehicleStore } from '@/shared/state/vehicleStore';
import {
  LEGACY_PENDING_KEY,
  MAINTENANCE_VERSION,
  bucketFor,
  consolidate,
  maintenanceKeysFor,
  migrateMaintenance,
  useMaintenanceStore,
} from './maintenanceStore';

const MAINT_FILE = '/tmp/bolid-test/bolid.maintenance.json';
const VEHICLE_FILE = '/tmp/bolid-test/bolid.vehicle.json';

/** Exactly what plan-05-era code wrote: v1 partialize = { entries, odoKm, kmPerYear }. */
const V1_BLOB = {
  state: {
    entries: [
      { id: 'e2', itemId: 'oil', date: 2000, odoKm: 210000 },
      { id: 'e1', itemId: 'brake-fluid', date: 1000, odoKm: 200000 },
    ],
    odoKm: 215000,
    kmPerYear: 12000,
  },
  version: 1,
};

const GOLF_KEY = 'id:golf-plus-2009-20tdi';

beforeEach(() => {
  files.clear();
  useGarageStore.setState({ vehicles: [] });
  useVehicleStore.setState({ selectedProfileId: 'generic' });
  useMaintenanceStore.setState({ byVehicle: {} });
  files.clear();
});

describe('maintenanceKeysFor', () => {
  it('a registry profile is keyed by id', () => {
    expect(maintenanceKeysFor('golf-plus-2009-20tdi', [])).toEqual([GOLF_KEY]);
  });

  it('a learned garage car is keyed by VIN, with its id key as an alias', () => {
    const car = {
      id: 'user:a',
      name: 'A',
      fuel: 'petrol' as const,
      baseProfileId: 'generic',
      createdAt: 1,
      updatedAt: 1,
      learned: {
        protocol: 'AUTO' as const,
        supportedPids: [],
        vin: 'WVWZZZ1KZ9W903398',
        calibrationId: null,
        learnedAt: 1,
      },
    };
    expect(maintenanceKeysFor('user:a', [car])).toEqual(['vin:WVWZZZ1KZ9W903398', 'id:user:a']);
    expect(maintenanceKeysFor('user:a', [{ ...car, learned: undefined }])).toEqual(['id:user:a']);
  });
});

describe('per-car buckets', () => {
  it('entries added for car A are not shown for car B', () => {
    const s = useMaintenanceStore.getState();
    s.addEntry(['id:A'], { itemId: 'oil', date: 1, odoKm: 100 });
    s.setOdometer(['id:A'], 150);
    const { byVehicle } = useMaintenanceStore.getState();
    expect(bucketFor(byVehicle, ['id:A']).entries).toHaveLength(1);
    expect(bucketFor(byVehicle, ['id:A']).odoKm).toBe(150);
    expect(bucketFor(byVehicle, ['id:B']).entries).toEqual([]);
    expect(bucketFor(byVehicle, ['id:B']).odoKm).toBeNull();
  });

  it('a logbook started before the car was learned is folded into the VIN key on the next edit', () => {
    const s = useMaintenanceStore.getState();
    s.addEntry(['id:user:a'], { itemId: 'oil', date: 1, odoKm: 100 });
    const keys = ['vin:X', 'id:user:a'];
    // Read falls back to the alias before any write.
    expect(bucketFor(useMaintenanceStore.getState().byVehicle, keys).entries).toHaveLength(1);
    s.addEntry(keys, { itemId: 'tyres', date: 2, odoKm: 200 });
    const { byVehicle } = useMaintenanceStore.getState();
    expect(byVehicle['id:user:a']).toBeUndefined();
    expect(byVehicle['vin:X'].entries.map((e) => e.itemId)).toEqual(['tyres', 'oil']);
  });

  it('consolidate keeps the primary odometer and merges entries newest first', () => {
    const out = consolidate(
      {
        p: { entries: [{ id: 'a', itemId: 'oil', date: 1, odoKm: 1 }], odoKm: 10, kmPerYear: 1 },
        q: { entries: [{ id: 'b', itemId: 'oil', date: 5, odoKm: 5 }], odoKm: 99, kmPerYear: 2 },
      },
      ['p', 'q'],
    );
    expect(Object.keys(out)).toEqual(['p']);
    expect(out.p.odoKm).toBe(10);
    expect(out.p.entries.map((e) => e.id)).toEqual(['b', 'a']);
  });
});

describe('v1 → v2 migration', () => {
  it('pure: moves the global logbook under the given key; an empty v1 yields nothing', () => {
    expect(migrateMaintenance(V1_BLOB.state, 1, GOLF_KEY)).toEqual({
      byVehicle: { [GOLF_KEY]: V1_BLOB.state },
    });
    expect(migrateMaintenance({ entries: [], odoKm: null, kmPerYear: 15000 }, 1, GOLF_KEY)).toEqual(
      {
        byVehicle: {},
      },
    );
    const v2 = { byVehicle: { [GOLF_KEY]: V1_BLOB.state } };
    expect(migrateMaintenance(v2, 2, 'ignored')).toEqual(v2);
  });

  it('persists at v2', () => {
    expect(MAINTENANCE_VERSION).toBe(2);
    expect(useMaintenanceStore.persist.getOptions().version).toBe(2);
  });

  it('a v1 file keeps its entries under the car selected at upgrade (vehicle store first)', async () => {
    files.set(
      VEHICLE_FILE,
      JSON.stringify({ state: { selectedProfileId: 'golf-plus-2009-20tdi' }, version: 1 }),
    );
    files.set(MAINT_FILE, JSON.stringify(V1_BLOB));
    await useVehicleStore.persist.rehydrate();
    await useMaintenanceStore.persist.rehydrate();

    const { byVehicle } = useMaintenanceStore.getState();
    expect(Object.keys(byVehicle)).toEqual([GOLF_KEY]);
    expect(byVehicle[GOLF_KEY].entries.map((e) => e.id)).toEqual(['e2', 'e1']);
    expect(byVehicle[GOLF_KEY].odoKm).toBe(215000);
    expect(byVehicle[GOLF_KEY].kmPerYear).toBe(12000);
    // Another car sees an empty logbook.
    expect(bucketFor(byVehicle, ['id:fiat-punto-2008-12']).entries).toEqual([]);
    // The file is rewritten in the v2 shape and the vehicle selection is untouched.
    expect(JSON.parse(files.get(MAINT_FILE) ?? '{}').version).toBe(2);
    expect(useVehicleStore.getState().selectedProfileId).toBe('golf-plus-2009-20tdi');
  });

  it('a v1 file that hydrates before the vehicle store is adopted once the selection is known', async () => {
    files.set(
      VEHICLE_FILE,
      JSON.stringify({ state: { selectedProfileId: 'fiat-punto-2008-12' }, version: 1 }),
    );
    files.set(MAINT_FILE, JSON.stringify(V1_BLOB));
    // Simulate a vehicle store that has not hydrated yet.
    const hasHydrated = jest.spyOn(useVehicleStore.persist, 'hasHydrated').mockReturnValue(false);
    await useMaintenanceStore.persist.rehydrate();
    expect(Object.keys(useMaintenanceStore.getState().byVehicle)).toEqual([LEGACY_PENDING_KEY]);

    hasHydrated.mockRestore();
    await useVehicleStore.persist.rehydrate();
    const { byVehicle } = useMaintenanceStore.getState();
    expect(Object.keys(byVehicle)).toEqual(['id:fiat-punto-2008-12']);
    expect(byVehicle['id:fiat-punto-2008-12'].entries).toHaveLength(2);
  });
});
