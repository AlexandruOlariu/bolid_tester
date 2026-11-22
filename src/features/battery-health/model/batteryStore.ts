import { create } from 'zustand';
import type { VSample, BatteryReport } from '@/shared/obd-core';
import { activeCarStamp } from '@/shared/state/activeProfile';
import type { HistoryVehicle } from '@/shared/state/historyStore';

interface BatteryState {
  samples: VSample[];
  report: BatteryReport | null;
  /** When the current `report` was produced (epoch ms), or null when there is none. Set by
   *  `setReport`; the unified vehicle report (plan 15) prints it as "Captured". */
  ranAt: number | null;
  /** The car the current `report` was captured on (`activeCarStamp()`), or null with no report —
   *  the unified vehicle report only uses a report stamped for its car. */
  ranFor: HistoryVehicle | null;
  capturing: boolean;
  setSamples: (s: VSample[]) => void;
  setReport: (r: BatteryReport | null) => void;
  setCapturing: (c: boolean) => void;
}

export const useBatteryStore = create<BatteryState>((set) => ({
  samples: [],
  report: null,
  ranAt: null,
  ranFor: null,
  capturing: false,
  setSamples: (samples) => set({ samples }),
  setReport: (report) =>
    set({
      report,
      ranAt: report ? Date.now() : null,
      ranFor: report ? activeCarStamp() : null,
    }),
  setCapturing: (capturing) => set({ capturing }),
}));
