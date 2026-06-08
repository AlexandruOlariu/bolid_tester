import { create } from 'zustand';
import type { Dtc } from '@/shared/obd-core/obd/dtc';

export interface DtcResult {
  stored: Dtc[];
  pending: Dtc[];
  permanent: Dtc[];
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
  loading: false,
  error: null,
  set: (r) => set({ ...r }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
}));
