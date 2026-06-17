import { useSessionStore } from '@/shared/state/sessionStore';
import { useHistoryStore } from '@/shared/state/historyStore';
import { logInfo, logError } from '@/shared/state/eventLog';
import { getVehicleProfile, vehicleLabel } from '@/shared/vehicles';
import { useVehicleStore } from '@/features/vehicle-select/model/vehicleStore';
import type { DtcResult } from '../model/dtcStore';

const TAG = 'faults';

const EMPTY: DtcResult = {
  stored: [],
  pending: [],
  permanent: [],
  readiness: null,
  freezeFrame: null,
};

export async function readAll(): Promise<DtcResult> {
  const { session, info } = useSessionStore.getState();
  if (!session) {
    logError(TAG, 'read skipped: no active session');
    return EMPTY;
  }
  const profile = getVehicleProfile(useVehicleStore.getState().selectedProfileId);
  const modes = profile.dtcModes;
  logInfo(TAG, `read: modes ${modes.join('/')} on ${session.currentProtocol}`);
  let stored: DtcResult['stored'] = [];
  let pending: DtcResult['pending'] = [];
  let permanent: DtcResult['permanent'] = [];
  let readiness: DtcResult['readiness'] = null;
  let freezeFrame: DtcResult['freezeFrame'] = null;
  try {
    stored = modes.includes('03') ? await session.readDtcs('03') : [];
    pending = modes.includes('07') ? await session.readDtcs('07') : [];
    permanent = modes.includes('0A') ? await session.readDtcs('0A') : [];
    readiness = await session.readReadiness();
    freezeFrame = stored.length > 0 ? await session.readFreezeFrame() : null;
  } catch (e) {
    logError(TAG, `read failed: ${(e as Error).message}`);
    throw e;
  }
  const result: DtcResult = { stored, pending, permanent, readiness, freezeFrame };
  logInfo(
    TAG,
    `read ok: ${stored.length} stored, ${pending.length} pending, ${permanent.length} permanent` +
      `${readiness ? `, MIL ${readiness.milOn ? 'on' : 'off'}` : ', no readiness'}`,
  );

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
  if (!session) {
    logError(TAG, 'clear skipped: no active session');
    return false;
  }
  logInfo(TAG, 'clear: sending Mode 04');
  try {
    const ok = await session.clearDtcs();
    if (ok) logInfo(TAG, 'clear ok: ECU acknowledged Mode 04');
    else logError(TAG, 'clear: ECU did not acknowledge (NO DATA / no response)');
    return ok;
  } catch (e) {
    logError(TAG, `clear failed: ${(e as Error).message}`);
    throw e;
  }
}
