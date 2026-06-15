import { useCallback } from 'react';
import { useSessionStore } from '@/shared/state/sessionStore';
import { useAiDiagnoseStore } from '../model/aiDiagnoseStore';
import * as diagnoseService from '../api/diagnoseService';

/** Orchestrates a one-tap diagnosis: gather → analyse (AI or local) → store report. Also exposes a
 *  gated clear-codes that re-runs the diagnosis afterwards. */
export function useAiDiagnose() {
  const status = useSessionStore((s) => s.status);
  const { phase, progress, report, notice, error, ranAt, setPhase, setSnapshot, setReport, setError } =
    useAiDiagnoseStore();

  const run = useCallback(async () => {
    if (useSessionStore.getState().status !== 'connected') {
      setError('Connect to a vehicle first (Connect tab).');
      return;
    }
    setPhase('gathering', 'Reading fault codes, readiness & live data…');
    try {
      const snapshot = await diagnoseService.gatherSnapshot();
      setSnapshot(snapshot);
      const { report: r, notice: n } = await diagnoseService.analyze(snapshot, () =>
        setPhase('analyzing', 'Asking the AI model to analyse the data…'),
      );
      setReport(r, n);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [setPhase, setSnapshot, setReport, setError]);

  const clearCodes = useCallback(async (): Promise<boolean> => {
    const ok = await diagnoseService.clearCodes();
    if (ok) await run();
    return ok;
  }, [run]);

  const busy = phase === 'gathering' || phase === 'analyzing';

  return { status, phase, progress, report, notice, error, ranAt, busy, run, clearCodes };
}
