import { useCallback } from 'react';
import { assessInspection, decodeVin, InspectionInput } from '@/shared/obd-core';
import { useSessionStore } from '@/shared/state/sessionStore';
import { logError } from '@/shared/state/errorLogStore';
import { useInspectionStore } from '../model/inspectionStore';

/** Run a standard-OBD2 used-car snapshot and assess it. CAN or K-line — uses only standard modes. */
export function useInspection() {
  const session = useSessionStore((s) => s.session);
  const info = useSessionStore((s) => s.info);
  const status = useSessionStore((s) => s.status);
  const report = useInspectionStore((s) => s.report);
  const running = useInspectionStore((s) => s.running);
  const set = useInspectionStore((s) => s.set);

  const run = useCallback(async () => {
    if (!session) return;
    set({ running: true });
    try {
      const readiness = await session.readReadiness();
      const stored = await session.readDtcs('03');
      const pending = await session.readDtcs('07');
      const permanent = await session.readDtcs('0A');
      const freeze = await session.readFreezeFrame();
      const dist = await session.readValue('0131');
      const vin = info?.vin ?? (await session.readVin());

      const input: InspectionInput = {
        vinValid: vin ? decodeVin(vin).validFormat : false,
        readiness,
        stored,
        pending,
        permanent,
        freezeFramePresent: !!freeze && (freeze.triggerDtc != null || freeze.values.length > 0),
        distanceSinceClearKm: dist ? dist.value : null,
      };
      set({ report: assessInspection(input), running: false, ranAt: Date.now() });
    } catch (e) {
      logError({ source: 'inspection', error: e, severity: 'warning' });
      set({ running: false });
    }
  }, [session, info, set]);

  return { connected: status === 'connected', report, running, run };
}
