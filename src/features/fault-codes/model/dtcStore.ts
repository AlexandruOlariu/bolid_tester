import { create } from 'zustand';
import type { Dtc } from '@/shared/obd-core/obd/dtc';
import type { MonitorStatus } from '@/shared/obd-core/obd/readiness';
import type { FreezeFrame } from '@/shared/obd-core/session/DiagnosticSession';

export interface DtcResult {
  stored: Dtc[];
  pending: Dtc[];
  permanent: Dtc[];
  readiness: MonitorStatus | null;
  freezeFrame: FreezeFrame | null;
}

interface DtcState extends DtcResult {
  loading: boolean;
  error: string | null;
  set: (r: DtcResult) => void;
  setLoading: (v: boolean) => void;
  setError: (e: string | null) => void;
}

export const useDtcStore = create<DtcState>((set) => ({
  stored: [],
  pending: [],
  permanent: [],
  readiness: null,
  freezeFrame: null,
  loading: false,
  error: null,
  set: (r) => set({ ...r }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
}));
