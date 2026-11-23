import { useCallback } from 'react';
import { useSessionStore } from '@/shared/state/sessionStore';
import { useHistoryStore } from '@/shared/state/historyStore';
import { logError } from '@/shared/state/errorLogStore';
import { getActiveProfile, useActiveProfile } from '@/features/vehicle-select/api/activeProfile';
import { curatedProfileId } from '@/shared/vehicles';
import {
  AGENT_BUDGET,
  type AgentContribution,
  type AgentRunRequest,
  type AiReport,
  type DiagnosisOptions,
  type DiagnosticSnapshot,
  type DriverInstructionId,
  type DriverReply,
} from '@/shared/obd-core';
import { useAiDiagnoseStore } from '../model/aiDiagnoseStore';
import * as diagnoseService from '../api/diagnoseService';
import * as agentService from '../api/agentService';
import { createDriverGate, type DriverGate } from '../api/driverGate';
import { translate } from '@/shared/i18n';

/** The run in flight: Stop and the driver prompt's answer reach it here. One at a time; module
 *  state so a remounted screen still reaches the run its store shows. */
let activeRun: { stop(): void; gate: DriverGate } | null = null;

const isRunning = (): boolean => {
  const phase = useAiDiagnoseStore.getState().phase;
  return phase === 'triage' || phase === 'investigating';
};

function addHistoryEntry(report: AiReport, snapshot: DiagnosticSnapshot): void {
  useHistoryStore.getState().addAiRun({
    vehicle: {
      id: getActiveProfile().id,
      label: snapshot.vehicle?.label ?? translate('aiDiagnose:unknownVehicle'),
      vin: snapshot.vin,
    },
    source: report.source,
    overall: report.overall,
    summary: report.summary,
    findingCount: report.findings.length,
    report,
  });
}

/** Told after the driver answers a prompt (plan 34c): the instruction and the reply. The route uses
 *  it to start the simulator's rev hold when "hold 2500 rpm" is confirmed. */
export type DriverAnswerListener = (id: DriverInstructionId, reply: DriverReply) => void;

/** Orchestrates the AI diagnostic agent (plan 34a): **Investigate** a typed symptom or **Check
 *  everything** runs triage then the agent loop over `contributions` (the app layer composes them),
 *  with Stop, the driver prompt's answer and Re-run; the outcome lands in the store and in History.
 *  `run({ focusCode })` starts a run seeded with one fault code (fault-codes "Explain with AI").
 *  `ask(question)` sends a follow-up question over the trail. `clearCodes()` clears, then re-reads
 *  the car with triage only. A start while a run is going is ignored. `onDriverAnswer` is called
 *  after each answer to an open driver prompt. */
export function useAiDiagnose(
  contributions: AgentContribution[],
  onDriverAnswer?: DriverAnswerListener,
) {
  const status = useSessionStore((s) => s.status);
  // The selected car's DTC make, so a focused code reads the same as on the Faults screen.
  const profile = useActiveProfile();
  const make = profile.make;
  // Fault guides are curated per registry profile; a garage car uses its base profile's guides.
  const guideProfileId = curatedProfileId(profile);
  const {
    phase,
    progress,
    report,
    notice,
    error,
    ranAt,
    focusCode,
    request,
    trail,
    stepsUsed,
    driver,
    end,
    conversation,
    asking,
    askError,
  } = useAiDiagnoseStore();

  const start = useCallback(
    async (req: AgentRunRequest): Promise<void> => {
      // Checked and claimed synchronously, so a double tap starts exactly one run.
      if (isRunning()) return;
      const store = useAiDiagnoseStore.getState();
      if (useSessionStore.getState().status !== 'connected') {
        store.setFocusCode(req.focusCode ?? null);
        store.setError(translate('aiDiagnose:msg.connectFirst'));
        return;
      }
      store.startRun(req);
      const gate = createDriverGate();
      // A superseded run (the store was reset and another run started) must not touch the store.
      const current = (): boolean => activeRun?.gate === gate;
      let handle: agentService.AgentRunHandle;
      try {
        handle = agentService.startAgentRun(req, contributions, {
          onTriage: (t) => {
            if (current())
              useAiDiagnoseStore.getState().setProgress({
                trail: [t.step],
                stepsUsed: 1,
                phase: 'thinking',
                driver: null,
              });
          },
          onProgress: (p) => {
            if (current()) useAiDiagnoseStore.getState().setProgress(p);
          },
          gate,
        });
      } catch (e) {
        useAiDiagnoseStore.getState().setError(e instanceof Error ? e.message : String(e));
        return;
      }
      activeRun = { stop: handle.stop, gate };
      try {
        const o = await handle.done;
        if (!current()) return;
        useAiDiagnoseStore.getState().setOutcome(o, o.notice);
        addHistoryEntry(o.report, o.snapshot);
      } catch (e) {
        if (!current()) return;
        useAiDiagnoseStore.getState().setError(e instanceof Error ? e.message : String(e));
        logError({ source: 'ai-diagnose', error: e, context: { phase: 'agent' } });
      } finally {
        if (current()) activeRun = null;
      }
    },
    [contributions],
  );

  const investigate = useCallback(
    async (symptom: string): Promise<void> => {
      const text = symptom.trim();
      if (!text) return;
      await start({ mode: 'symptom', symptom: text });
    },
    [start],
  );

  const checkEverything = useCallback(() => start({ mode: 'everything' }), [start]);

  /** Repeats the last run's request (symptom or everything, focus included). */
  const rerun = useCallback(async (): Promise<void> => {
    const req = useAiDiagnoseStore.getState().request;
    if (req) await start(req);
  }, [start]);

  /** `focusCode` seeds an agent run with that code as the symptom; without one, Check everything. */
  const run = useCallback(
    async (opts: DiagnosisOptions = {}): Promise<void> => {
      const focus = opts.focusCode?.trim().toUpperCase() || undefined;
      await start(
        focus ? { mode: 'symptom', symptom: focus, focusCode: focus } : { mode: 'everything' },
      );
    },
    [start],
  );

  const stop = useCallback(() => activeRun?.stop(), []);

  const answerDriver = useCallback(
    (reply: DriverReply) => {
      const gate = activeRun?.gate;
      const id = gate?.pending();
      if (!gate || !id) return; // no open prompt: nothing to answer, nothing to report
      gate.answer(reply);
      onDriverAnswer?.(id, reply);
    },
    [onDriverAnswer],
  );

  const clearCodes = useCallback(async (): Promise<boolean> => {
    if (isRunning()) return false;
    const ok = await diagnoseService.clearCodes();
    if (!ok || isRunning()) return ok;
    const store = useAiDiagnoseStore.getState();
    store.startTriageOnly();
    try {
      const { triage, report: r } = await agentService.runTriageOnly(contributions);
      useAiDiagnoseStore
        .getState()
        .setOutcome(
          { report: r, trail: [triage.step], snapshot: triage.snapshot, end: null, stepsUsed: 0 },
          translate('aiDiagnose:agent.clearedNotice'),
        );
      addHistoryEntry(r, triage.snapshot);
    } catch (e) {
      useAiDiagnoseStore.getState().setError(e instanceof Error ? e.message : String(e));
      logError({ source: 'ai-diagnose', error: e, context: { phase: 'clear-codes' } });
    }
    return ok;
  }, [contributions]);

  const ask = useCallback(async (question: string): Promise<void> => {
    const q = question.trim();
    const st = useAiDiagnoseStore.getState();
    if (!q || st.asking || !st.report) return;
    st.setAsking(true);
    // A re-run (new report, which also resets `asking`) or a Clear while the question is in flight
    // makes its answer stale: drop it rather than add it to a conversation it was not asked in.
    const stale = (): boolean => {
      const cur = useAiDiagnoseStore.getState();
      if (cur.report !== st.report) return true;
      if (cur.conversation !== st.conversation) {
        cur.setAsking(false);
        return true;
      }
      return false;
    };
    try {
      const answer = await diagnoseService.followUp(st.trail, st.report, st.conversation, q);
      if (stale()) return;
      useAiDiagnoseStore.getState().pushTurn(q, answer);
    } catch (e) {
      if (stale()) return;
      useAiDiagnoseStore.getState().setAskError(e instanceof Error ? e.message : String(e));
      logError({
        source: 'ai-diagnose',
        error: e,
        severity: 'warning',
        context: { phase: 'follow-up' },
      });
    }
  }, []);

  const clearConversation = useCallback(
    () => useAiDiagnoseStore.getState().clearConversation(),
    [],
  );

  const busy = phase === 'triage' || phase === 'investigating';

  return {
    status,
    phase,
    progress,
    report,
    notice,
    error,
    ranAt,
    focusCode,
    request,
    make,
    guideProfileId,
    busy,
    run,
    clearCodes,
    conversation,
    asking,
    askError,
    ask,
    clearConversation,
    trail,
    stepsUsed,
    maxSteps: AGENT_BUDGET.maxSteps,
    driver,
    end,
    investigate,
    checkEverything,
    rerun,
    stop,
    answerDriver,
  };
}
