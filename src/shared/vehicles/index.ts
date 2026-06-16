/** The vehicle registry. Add a car by creating its profile and registering it here (and writing the
 *  matching docs/vehicles/<id>.md — kept in sync by the vehicle-docs-sync test). */

import { VehicleProfile } from './types';
import { generic } from './generic';
import { golfPlus2009 } from './golf-plus-2009-20tdi';
import { fiatPunto2008 } from './fiat-punto-2008-12';
import { passatB55 } from './passat-b55-19tdi';

export const VEHICLE_PROFILES: VehicleProfile[] = [
  generic,
  golfPlus2009,
  fiatPunto2008,
  passatB55,
];

export const VEHICLE_REGISTRY: Record<string, VehicleProfile> = Object.fromEntries(
  VEHICLE_PROFILES.map((p) => [p.id, p]),
);

export function getVehicleProfile(id: string): VehicleProfile {
  return VEHICLE_REGISTRY[id] ?? generic;
}

/** Human label for a profile, used in dashboards and history (e.g. "VW Golf Plus 2009 (2009)"
 *  or "Auto / Generic OBD2"). */
export function vehicleLabel(profile: VehicleProfile): string {
  return profile.id === 'generic'
    ? 'Auto / Generic OBD2'
    : `${profile.name}${profile.year ? ` (${profile.year})` : ''}`;
}

export * from './types';
