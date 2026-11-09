/** The active vehicle profile (plan 06): `vehicleStore.selectedProfileId` resolved over the registry
 *  and the garage (`resolveProfile`). Every feature reads the car through these two helpers instead
 *  of `getVehicleProfile(selectedProfileId)`, so a garage car (`user:` id) behaves like a registry
 *  profile everywhere. Lives in shared/state so a feature reads the active car without importing
 *  the vehicle-select slice (`features/vehicle-select/api/activeProfile.ts` re-exports it). See
 *  docs/features/vehicle-select.md. */
import { useMemo } from 'react';
import { useGarageStore } from '@/shared/state/garageStore';
import { resolveProfile } from '@/shared/vehicles/resolve';
import { vehicleLabel, type UserVehicle, type VehicleProfile } from '@/shared/vehicles';
import type { HistoryVehicle } from './historyStore';
import { useSessionStore } from './sessionStore';
import { useVehicleStore } from './vehicleStore';

/** Single-entry cache keyed on the (id, garage list) pair, so the hook and the non-hook helper hand
 *  out the same object until the selection or the garage changes — stable for effect deps. */
let cache: { id: string; vehicles: UserVehicle[]; profile: VehicleProfile } | null = null;

function resolveCached(id: string, vehicles: UserVehicle[]): VehicleProfile {
  if (cache && cache.id === id && cache.vehicles === vehicles) return cache.profile;
  const profile = resolveProfile(id, vehicles);
  cache = { id, vehicles, profile };
  return profile;
}

/** Non-hook: the active profile right now (services, EngineHost loops, event handlers). */
export function getActiveProfile(): VehicleProfile {
  return resolveCached(
    useVehicleStore.getState().selectedProfileId,
    useGarageStore.getState().vehicles,
  );
}

/** Hook: the active profile, re-resolved when the selection or the garage changes. */
export function useActiveProfile(): VehicleProfile {
  const id = useVehicleStore((s) => s.selectedProfileId);
  const vehicles = useGarageStore((s) => s.vehicles);
  return useMemo(() => resolveCached(id, vehicles), [id, vehicles]);
}

/** The garage record behind the active selection, or null for a registry profile. */
export function getActiveUserVehicle(): UserVehicle | null {
  const id = useVehicleStore.getState().selectedProfileId;
  return useGarageStore.getState().vehicles.find((v) => v.id === id) ?? null;
}

/** The car an in-memory result belongs to, stamped when the result is published (fault read,
 *  inspection, battery test, AI run): the active profile plus the live session's VIN, if any. The
 *  unified vehicle report (plan 15) only uses an in-memory result whose stamp matches the car it is
 *  built for, so switching the garage selection never files car A's results under car B. */
export function activeCarStamp(): HistoryVehicle {
  const profile = getActiveProfile();
  return {
    id: profile.id,
    label: vehicleLabel(profile),
    vin: useSessionStore.getState().info?.vin ?? null,
  };
}
