import { create } from 'zustand';
import type {
  AgentEnd,
  AgentOutcome,
  AgentProgress,
  AgentRunRequest,
  AgentStep,
  AiChatMessage,
  AiReport,
  DiagnosticSnapshot,
  DriverInstructionId,
} from '@/shared/obd-core';
import { translate } from '@/shared/i18n';
import { activeCarStamp } from '@/shared/state/activeProfile';
import type { HistoryVehicle } from '@/shared/state/historyStore';

/** `triage`: step 1 is reading the car; `investigating`: the agent loop is running. */
export type RunPhase = 'idle' | 'triage' | 'investigating' | 'done' | 'error';

/** What `setOutcome` stores: an agent run's outcome, or the triage-only re-read after Clear codes
 *  (`end: null`). */
export type StoredOutcome = Omit<AgentOutcome, 'end'> & { end: AgentEnd | null };

interface AiDiagnoseState {
  phase: RunPhase;
  progress: string | null;
  /** The triage snapshot of the last run (the rule report and the guides read it). */
  snapshot: DiagnosticSnapshot | null;
  report: AiReport | null;
  /** Non-fatal note shown alongside a report (e.g. "AI server unavailable, used local rules"). */
  notice: string | null;
  error: string | null;
  ranAt: number | null;
  /** The car `report` was produced for (`activeCarStamp()` when it landed), or null with no
   *  report — the unified vehicle report only uses a report stamped for its car. */
  ranFor: HistoryVehicle | null;
  /** Fault code the last run was focused on ("Explain with AI"), or null for a full diagnosis. */
  focusCode: string | null;
  /** The last agent run's request; Re-run repeats it. */
  request: AgentRunRequest | null;
  /** The steps of the current (or last) run, triage first. */
  trail: AgentStep[];
  /** Steps of the 12-step budget used so far. */
  stepsUsed: number;
  /** The instruction the driver prompt shows while the run waits for the driver. */
  driver: DriverInstructionId | null;
  /** How the last run ended; null while running, with no run, or after a Clear codes re-read. */
  end: AgentEnd | null;
  /** Follow-up questions about the current report and their answers (user/assistant pairs, oldest
   *  first). Shown in full; the prompt keeps the last MAX_FOLLOWUP_TURNS messages. */
  conversation: AiChatMessage[];
  /** A follow-up question is waiting for its answer. */
  asking: boolean;
  askError: string | null;
  setFocusCode: (code: string | null) => void;
  setAsking: (asking: boolean) => void;
  setAskError: (error: string | null) => void;
  pushTurn: (user: string, assistant: string) => void;
  clearConversation: () => void;
  /** A run starts: triage first. Keeps the previous report until the outcome replaces it. */
  startRun: (req: AgentRunRequest) => void;
  /** The triage-only re-read after Clear codes starts (the last request stays for Re-run). */
  startTriageOnly: () => void;
  setProgress: (p: AgentProgress) => void;
  setOutcome: (o: StoredOutcome, notice: string | null) => void;
  setReport: (report: AiReport, notice: string | null) => void;
  setError: (error: string) => void;
  reset: () => void;
}

export const useAiDiagnoseStore = create<AiDiagnoseState>((set) => ({
  phase: 'idle',
  progress: null,
  snapshot: null,
  report: null,
  notice: null,
  error: null,
  ranAt: null,
  ranFor: null,
  focusCode: null,
  request: null,
  trail: [],
  stepsUsed: 0,
  driver: null,
  end: null,
  conversation: [],
  asking: false,
  askError: null,
  setFocusCode: (focusCode) => set({ focusCode }),
  setAsking: (asking) => set(asking ? { asking, askError: null } : { asking }),
  setAskError: (askError) => set({ askError, asking: false }),
  pushTurn: (user, assistant) =>
    set((s) => ({
      conversation: [
        ...s.conversation,
        { role: 'user', content: user },
        { role: 'assistant', content: assistant },
      ],
      asking: false,
      askError: null,
    })),
  clearConversation: () => set({ conversation: [], askError: null }),
  startRun: (request) =>
    set({
      phase: 'triage',
      progress: translate('aiDiagnose:msg.gathering'),
      request,
      focusCode: request.focusCode ?? null,
      trail: [],
      stepsUsed: 0,
      driver: null,
      end: null,
      error: null,
    }),
  startTriageOnly: () =>
    set({
      phase: 'triage',
      progress: translate('aiDiagnose:msg.gathering'),
      // The re-read is not about one code: no "Focused on …" card above its report.
      focusCode: null,
      trail: [],
      stepsUsed: 0,
      driver: null,
      end: null,
      error: null,
    }),
  setProgress: (p) =>
    set({
      phase: 'investigating',
      progress: translate('aiDiagnose:msg.analyzing'),
      trail: p.trail,
      stepsUsed: p.stepsUsed,
      driver: p.driver,
    }),
  // A new report starts a new conversation.
  setOutcome: (o, notice) =>
    set({
      report: o.report,
      notice,
      snapshot: o.snapshot,
      trail: o.trail,
      stepsUsed: o.stepsUsed,
      end: o.end,
      driver: null,
      phase: 'done',
      ranAt: Date.now(),
      ranFor: activeCarStamp(),
      error: null,
      progress: null,
      conversation: [],
      asking: false,
      askError: null,
    }),
  setReport: (report, notice) =>
    set({
      report,
      notice,
      phase: 'done',
      ranAt: Date.now(),
      ranFor: activeCarStamp(),
      error: null,
      progress: null,
      conversation: [],
      asking: false,
      askError: null,
    }),
  setError: (error) => set({ error, phase: 'error', progress: null, driver: null }),
  reset: () =>
    set({
      phase: 'idle',
      progress: null,
      snapshot: null,
      report: null,
      notice: null,
      error: null,
      ranAt: null,
      ranFor: null,
      focusCode: null,
      request: null,
      trail: [],
      stepsUsed: 0,
      driver: null,
      end: null,
      conversation: [],
      asking: false,
      askError: null,
    }),
}));
