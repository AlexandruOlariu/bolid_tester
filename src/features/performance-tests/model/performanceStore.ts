import { create } from 'zustand';
import type { AccelResult, DragResult, BrakeResult, SpeedSample } from '@/shared/obd-core';

export type TestType = 'accel' | 'drag' | 'brake';
export type RunState = 'idle' | 'armed' | 'running' | 'done';

export interface PerfRun {
  id: string;
  type: TestType;
  at: number;
  samples: SpeedSample[];
  accel?: AccelResult;
  drag?: DragResult;
  brake?: BrakeResult;
}

interface PerformanceState {
  state: RunState;
  type: TestType;
  targetKmh: number;
  history: PerfRun[];
  setState: (s: RunState) => void;
  setType: (t: TestType) => void;
  setTarget: (k: number) => void;
  addRun: (r: PerfRun) => void;
}

export const usePerformanceStore = create<PerformanceState>((set) => ({
  state: 'idle',
  type: 'accel',
  targetKmh: 100,
  history: [],
  setState: (state) => set({ state }),
  setType: (type) => set({ type }),
  setTarget: (targetKmh) => set({ targetKmh }),
  addRun: (r) => set((s) => ({ history: [r, ...s.history].slice(0, 50) })),
}));
