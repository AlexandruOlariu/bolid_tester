import { useCallback } from 'react';
import { useSessionStore } from '@/shared/state/sessionStore';
import { useHistoryStore } from '@/shared/state/historyStore';
import { logError } from '@/shared/state/errorLogStore';
import { useVehicleStore } from '@/features/vehicle-select/model/vehicleStore';
import { getVehicleProfile } from '@/shared/vehicles';
import type { DiagnosisOptions } from '@/shared/obd-core';
import { useAiDiagnoseStore } from '../model/aiDiagnoseStore';
import * as diagnoseService from '../api/diagnoseService';

/** Orchestrates a one-tap diagnosis: gather → analyse (AI or local) → store report + save to history.
 *  `run({ focusCode })` focuses the analysis on one fault code (fault-codes "Explain with AI").
 *  Also exposes a gated clear-codes that re-runs the diagnosis afterwards. */
export function useAiDiagnose() {
  const status = useSessionStore((s) => s.status);
  // The selected car's DTC make, so a focused code reads the same as on the Faults screen.
  const make = getVehicleProfile(useVehicleStore((s) => s.selectedProfileId)).make;
  const {
    phase,
    progress,
    report,
    notice,
    error,
    ranAt,
    focusCode,
    setFocusCode,
    setPhase,
    setSnapshot,
    setReport,
    setError,
  } = useAiDiagnoseStore();

  const run = useCallback(
    async (opts: DiagnosisOptions = {}) => {
      const focus = opts.focusCode?.trim().toUpperCase() || null;
      setFocusCode(focus);
      if (useSessionStore.getState().status !== 'connected') {
        setError('Connect to a vehicle first (Connect tab).');
        return;
      }
      setPhase('gathering', 'Reading fault codes, readiness & live data…');
      try {
        const snapshot = await diagnoseService.gatherSnapshot();
        setSnapshot(snapshot);
        const { report: r, notice: n } = await diagnoseService.analyze(
          snapshot,
          () => setPhase('analyzing', 'Asking the AI model to analyse the data…'),
          { focusCode: focus ?? undefined },
        );
        setReport(r, n);
        useHistoryStore.getState().addAiRun({
          vehicle: {
            id: useVehicleStore.getState().selectedProfileId,
            label: snapshot.vehicle?.label ?? 'Unknown vehicle',
            vin: snapshot.vin,
          },
          source: r.source,
          overall: r.overall,
          summary: r.summary,
          findingCount: r.findings.length,
          report: r,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        logError({ source: 'ai-diagnose', error: e });
      }
    },
    [setFocusCode, setPhase, setSnapshot, setReport, setError],
  );

  const clearCodes = useCallback(async (): Promise<boolean> => {
    const ok = await diagnoseService.clearCodes();
    if (ok) await run();
    return ok;
  }, [run]);

  const busy = phase === 'gathering' || phase === 'analyzing';

  return {
    status,
    phase,
    progress,
    report,
    notice,
    error,
    ranAt,
    focusCode,
    make,
    busy,
    run,
    clearCodes,
  };
}
