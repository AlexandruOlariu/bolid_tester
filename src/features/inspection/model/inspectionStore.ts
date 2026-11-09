import { create } from 'zustand';
import type { InspectionReport } from '@/shared/obd-core';
import { activeCarStamp } from '@/shared/state/activeProfile';
import type { HistoryVehicle } from '@/shared/state/historyStore';

interface InspectionState {
  report: InspectionReport | null;
  running: boolean;
  ranAt: number | null;
  /** The car `report` was produced for (`activeCarStamp()` when it was set), or null with no
   *  report — the unified vehicle report (plan 15) only uses a report stamped for its car. */
  ranFor: HistoryVehicle | null;
  set: (patch: Partial<Pick<InspectionState, 'report' | 'running' | 'ranAt'>>) => void;
}

export const useInspectionStore = create<InspectionState>((set) => ({
  report: null,
  running: false,
  ranAt: null,
  ranFor: null,
  set: (patch) =>
    set('report' in patch ? { ...patch, ranFor: patch.report ? activeCarStamp() : null } : patch),
}));
