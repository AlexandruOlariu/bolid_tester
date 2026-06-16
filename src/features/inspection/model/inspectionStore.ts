import { create } from 'zustand';
import type { InspectionReport } from '@/shared/obd-core';

interface InspectionState {
  report: InspectionReport | null;
  running: boolean;
  ranAt: number | null;
  set: (patch: Partial<Pick<InspectionState, 'report' | 'running' | 'ranAt'>>) => void;
}

export const useInspectionStore = create<InspectionState>((set) => ({
  report: null,
  running: false,
  ranAt: null,
  set: (patch) => set(patch),
}));
