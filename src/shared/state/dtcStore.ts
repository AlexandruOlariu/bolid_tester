import { create } from 'zustand';
import type { Dtc } from '@/shared/obd-core/obd/dtc';
import type { MonitorStatus } from '@/shared/obd-core/obd/readiness';
import type { FreezeFrame } from '@/shared/obd-core/session/DiagnosticSession';
import { activeCarStamp } from './activeProfile';
import type { HistoryVehicle } from './historyStore';

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
  /** The car the current results were read from (`activeCarStamp()` at publish time), or null when
   *  there are none — never read, or emptied by `clearResults`. Unlike `lastReadAt` this follows
   *  the results, so the unified vehicle report (plan 15) can tell an emptied list from a clean
   *  read and never attributes one car's codes to another. */
  readFor: HistoryVehicle | null;
  loading: boolean;
  error: string | null;
  /** Publish a real read from the adapter; stamps `lastReadAt`. */
  set: (r: DtcResult) => void;
  /** Empty the results (no session to read from) without counting it as a read; `lastReadAt`
   *  stays (first-run card), `readFor` goes back to null. */
  clearResults: () => void;
  setLoading: (v: boolean) => void;
  setError: (e: string | null) => void;
}

export const useDtcStore = create<DtcState>((set) => ({
  ...EMPTY_RESULT,
  lastReadAt: null,
  readFor: null,
  loading: false,
  error: null,
  set: (r) => set({ ...r, lastReadAt: Date.now(), readFor: activeCarStamp() }),
  clearResults: () => set({ ...EMPTY_RESULT, readFor: null }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
}));
