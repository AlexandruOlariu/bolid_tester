/** "My garage" (plan 06): the cars the user added on this phone — learned from a live connection or
 *  entered by hand. Each is a `UserVehicle` (src/shared/vehicles/userVehicle.ts) resolved into a
 *  runtime profile over its registry base by `resolveProfile`. Lives in shared/state (not the
 *  vehicle-select slice) because EngineHost and the feature services resolve the active profile.
 *  Persisted as `bolid.garage` (v1). See docs/features/vehicle-select.md. */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { fileStateStorage } from './persistStorage';
import {
  USER_VEHICLE_PREFIX,
  sanitizeUserModules,
  type LearnedIdentity,
  type UserVehicle,
} from '@/shared/vehicles/userVehicle';
import { sanitizeLoginCodes } from '@/shared/vehicles/loginBook';
import { PROTOCOL_LABELS, type ProtocolId } from '@/shared/obd-core/obd/protocols';

export const GARAGE_VERSION = 1;

export type NewUserVehicle = Omit<UserVehicle, 'id' | 'createdAt' | 'updatedAt'>;
export type UserVehiclePatch = Partial<Omit<UserVehicle, 'id' | 'createdAt'>>;

interface GarageState {
  vehicles: UserVehicle[];
  add: (v: NewUserVehicle) => UserVehicle;
  update: (id: string, patch: UserVehiclePatch) => void;
  /** Replace every field of car `id` with `v` (an imported profile, plan 13), keeping its id and
   *  `createdAt`; a field `v` lacks (e.g. `learned`) is gone afterwards. The code book is kept:
   *  login codes never travel in a profile file. */
  replace: (id: string, v: NewUserVehicle) => void;
  remove: (id: string) => void;
  setLearned: (id: string, learned: LearnedIdentity) => void;
}

function newUserVehicleId(): string {
  return `${USER_VEHICLE_PREFIX}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Strictly later than `prev`, so two edits inside the same millisecond still order. */
function bump(prev: number): number {
  return Math.max(Date.now(), prev + 1);
}

const isStringOrNull = (x: unknown): x is string | null => x === null || typeof x === 'string';
const KNOWN_PROTOCOLS = new Set<string>(Object.keys(PROTOCOL_LABELS));

/** A persisted learned identity, rebuilt field by field, or undefined when it cannot be trusted
 *  (readers index `learned.supportedPids` / `learned.protocol` without further checks, and the
 *  simulator replays them). Dropped: not an object, a protocol that is not a known `ProtocolId`, no
 *  `supportedPids` string array, a VIN / calibration id of the wrong type, no finite `learnedAt`.
 *  Repaired: a missing VIN / calibration id becomes null, a non-string adapter version is left out,
 *  and unknown fields are not carried over. */
export function sanitizeLearned(raw: unknown): LearnedIdentity | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const l = raw as Record<string, unknown>;
  const vin = l.vin === undefined ? null : l.vin;
  const calibrationId = l.calibrationId === undefined ? null : l.calibrationId;
  if (
    typeof l.protocol !== 'string' ||
    !KNOWN_PROTOCOLS.has(l.protocol) ||
    !Array.isArray(l.supportedPids) ||
    !l.supportedPids.every((p) => typeof p === 'string') ||
    !isStringOrNull(vin) ||
    !isStringOrNull(calibrationId) ||
    typeof l.learnedAt !== 'number' ||
    !Number.isFinite(l.learnedAt)
  ) {
    return undefined;
  }
  return {
    protocol: l.protocol as ProtocolId,
    supportedPids: [...(l.supportedPids as string[])],
    vin,
    calibrationId,
    ...(typeof l.adapterVersion === 'string' ? { adapterVersion: l.adapterVersion } : {}),
    learnedAt: l.learnedAt,
  };
}

/** The car with its code book (plan 22) reduced to well-formed entries, or without one. */
function withSaneLoginCodes(v: UserVehicle): UserVehicle {
  if (v.loginCodes === undefined) return v;
  const loginCodes = sanitizeLoginCodes(v.loginCodes);
  const { loginCodes: _raw, ...rest } = v;
  return loginCodes ? { ...rest, loginCodes } : rest;
}

/** The car with its discovered modules (plan 25) reduced to well-formed entries, or without. */
function withSaneModules(v: UserVehicle): UserVehicle {
  if (v.modules === undefined) return v;
  const modules = sanitizeUserModules(v.modules);
  const { modules: _raw, ...rest } = v;
  return modules ? { ...rest, modules } : rest;
}

/** Keep only well-formed garage records from a persisted blob (a hand-edited or truncated file must
 *  not crash profile resolution or the Vehicle screen). A record without a usable id / name / base
 *  is dropped; a malformed `learned` block is stripped and the car kept as an unlearned one;
 *  malformed login codes and discovered modules are dropped. */
export function sanitizeGarage(persisted: unknown): UserVehicle[] {
  const list = (persisted as { vehicles?: unknown } | null)?.vehicles;
  if (!Array.isArray(list)) return [];
  const out: UserVehicle[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const v = raw as UserVehicle;
    if (
      typeof v.id !== 'string' ||
      !v.id.startsWith(USER_VEHICLE_PREFIX) ||
      typeof v.name !== 'string' ||
      typeof v.baseProfileId !== 'string'
    ) {
      continue;
    }
    const car = withSaneModules(withSaneLoginCodes(v));
    if (car.learned === undefined) {
      out.push(car);
      continue;
    }
    const learned = sanitizeLearned(car.learned);
    if (learned) {
      out.push({ ...car, learned });
    } else {
      const { learned: _dropped, ...rest } = car;
      out.push(rest);
    }
  }
  return out;
}

/** Set by `merge` when a car was added during the rehydration window. That add already rewrote the
 *  file with only the new car, and zustand writes after hydration only on a migration, so the merged
 *  list is written back once hydration finishes, or the stored cars are gone on the next launch. */
let rewriteAfterHydration = false;

export const useGarageStore = create<GarageState>()(
  persist(
    (set) => ({
      vehicles: [],
      add: (v) => {
        const now = Date.now();
        const vehicle: UserVehicle = {
          ...v,
          id: newUserVehicleId(),
          createdAt: now,
          updatedAt: now,
        };
        set((s) => ({ vehicles: [...s.vehicles, vehicle] }));
        return vehicle;
      },
      update: (id, patch) =>
        set((s) => ({
          vehicles: s.vehicles.map((v) =>
            v.id === id
              ? { ...v, ...patch, id: v.id, createdAt: v.createdAt, updatedAt: bump(v.updatedAt) }
              : v,
          ),
        })),
      replace: (id, next) =>
        set((s) => ({
          vehicles: s.vehicles.map((v) =>
            v.id === id
              ? {
                  ...next,
                  ...(v.loginCodes && next.loginCodes === undefined
                    ? { loginCodes: v.loginCodes }
                    : {}),
                  id: v.id,
                  createdAt: v.createdAt,
                  updatedAt: bump(v.updatedAt),
                }
              : v,
          ),
        })),
      remove: (id) => set((s) => ({ vehicles: s.vehicles.filter((v) => v.id !== id) })),
      setLearned: (id, learned) =>
        set((s) => ({
          vehicles: s.vehicles.map((v) =>
            v.id === id ? { ...v, learned, updatedAt: bump(v.updatedAt) } : v,
          ),
        })),
    }),
    {
      name: 'bolid.garage',
      version: GARAGE_VERSION,
      storage: createJSONStorage(() => fileStateStorage),
      partialize: (s) => ({ vehicles: s.vehicles }),
      // A car added during the async rehydration window lives in `current`; keep it alongside the
      // persisted list (dedupe by id) instead of letting the file overwrite it.
      merge: (persisted, current) => {
        const stored = sanitizeGarage(persisted);
        const ids = new Set(stored.map((v) => v.id));
        const addedMeanwhile = current.vehicles.filter((v) => !ids.has(v.id));
        rewriteAfterHydration = addedMeanwhile.length > 0;
        return { ...current, vehicles: [...stored, ...addedMeanwhile] };
      },
    },
  ),
);

useGarageStore.persist.onFinishHydration((state) => {
  if (!rewriteAfterHydration) return;
  rewriteAfterHydration = false;
  useGarageStore.setState({ vehicles: [...state.vehicles] });
});

/** Serialise the garage for **Share garage as JSON** (a whole-garage file; single cars travel as
 *  `bolid.profile.v1` files, plan 13). */
export function garageExportJson(vehicles: UserVehicle[], now: number = Date.now()): string {
  return JSON.stringify(
    {
      kind: 'bolid.garage',
      version: GARAGE_VERSION,
      exportedAt: new Date(now).toISOString(),
      vehicles,
    },
    null,
    2,
  );
}
