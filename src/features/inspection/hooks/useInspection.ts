import { useCallback } from 'react';
import { useSessionStore } from '@/shared/state/sessionStore';
import { logError } from '@/shared/state/errorLogStore';
import { useInspectionStore } from '../model/inspectionStore';
import { runInspection } from '../api/runInspection';

/** Run a standard-OBD2 used-car snapshot and assess it (`runInspection`). CAN or K-line — uses only
 *  standard modes. */
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
      const next = await runInspection(session, info?.vin ?? null);
      set({ report: next, running: false, ranAt: Date.now() });
    } catch (e) {
      logError({ source: 'inspection', error: e, severity: 'warning' });
      set({ running: false });
    }
  }, [session, info, set]);

  return { connected: status === 'connected', report, running, run };
}
