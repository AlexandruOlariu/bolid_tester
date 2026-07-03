import { useCallback } from 'react';
import { isCan, isKLine, Mode05Result } from '@/shared/obd-core';
import { useSessionStore } from '@/shared/state/sessionStore';
import { logError } from '@/shared/state/errorLogStore';
import { getVehicleProfile } from '@/shared/vehicles';
import { useVehicleStore } from '@/features/vehicle-select/model/vehicleStore';
import { useSensorTestStore, ModuleReading } from '../model/sensorTestStore';

/** Standard Mode 06 + experimental, CAN-only module sensor reads (e.g. ABS wheel speed). */
export function useSensorTests() {
  const session = useSessionStore((s) => s.session);
  const profileId = useVehicleStore((s) => s.selectedProfileId);
  const setMode06 = useSensorTestStore((s) => s.setMode06);
  const setMode05 = useSensorTestStore((s) => s.setMode05);
  const setModuleReadings = useSensorTestStore((s) => s.setModuleReadings);

  const profile = getVehicleProfile(profileId);
  const canModuleSensors =
    !!profile.moduleSensors?.length && isCan(session?.currentProtocol ?? 'UNKNOWN');
  const kline = isKLine(session?.currentProtocol ?? 'UNKNOWN');

  const refresh = useCallback(async () => {
    if (!session) return;
    try {
      for (const t of profile.mode06Tests ?? []) {
        const r = await session.readMode06(t.mid);
        if (r.length) setMode06(r);
      }
      // Mode 05 — the pre-CAN counterpart of Mode 06 (O2 thresholds/switch times). Petrol
      // K-line cars only; a small TID sweep, tolerant of NO DATA.
      if (kline && profile.fuel !== 'diesel') {
        const out05: Mode05Result[] = [];
        for (const tid of ['01', '02', '05', '06']) {
          const r = await session.readMode05(tid, '01');
          if (r) out05.push(r);
        }
        setMode05(out05);
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
        await session.resetAddressing();
        setModuleReadings(out);
      }
    } catch (e) {
      logError({ source: 'sensor-tests', error: e, severity: 'warning' });
      await session.resetAddressing();
    }
  }, [session, profile, canModuleSensors, setMode06, setModuleReadings]);

  return { refresh, canModuleSensors, kline, fuel: profile.fuel, hasMode06: !!profile.mode06Tests?.length };
}
