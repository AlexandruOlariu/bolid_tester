import { create } from 'zustand';
import type { FrameStat } from '@/shared/obd-core';

interface SnifferState {
  running: boolean;
  stats: FrameStat[];
  totalFrames: number;
  setRunning: (r: boolean) => void;
  setStats: (s: FrameStat[], total: number) => void;
  reset: () => void;
}

export const useSnifferStore = create<SnifferState>((set) => ({
  running: false,
  stats: [],
  totalFrames: 0,
  setRunning: (running) => set({ running }),
  setStats: (stats, totalFrames) => set({ stats, totalFrames }),
  reset: () => set({ stats: [], totalFrames: 0 }),
}));
