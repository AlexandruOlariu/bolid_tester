import { create } from 'zustand';
import type { VSample, BatteryReport } from '@/shared/obd-core';

interface BatteryState {
  samples: VSample[];
  report: BatteryReport | null;
  capturing: boolean;
  setSamples: (s: VSample[]) => void;
  setReport: (r: BatteryReport | null) => void;
  setCapturing: (c: boolean) => void;
}

export const useBatteryStore = create<BatteryState>((set) => ({
  samples: [],
  report: null,
  capturing: false,
  setSamples: (samples) => set({ samples }),
  setReport: (report) => set({ report }),
  setCapturing: (capturing) => set({ capturing }),
}));
