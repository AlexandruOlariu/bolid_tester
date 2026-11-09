/** Resolve any vehicle id the app stores — a registry profile id or a garage `user:` id — into the
 *  runtime `VehicleProfile` every feature reads (plan 06). Pure: the caller passes the garage list. */

import type { SimScenario } from '../obd-core/transport/MockTransport';
import { VEHICLE_REGISTRY, getVehicleProfile } from './index';
import type { VehicleProfile } from './types';
import { buildUserProfile, type UserVehicle } from './userVehicle';

/** Registry hit, else a garage vehicle built on its base profile, else `generic` (an unknown id —
 *  e.g. a garage car that was deleted while selected — falls back like `getVehicleProfile`). */
export function resolveProfile(id: string, userVehicles: UserVehicle[]): VehicleProfile {
  const registry = VEHICLE_REGISTRY[id];
  if (registry) return registry;
  const user = userVehicles.find((v) => v.id === id);
  if (user) return buildUserProfile(user, getVehicleProfile(user.baseProfileId));
  return getVehicleProfile('generic');
}

/** The registry scenario + overrides the simulator uses for a simulated-vehicle id. A registry id
 *  simulates that profile as-is. A garage car simulates its base profile with the learned VIN and
 *  supported-PID set on top, so a car learned from the simulated Golf reconnects with the same VIN
 *  and PID set (and is recognised by the VIN auto-select). An unknown id simulates `generic`. */
export function simulatorSourceFor(
  id: string,
  userVehicles: UserVehicle[],
): { profileId: string; overrides: Partial<SimScenario> } {
  if (VEHICLE_REGISTRY[id]) return { profileId: id, overrides: {} };
  const user = userVehicles.find((v) => v.id === id);
  if (!user) return { profileId: 'generic', overrides: {} };
  const overrides: Partial<SimScenario> = {};
  if (user.learned?.vin) overrides.vin = user.learned.vin;
  if (user.learned?.supportedPids.length) overrides.supportedPids = [...user.learned.supportedPids];
  if (user.learned?.calibrationId) overrides.calibrationId = user.learned.calibrationId;
  const baseId = VEHICLE_REGISTRY[user.baseProfileId] ? user.baseProfileId : 'generic';
  return { profileId: baseId, overrides };
}
