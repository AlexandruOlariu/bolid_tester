import { useSessionStore } from '@/shared/state/sessionStore';
import { useHistoryStore } from '@/shared/state/historyStore';
import { getVehicleProfile, vehicleLabel } from '@/shared/vehicles';
import { useVehicleStore } from '@/features/vehicle-select/model/vehicleStore';
import type { DtcResult } from '../model/dtcStore';

const EMPTY: DtcResult = {
  stored: [],
  pending: [],
  permanent: [],
  readiness: null,
  freezeFrame: null,
};

export async function readAll(): Promise<DtcResult> {
  const { session, info } = useSessionStore.getState();
  if (!session) return EMPTY;
  const profile = getVehicleProfile(useVehicleStore.getState().selectedProfileId);
  const modes = profile.dtcModes;
  const stored = modes.includes('03') ? await session.readDtcs('03') : [];
  const pending = modes.includes('07') ? await session.readDtcs('07') : [];
  const permanent = modes.includes('0A') ? await session.readDtcs('0A') : [];
  const readiness = await session.readReadiness();
  const freezeFrame = stored.length > 0 ? await session.readFreezeFrame() : null;
  const result: DtcResult = { stored, pending, permanent, readiness, freezeFrame };

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
