import { create } from 'zustand';

export interface ChartPanel {
  id: string;
  pids: string[];
  windowMs: number;
}

interface ChartsState {
  panels: ChartPanel[];
  setPanels: (p: ChartPanel[]) => void;
  setPanelPids: (id: string, pids: string[]) => void;
}

export const useChartsStore = create<ChartsState>((set) => ({
  panels: [
    { id: 'p1', pids: ['010C'], windowMs: 60_000 },
    { id: 'p2', pids: ['0105'], windowMs: 120_000 },
  ],
  setPanels: (panels) => set({ panels }),
  setPanelPids: (id, pids) =>
    set((s) => ({ panels: s.panels.map((p) => (p.id === id ? { ...p, pids } : p)) })),
}));
