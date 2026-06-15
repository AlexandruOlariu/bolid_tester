import { create } from 'zustand';

interface ServiceResetState {
  running: boolean;
  lastResult: string | null;
  setRunning: (r: boolean) => void;
  setLastResult: (r: string | null) => void;
}

export const useServiceResetStore = create<ServiceResetState>((set) => ({
  running: false,
  lastResult: null,
  setRunning: (running) => set({ running }),
  setLastResult: (lastResult) => set({ lastResult }),
}));
