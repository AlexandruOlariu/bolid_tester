/** The vehicle registry. Add a car by creating its profile and registering it here (and writing the
 *  matching docs/vehicles/<id>.md — kept in sync by the vehicle-docs-sync test). Cars the user adds
 *  on the phone are *garage* vehicles (`userVehicle.ts`), resolved over this registry by
 *  `resolve.ts` (plan 06). */

import { VehicleProfile } from './types';
import { generic } from './generic';
import { golfPlus2009 } from './golf-plus-2009-20tdi';
import { fiatPunto2008 } from './fiat-punto-2008-12';
import { passatB55 } from './passat-b55-19tdi';
import { tiguan2014 } from './tiguan-2014-20tdi';
import { golf6Tsi } from './golf-6-2010-14tsi';
import { isUserVehicleId } from './userVehicle';

export const VEHICLE_PROFILES: VehicleProfile[] = [
  generic,
  golfPlus2009,
  fiatPunto2008,
  passatB55,
  tiguan2014,
  golf6Tsi,
];

export const VEHICLE_REGISTRY: Record<string, VehicleProfile> = Object.fromEntries(
  VEHICLE_PROFILES.map((p) => [p.id, p]),
);

export function getVehicleProfile(id: string): VehicleProfile {
  return VEHICLE_REGISTRY[id] ?? generic;
}

/** Human label for a profile, used in dashboards and history (e.g. "VW Golf Plus 2009 (2009)"
 *  or "Auto / Generic OBD2"). A garage car whose name already carries its year ("Volkswagen 2009",
 *  the learned default) is not suffixed again. */
export function vehicleLabel(profile: VehicleProfile): string {
  if (profile.id === 'generic') return 'Auto / Generic OBD2';
  const year = profile.year ? String(profile.year) : '';
  if (!year || (isUserVehicleId(profile.id) && profile.name.includes(year))) return profile.name;
  return `${profile.name} (${year})`;
}

export * from './types';
export * from './vinSuggest';
export * from './userVehicle';
export * from './loginBook';
export * from './confirmation';
