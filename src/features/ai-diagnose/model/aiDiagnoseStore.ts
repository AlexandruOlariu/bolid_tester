import { create } from 'zustand';
import type { AiReport, DiagnosticSnapshot } from '@/shared/obd-core';

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
  setPhase: (phase, progress) => set({ phase, progress: progress ?? null, error: null }),
  setSnapshot: (snapshot) => set({ snapshot }),
  setReport: (report, notice) =>
    set({ report, notice, phase: 'done', ranAt: Date.now(), error: null, progress: null }),
  setError: (error) => set({ error, phase: 'error', progress: null }),
  reset: () =>
    set({ phase: 'idle', progress: null, snapshot: null, report: null, notice: null, error: null, ranAt: null }),
}));
