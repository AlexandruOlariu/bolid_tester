import { useSessionStore } from '@/shared/state/sessionStore';
import { getVehicleProfile } from '@/shared/vehicles';
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
  const { session } = useSessionStore.getState();
  if (!session) return EMPTY;
  const modes = getVehicleProfile(useVehicleStore.getState().selectedProfileId).dtcModes;
  const stored = modes.includes('03') ? await session.readDtcs('03') : [];
  const pending = modes.includes('07') ? await session.readDtcs('07') : [];
  const permanent = modes.includes('0A') ? await session.readDtcs('0A') : [];
  const readiness = await session.readReadiness();
  const freezeFrame = stored.length > 0 ? await session.readFreezeFrame() : null;
  return { stored, pending, permanent, readiness, freezeFrame };
}

export async function clearAll(): Promise<boolean> {
  const { session } = useSessionStore.getState();
  if (!session) return false;
  return session.clearDtcs();
}
