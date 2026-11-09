import { create } from 'zustand';
import type { AdapterHealthResult } from '../api/gradeAdapter';
import type { AdapterReportJsonContext } from '../api/adapterReportJson';

/** One completed adapter health run. Ephemeral (a check is a one-off; not persisted). */
export interface AdapterHealthReport {
  /** `ATI` firmware identifier. */
  version: string;
  /** `ATRV` supply voltage, or null when unreadable. */
  voltage: number | null;
  /** Human protocol label (`PROTOCOL_LABELS[...]`). */
  protocol: string;
  /** Per-command `0100` round-trip latencies (ms) — failed commands omitted. */
  latenciesMs: number[];
  /** How many `0100` commands were attempted (failures included). */
  attempts: number;
  /** The pure grade over the identity + latency burst. */
  result: AdapterHealthResult;
  /** Epoch ms the run finished. */
  ranAt: number;
  /** The adapter / link / profile the run was made on, captured when it started — never read
   *  again at share time, so a report kept across a reconnect cannot pair one adapter's
   *  measurements with another adapter's name or link (plan 29). */
  context: AdapterReportJsonContext;
}

interface AdapterHealthState {
  running: boolean;
  /** Short human label of the current step, shown while running (null when idle). */
  phase: string | null;
  report: AdapterHealthReport | null;
  setRunning: (running: boolean) => void;
  setPhase: (phase: string | null) => void;
  setReport: (report: AdapterHealthReport | null) => void;
}

export const useAdapterHealthStore = create<AdapterHealthState>((set) => ({
  running: false,
  phase: null,
  report: null,
  setRunning: (running) => set({ running }),
  setPhase: (phase) => set({ phase }),
  setReport: (report) => set({ report }),
}));
