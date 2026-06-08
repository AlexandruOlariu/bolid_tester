import { useSessionStore } from '@/shared/state/sessionStore';
import { getVehicleProfile } from '@/shared/vehicles';
import { useVehicleStore } from '@/features/vehicle-select/model/vehicleStore';
import type { DtcResult } from '../model/dtcStore';

export async function readAll(): Promise<DtcResult> {
  const { session } = useSessionStore.getState();
  if (!session) return { stored: [], pending: [], permanent: [] };
  const modes = getVehicleProfile(useVehicleStore.getState().selectedProfileId).dtcModes;
  return {
    stored: modes.includes('03') ? await session.readDtcs('03') : [],
    pending: modes.includes('07') ? await session.readDtcs('07') : [],
    permanent: modes.includes('0A') ? await session.readDtcs('0A') : [],
  };
}

export async function clearAll(): Promise<boolean> {
  const { session } = useSessionStore.getState();
  if (!session) return false;
  return session.clearDtcs();
}
