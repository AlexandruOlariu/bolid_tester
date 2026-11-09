/** Maintenance logbook, **per car** (plan 06). Each car's entries, odometer and yearly mileage live
 *  in their own bucket of `byVehicle`, keyed like history: `vin:<VIN>` for a garage car learned with
 *  a VIN, else `id:<profile id>` (see `maintenanceKeysFor`). The service catalogue (`items`) is
 *  shared and never persisted, so it stays fresh across launches.
 *
 *  Persisted as `bolid.maintenance` v2. A v1 file (one global logbook) is moved under the car that
 *  was selected when the upgrade ran; when the vehicle store has not hydrated yet at that moment the
 *  bucket is parked under `LEGACY_PENDING_KEY` and adopted as soon as it has. See
 *  docs/features/maintenance-log.md. */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { fileStateStorage } from '@/shared/state/persistStorage';
import { useGarageStore } from '@/shared/state/garageStore';
import { historyVehicleKey } from '@/shared/state/historyStore';
import { DEFAULT_SERVICE_ITEMS, ServiceItem, LogEntry } from '@/shared/obd-core';
import type { UserVehicle } from '@/shared/vehicles';
import { useVehicleStore } from '@/shared/state/vehicleStore';

export const MAINTENANCE_VERSION = 2;
export const DEFAULT_KM_PER_YEAR = 15000;
/** Bucket key of a v1 logbook whose car is not known yet (vehicle store still hydrating). */
export const LEGACY_PENDING_KEY = 'legacy:v1';

export interface MaintenanceBucket {
  entries: LogEntry[];
  odoKm: number | null;
  kmPerYear: number;
}

export const EMPTY_BUCKET: MaintenanceBucket = {
  entries: [],
  odoKm: null,
  kmPerYear: DEFAULT_KM_PER_YEAR,
};

/** Bucket keys for a vehicle id, primary first. A garage car learned with a VIN is keyed by the VIN
 *  (so a re-learn of the same car shares its logbook); its `id:` key stays as an alias so a logbook
 *  started before the car was learned is not lost. A registry profile is keyed by its id. */
export function maintenanceKeysFor(profileId: string, vehicles: UserVehicle[]): string[] {
  const idKey = historyVehicleKey({ id: profileId, label: '', vin: null });
  const vin = vehicles.find((v) => v.id === profileId)?.learned?.vin ?? null;
  if (!vin) return [idKey];
  return [historyVehicleKey({ id: profileId, label: '', vin }), idKey];
}

/** The bucket to show for `keys` (primary first): the first key that has one, else empty. */
export function bucketFor(
  byVehicle: Record<string, MaintenanceBucket>,
  keys: string[],
): MaintenanceBucket {
  for (const k of keys) if (byVehicle[k]) return byVehicle[k];
  return EMPTY_BUCKET;
}

/** Fold every alias bucket into the primary key (entries concatenated newest-first, the primary's
 *  odometer winning) and drop the aliases. Pure. */
export function consolidate(
  byVehicle: Record<string, MaintenanceBucket>,
  keys: string[],
): Record<string, MaintenanceBucket> {
  const [primary, ...aliases] = keys;
  const present = aliases.filter((k) => byVehicle[k]);
  if (!primary || present.length === 0) return byVehicle;
  const out = { ...byVehicle };
  let merged = out[primary];
  for (const k of present) {
    const alias = out[k];
    merged = merged
      ? {
          entries: [...merged.entries, ...alias.entries].sort((a, b) => b.date - a.date),
          odoKm: merged.odoKm ?? alias.odoKm,
          kmPerYear: merged.kmPerYear,
        }
      : alias;
    delete out[k];
  }
  out[primary] = merged;
  return out;
}

/** Step a persisted blob up to v2. v1 (`{ entries, odoKm, kmPerYear }`, one global logbook) moves
 *  under `legacyKey`; an empty v1 logbook yields no bucket at all. Pure. */
export function migrateMaintenance(
  persisted: unknown,
  fromVersion: number,
  legacyKey: string,
): { byVehicle: Record<string, MaintenanceBucket> } {
  const p = (persisted ?? {}) as Partial<MaintenanceBucket> & {
    byVehicle?: Record<string, MaintenanceBucket>;
  };
  if (fromVersion >= 2) return { byVehicle: p.byVehicle ?? {} };
  const entries = Array.isArray(p.entries) ? p.entries : [];
  const odoKm = typeof p.odoKm === 'number' ? p.odoKm : null;
  const kmPerYear = typeof p.kmPerYear === 'number' ? p.kmPerYear : DEFAULT_KM_PER_YEAR;
  if (entries.length === 0 && odoKm === null && kmPerYear === DEFAULT_KM_PER_YEAR) {
    return { byVehicle: {} };
  }
  return { byVehicle: { [legacyKey]: { entries, odoKm, kmPerYear } } };
}

/** Where a v1 logbook goes right now: the selected car's key once the vehicle store has hydrated,
 *  else the pending key (adopted later by `adoptLegacyBucket`). */
function legacyKeyNow(): string {
  if (!useVehicleStore.persist?.hasHydrated()) return LEGACY_PENDING_KEY;
  return maintenanceKeysFor(
    useVehicleStore.getState().selectedProfileId,
    useGarageStore.getState().vehicles,
  )[0];
}

interface MaintenanceState {
  items: ServiceItem[];
  byVehicle: Record<string, MaintenanceBucket>;
  /** Every action takes the car's bucket keys (`maintenanceKeysFor`, primary first). */
  setOdometer: (keys: string[], v: number | null) => void;
  setKmPerYear: (keys: string[], v: number) => void;
  addEntry: (keys: string[], e: Omit<LogEntry, 'id'>) => void;
  removeEntry: (keys: string[], id: string) => void;
}

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Apply `fn` to the car's (consolidated) primary bucket. */
function withBucket(
  byVehicle: Record<string, MaintenanceBucket>,
  keys: string[],
  fn: (b: MaintenanceBucket) => MaintenanceBucket,
): Record<string, MaintenanceBucket> {
  const next = consolidate(byVehicle, keys);
  const primary = keys[0];
  return { ...next, [primary]: fn(next[primary] ?? EMPTY_BUCKET) };
}

export const useMaintenanceStore = create<MaintenanceState>()(
  persist(
    (set) => ({
      items: DEFAULT_SERVICE_ITEMS,
      byVehicle: {},
      setOdometer: (keys, odoKm) =>
        set((s) => ({ byVehicle: withBucket(s.byVehicle, keys, (b) => ({ ...b, odoKm })) })),
      setKmPerYear: (keys, kmPerYear) =>
        set((s) => ({ byVehicle: withBucket(s.byVehicle, keys, (b) => ({ ...b, kmPerYear })) })),
      addEntry: (keys, e) =>
        set((s) => ({
          byVehicle: withBucket(s.byVehicle, keys, (b) => ({
            ...b,
            entries: [{ id: newId(), ...e }, ...b.entries],
          })),
        })),
      removeEntry: (keys, id) =>
        set((s) => ({
          byVehicle: withBucket(s.byVehicle, keys, (b) => ({
            ...b,
            entries: b.entries.filter((x) => x.id !== id),
          })),
        })),
    }),
    {
      name: 'bolid.maintenance',
      version: MAINTENANCE_VERSION,
      storage: createJSONStorage(() => fileStateStorage),
      migrate: (persisted, version) =>
        migrateMaintenance(persisted, version, legacyKeyNow()) as unknown as MaintenanceState,
      // Keep the default catalogue fresh across launches; only the per-car logbooks are user data.
      partialize: (s) => ({ byVehicle: s.byVehicle }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as { byVehicle?: Record<string, MaintenanceBucket> };
        return { ...current, byVehicle: { ...current.byVehicle, ...(p.byVehicle ?? {}) } };
      },
    },
  ),
);

/** Move a parked v1 logbook (`LEGACY_PENDING_KEY`) under the selected car once both stores have
 *  hydrated. Idempotent; wired to both stores' hydration below, exported for tests. */
export function adoptLegacyBucket(): void {
  if (!useVehicleStore.persist?.hasHydrated() || !useMaintenanceStore.persist?.hasHydrated())
    return;
  const { byVehicle } = useMaintenanceStore.getState();
  if (!byVehicle[LEGACY_PENDING_KEY]) return;
  const keys = maintenanceKeysFor(
    useVehicleStore.getState().selectedProfileId,
    useGarageStore.getState().vehicles,
  );
  useMaintenanceStore.setState({
    byVehicle: consolidate(byVehicle, [keys[0], LEGACY_PENDING_KEY]),
  });
}

useMaintenanceStore.persist?.onFinishHydration(adoptLegacyBucket);
useVehicleStore.persist?.onFinishHydration(adoptLegacyBucket);
