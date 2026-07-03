import { create } from 'zustand';

export interface AdaptationBackup {
  did: string;
  module: string;
  raw: number[];
  at: number;
}

interface AdaptationsState {
  unlocked: boolean;
  running: boolean;
  /** Latest raw bytes read per DID. */
  values: Record<string, number[]>;
  backups: AdaptationBackup[];
  lastResult: string | null;
  setUnlocked: (u: boolean) => void;
  setRunning: (r: boolean) => void;
  setValue: (did: string, raw: number[]) => void;
  addBackup: (b: AdaptationBackup) => void;
  setLastResult: (r: string | null) => void;
}

export const useAdaptationsStore = create<AdaptationsState>((set) => ({
  unlocked: false,
  running: false,
  values: {},
  backups: [],
  lastResult: null,
  setUnlocked: (unlocked) => set({ unlocked }),
  setRunning: (running) => set({ running }),
  setValue: (did, raw) => set((s) => ({ values: { ...s.values, [did]: raw } })),
  addBackup: (b) => set((s) => ({ backups: [b, ...s.backups].slice(0, 50) })),
  setLastResult: (lastResult) => set({ lastResult }),
}));
