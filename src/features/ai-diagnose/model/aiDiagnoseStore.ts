import { create } from 'zustand';
import type { AiChatMessage, AiReport, DiagnosticSnapshot } from '@/shared/obd-core';

export type RunPhase = 'idle' | 'gathering' | 'analyzing' | 'done' | 'error';

interface AiDiagnoseState {
  phase: RunPhase;
  progress: string | null;
  snapshot: DiagnosticSnapshot | null;
  report: AiReport | null;
  /** Non-fatal note shown alongside a report (e.g. "AI server unavailable, used local rules"). */
  notice: string | null;
  error: string | null;
  ranAt: number | null;
  /** Fault code the last run was focused on ("Explain with AI"), or null for a full diagnosis. */
  focusCode: string | null;
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
  setPhase: (phase: RunPhase, progress?: string | null) => void;
  setSnapshot: (snapshot: DiagnosticSnapshot) => void;
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
  focusCode: null,
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
  setPhase: (phase, progress) => set({ phase, progress: progress ?? null, error: null }),
  setSnapshot: (snapshot) => set({ snapshot }),
  // A new report starts a new conversation.
  setReport: (report, notice) =>
    set({
      report,
      notice,
      phase: 'done',
      ranAt: Date.now(),
      error: null,
      progress: null,
      conversation: [],
      asking: false,
      askError: null,
    }),
  setError: (error) => set({ error, phase: 'error', progress: null }),
  reset: () =>
    set({
      phase: 'idle',
      progress: null,
      snapshot: null,
      report: null,
      notice: null,
      error: null,
      ranAt: null,
      focusCode: null,
      conversation: [],
      asking: false,
      askError: null,
    }),
}));
