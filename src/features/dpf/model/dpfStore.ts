import { create } from 'zustand';
import type { DpfReport } from '@/shared/obd-core';

export interface DpfValue {
  did: string;
  name: string;
  unit: string;
  value: number | null;
  role?: string;
}

interface DpfState {
  values: DpfValue[];
  report: DpfReport | null;
  running: boolean;
  set: (patch: Partial<Pick<DpfState, 'values' | 'report' | 'running'>>) => void;
}

export const useDpfStore = create<DpfState>((set) => ({
  values: [],
  report: null,
  running: false,
  set: (patch) => set(patch),
}));
