import { useSessionStore } from '@/shared/state/sessionStore';
import { useHistoryStore } from '@/shared/state/historyStore';
import { getVehicleProfile, vehicleLabel } from '@/shared/vehicles';
import { useVehicleStore } from '@/features/vehicle-select/model/vehicleStore';
import type { DtcResult } from '@/shared/state/dtcStore';
import { toDtc, type Dtc, type DtcMake } from '@/shared/obd-core/obd/dtc';

/** Re-describe codes with the car's manufacturer table (the core session read is generic, so
 *  P1xxx codes only get their VAG / Fiat text here). */
export function describeForMake(list: Dtc[], make: DtcMake | undefined): Dtc[] {
  return list.map((d) => toDtc(d.code, make));
}

/** Read every fault-code mode the profile supports, plus readiness and freeze frames. Resolves to
 *  `null` when there is no live session — nothing was read, so callers must not treat it as a read
 *  (the first-run card's "Read fault codes" step keys off real reads only). */
export async function readAll(): Promise<DtcResult | null> {
  const { session, info } = useSessionStore.getState();
  if (!session) return null;
  const profile = getVehicleProfile(useVehicleStore.getState().selectedProfileId);
  const modes = profile.dtcModes;
  const describe = (list: Dtc[]) => describeForMake(list, profile.make);
  const stored = describe(modes.includes('03') ? await session.readDtcs('03') : []);
  const pending = describe(modes.includes('07') ? await session.readDtcs('07') : []);
  const permanent = describe(modes.includes('0A') ? await session.readDtcs('0A') : []);
  const readiness = await session.readReadiness();
  const freezeFrames = stored.length > 0 ? await session.readFreezeFrames() : [];
  const result: DtcResult = { stored, pending, permanent, readiness, freezeFrames };

  // Record this fault-code check in the persistent, per-car history.
  const supported = readiness ? readiness.monitors.filter((m) => m.supported) : [];
  useHistoryStore.getState().addDtcCheck({
    vehicle: { id: profile.id, label: vehicleLabel(profile), vin: info?.vin ?? null },
    milOn: readiness ? readiness.milOn : null,
    stored,
    pending,
    permanent,
    monitorsComplete: readiness ? supported.filter((m) => m.complete).length : null,
    monitorsTotal: readiness ? supported.length : null,
  });

  return result;
}

export async function clearAll(): Promise<boolean> {
  const { session } = useSessionStore.getState();
  if (!session) return false;
  return session.clearDtcs();
}
