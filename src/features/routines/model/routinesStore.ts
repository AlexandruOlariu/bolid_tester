import { create } from 'zustand';

export type RoutinePhase = 'idle' | 'checking' | 'running' | 'done' | 'blocked' | 'error';

interface RoutinesState {
  unlocked: boolean;
  activeId: string | null;
  phase: RoutinePhase;
  message: string | null;
  interlockFailures: string[];
  liveValues: { name: string; value: number; unit: string }[];
  setUnlocked: (u: boolean) => void;
  setActive: (id: string | null, phase: RoutinePhase) => void;
  setPhase: (p: RoutinePhase) => void;
  setMessage: (m: string | null) => void;
  setInterlockFailures: (f: string[]) => void;
  setLiveValues: (v: { name: string; value: number; unit: string }[]) => void;
}

export const useRoutinesStore = create<RoutinesState>((set) => ({
  unlocked: false,
  activeId: null,
  phase: 'idle',
  message: null,
  interlockFailures: [],
  liveValues: [],
  setUnlocked: (unlocked) => set({ unlocked }),
  setActive: (activeId, phase) => set({ activeId, phase }),
  setPhase: (phase) => set({ phase }),
  setMessage: (message) => set({ message }),
  setInterlockFailures: (interlockFailures) => set({ interlockFailures }),
  setLiveValues: (liveValues) => set({ liveValues }),
}));
