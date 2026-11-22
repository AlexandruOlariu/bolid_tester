import { create } from 'zustand';
import type { FrameStat } from '@/shared/obd-core';

interface SnifferState {
  running: boolean;
  stats: FrameStat[];
  totalFrames: number;
  /** Lines currently held by the capture buffer (parsed or not). */
  capturedLines: number;
  /** Oldest lines evicted because the capture outgrew its buffer. */
  dropped: number;
  /** What is happening on the bus — written into the capture header. Kept across runs. */
  note: string;
  /** File URI of the last capture written for sharing, or null. */
  lastExportUri: string | null;
  setRunning: (r: boolean) => void;
  setStats: (s: FrameStat[], total: number) => void;
  setCapture: (count: number, dropped: number) => void;
  setNote: (note: string) => void;
  setLastExportUri: (uri: string | null) => void;
  /** Clear the previous run's stats and capture counters (the note is kept). */
  reset: () => void;
}

export const useSnifferStore = create<SnifferState>((set) => ({
  running: false,
  stats: [],
  totalFrames: 0,
  capturedLines: 0,
  dropped: 0,
  note: '',
  lastExportUri: null,
  setRunning: (running) => set({ running }),
  setStats: (stats, totalFrames) => set({ stats, totalFrames }),
  setCapture: (capturedLines, dropped) => set({ capturedLines, dropped }),
  setNote: (note) => set({ note }),
  setLastExportUri: (lastExportUri) => set({ lastExportUri }),
  reset: () =>
    set({ stats: [], totalFrames: 0, capturedLines: 0, dropped: 0, lastExportUri: null }),
}));
