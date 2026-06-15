import { create } from 'zustand';

export interface CodingBackup {
  module: string;
  did: string;
  bytes: number[];
  at: number;
}

interface CodingState {
  unlocked: boolean;
  current: Record<string, number[]>; // moduleId -> current edited coding
  backups: CodingBackup[];
  lastResult: string | null;
  setUnlocked: (u: boolean) => void;
  setCurrent: (moduleId: string, bytes: number[]) => void;
  addBackup: (b: CodingBackup) => void;
  setLastResult: (r: string | null) => void;
}

export const useCodingStore = create<CodingState>((set) => ({
  unlocked: false,
  current: {},
  backups: [],
  lastResult: null,
  setUnlocked: (unlocked) => set({ unlocked }),
  setCurrent: (moduleId, bytes) => set((s) => ({ current: { ...s.current, [moduleId]: bytes } })),
  addBackup: (b) => set((s) => ({ backups: [b, ...s.backups] })),
  setLastResult: (lastResult) => set({ lastResult }),
}));
