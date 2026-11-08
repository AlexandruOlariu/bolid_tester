import { create } from 'zustand';
import type { Dtc } from '@/shared/obd-core/obd/dtc';
import type { MonitorStatus } from '@/shared/obd-core/obd/readiness';
import type { FreezeFrame } from '@/shared/obd-core/session/DiagnosticSession';

export interface DtcResult {
  stored: Dtc[];
  pending: Dtc[];
  permanent: Dtc[];
  readiness: MonitorStatus | null;
  /** One freeze frame per stored code (frame n belongs to stored[n] on most ECUs). */
  freezeFrames: FreezeFrame[];
}

const EMPTY_RESULT: DtcResult = {
  stored: [],
  pending: [],
  permanent: [],
  readiness: null,
  freezeFrames: [],
};

interface DtcState extends DtcResult {
  /** When the last successful read from a live session landed (epoch ms), or null if faults were
   *  never read. In-memory only (the store is not persisted) — drives the first-run card's
   *  "Read fault codes" step. */
  lastReadAt: number | null;
  loading: boolean;
  error: string | null;
  /** Publish a real read from the adapter; stamps `lastReadAt`. */
  set: (r: DtcResult) => void;
  /** Empty the results (no session to read from) without counting it as a read. */
  clearResults: () => void;
  setLoading: (v: boolean) => void;
  setError: (e: string | null) => void;
}

export const useDtcStore = create<DtcState>((set) => ({
  ...EMPTY_RESULT,
  lastReadAt: null,
  loading: false,
  error: null,
  set: (r) => set({ ...r, lastReadAt: Date.now() }),
  clearResults: () => set({ ...EMPTY_RESULT }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
}));
