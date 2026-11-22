/** "Learn this car" + garage actions (plan 06). Creating a garage car from the live connection,
 *  deleting one (falling back to Auto / Generic when it was selected), and the connect-time VIN
 *  auto-select. Store-level only — no device I/O; the learned identity comes from the
 *  `SessionInfo` the connection already read. See docs/features/vehicle-select.md. */
import { useGarageStore } from '@/shared/state/garageStore';
import { useSessionStore } from '@/shared/state/sessionStore';
import { useSettingsStore } from '@/shared/state/settingsStore';
import { notify } from '@/shared/notify';
import {
  defaultVehicleName,
  getVehicleProfile,
  learnedFromSessionInfo,
  makeForVin,
  pickVehicleForVin,
  vinModelYear,
  type UserVehicle,
} from '@/shared/vehicles';
import { simulatorSourceFor } from '@/shared/vehicles/resolve';
import { useVehicleStore } from '../model/vehicleStore';
import { translate } from '@/shared/i18n';

/** Requires a connected session. Creates a garage car from the live `SessionInfo` (or re-learns
 *  `existingId`, keeping its name / fuel / notes), selects it and returns it. Null when no session
 *  info is available (not connected) or `existingId` is not in the garage. */
export function learnFromConnectedCar(
  opts: { existingId?: string; baseProfileId?: string } = {},
): UserVehicle | null {
  const info = useSessionStore.getState().info;
  if (!info) return null;
  const garage = useGarageStore.getState();
  const learned = learnedFromSessionInfo(info);

  if (opts.existingId) {
    const existing = garage.vehicles.find((v) => v.id === opts.existingId);
    if (!existing) return null;
    garage.setLearned(existing.id, learned);
    if (opts.baseProfileId) garage.update(existing.id, { baseProfileId: opts.baseProfileId });
    useVehicleStore.getState().select(existing.id);
    return useGarageStore.getState().vehicles.find((v) => v.id === existing.id) ?? null;
  }

  const baseProfileId = opts.baseProfileId ?? 'generic';
  const base = getVehicleProfile(baseProfileId);
  const year = vinModelYear(info.vin);
  const make = makeForVin(info.vin);
  const vehicle = garage.add({
    name: defaultVehicleName(info.vin),
    ...(year ? { year } : {}),
    fuel: base.fuel,
    ...(make ? { make } : {}),
    baseProfileId: base.id,
    learned,
  });
  useVehicleStore.getState().select(vehicle.id);
  return vehicle;
}

/** Delete a garage car. When it was the selected car the selection falls back to Auto / Generic;
 *  when it was the Settings simulated vehicle, the simulator falls back to the registry profile it
 *  was simulating (the car's base), so the stored id never points at a car that no longer exists.
 *  History, scans and maintenance are keyed by VIN / id and are kept. */
export function deleteGarageVehicle(id: string): void {
  const settings = useSettingsStore.getState();
  if (settings.simulatedVehicleId === id) {
    const { profileId } = simulatorSourceFor(id, useGarageStore.getState().vehicles);
    settings.setSimulatedVehicle(profileId);
  }
  useGarageStore.getState().remove(id);
  if (useVehicleStore.getState().selectedProfileId === id)
    useVehicleStore.getState().select('generic');
}

/** Connect-time VIN auto-select (`settings.autoSelectByVin`): when the connected car's VIN equals a
 *  garage car's learned VIN, select that car and say so. Returns the selected car, or null when the
 *  setting is off, there is no VIN or no garage car matches. Registry profiles are not auto-selected
 *  — the Vehicle screen keeps suggesting them (`suggestProfilesForVin`). */
export function autoSelectGarageCarForVin(vin: string | null | undefined): UserVehicle | null {
  if (!useSettingsStore.getState().autoSelectByVin) return null;
  const match = pickVehicleForVin(vin, useGarageStore.getState().vehicles);
  if (!match) return null;
  if (useVehicleStore.getState().selectedProfileId !== match.id) {
    useVehicleStore.getState().select(match.id);
    void notify({
      category: 'connection',
      severity: 'info',
      title: translate('vehicleSelect:notify.recognised'),
      body: match.name,
    });
  }
  return match;
}
