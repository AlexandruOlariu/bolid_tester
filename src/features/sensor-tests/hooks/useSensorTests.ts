import { useCallback } from 'react';
import { isCan } from '@/shared/obd-core';
import { useSessionStore } from '@/shared/state/sessionStore';
import { getVehicleProfile } from '@/shared/vehicles';
import { useVehicleStore } from '@/features/vehicle-select/model/vehicleStore';
import { useSensorTestStore, ModuleReading } from '../model/sensorTestStore';

/** Standard Mode 06 + experimental, CAN-only module sensor reads (e.g. ABS wheel speed). */
export function useSensorTests() {
  const session = useSessionStore((s) => s.session);
  const profileId = useVehicleStore((s) => s.selectedProfileId);
  const setMode06 = useSensorTestStore((s) => s.setMode06);
  const setModuleReadings = useSensorTestStore((s) => s.setModuleReadings);

  const profile = getVehicleProfile(profileId);
  const canModuleSensors =
    !!profile.moduleSensors?.length && isCan(session?.currentProtocol ?? 'UNKNOWN');

  const refresh = useCallback(async () => {
    if (!session) return;
    for (const t of profile.mode06Tests ?? []) {
      const r = await session.readMode06(t.mid);
      if (r.length) setMode06(r);
    }
    if (canModuleSensors) {
      const out: ModuleReading[] = [];
      for (const s of profile.moduleSensors ?? []) {
        await session.setHeader(s.reqHeader);
        await session.setRxFilter(s.rxFilter);
        const data = await session.readExtended(s.did);
        out.push({
          name: s.name,
          unit: s.unit,
          value: data ? s.decode(data) : null,
          raw: data ? data.map((b) => b.toString(16).padStart(2, '0')).join(' ') : 'no data',
        });
      }
      await session.setHeader(null);
      setModuleReadings(out);
    }
  }, [session, profile, canModuleSensors, setMode06, setModuleReadings]);

  return { refresh, canModuleSensors, hasMode06: !!profile.mode06Tests?.length };
}
