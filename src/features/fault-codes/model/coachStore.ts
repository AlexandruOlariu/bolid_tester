import { create } from 'zustand';
import type { MonitorStatus } from '@/shared/obd-core/obd/readiness';

/** Drive-cycle / readiness coach state (6b.9). A tiny, self-contained store shared by the Faults
 *  screen (toggle + live panel) and the EngineHost watcher (which polls readiness while enabled and
 *  keeps `readiness` fresh). No cross-feature imports beyond the obd-core type. */
interface CoachState {
  /** User enabled the coach from the Faults screen. */
  enabled: boolean;
  /** Latest readiness the watcher polled — drives the live panel. Null until the first poll. */
  readiness: MonitorStatus | null;
  updatedAt: number | null;
  setEnabled: (v: boolean) => void;
  setReadiness: (r: MonitorStatus) => void;
  /** End coach mode (toggle-off or disconnect): clears the flag and the cached readiness. */
  reset: () => void;
}

export const useCoachStore = create<CoachState>((set) => ({
  enabled: false,
  readiness: null,
  updatedAt: null,
  setEnabled: (enabled) =>
    set(enabled ? { enabled: true } : { enabled: false, readiness: null, updatedAt: null }),
  setReadiness: (readiness) => set({ readiness, updatedAt: Date.now() }),
  reset: () => set({ enabled: false, readiness: null, updatedAt: null }),
}));
