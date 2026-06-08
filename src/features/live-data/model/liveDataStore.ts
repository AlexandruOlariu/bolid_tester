import { create } from 'zustand';
import type { LiveValue } from '@/shared/obd-core/session/DiagnosticSession';

interface LiveDataState {
  values: Record<string, LiveValue>;
  polling: boolean;
  setValues: (v: Record<string, LiveValue>) => void;
  setPolling: (v: boolean) => void;
}

export const useLiveDataStore = create<LiveDataState>((set) => ({
  values: {},
  polling: false,
  setValues: (values) => set({ values }),
  setPolling: (polling) => set({ polling }),
}));
