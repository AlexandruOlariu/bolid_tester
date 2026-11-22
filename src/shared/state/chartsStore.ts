/** Chart panel definitions (in-memory). Lives in shared/state so a feature other than live-charts —
 *  the Extended PIDs screen's "Chart this" / "Chart group" — can add a panel without a
 *  feature → feature import. A panel's `pids` are opaque live-value keys: Mode 01 PIDs (`'010C'`)
 *  or extended keys (`'22:1701'`, plan 14). See docs/features/live-charts.md. */
import { create } from 'zustand';

export interface ChartPanel {
  id: string;
  pids: string[];
  windowMs: number;
}

/** Most series one panel overlays (one colour each; VCDS groups are ≤ 4 values). */
export const MAX_PANEL_SERIES = 4;

export const DEFAULT_PANEL_WINDOW_MS = 60_000;

interface ChartsState {
  panels: ChartPanel[];
  setPanels: (p: ChartPanel[]) => void;
  setPanelPids: (id: string, pids: string[]) => void;
  /** Append a panel `{ id: 'p<n>', pids, windowMs }` (keys capped at MAX_PANEL_SERIES); returns its id. */
  addPanel: (pids: string[], windowMs?: number) => string;
  removePanel: (id: string) => void;
}

/** The next free `p<n>` id: one past the highest numeric suffix in use. */
export function nextPanelId(panels: ChartPanel[]): string {
  let max = 0;
  for (const p of panels) {
    const n = /^p(\d+)$/.exec(p.id);
    if (n) max = Math.max(max, Number(n[1]));
  }
  return `p${max + 1}`;
}

export const INITIAL_PANELS: ChartPanel[] = [
  { id: 'p1', pids: ['010C'], windowMs: 60_000 },
  { id: 'p2', pids: ['0105'], windowMs: 120_000 },
];

export const useChartsStore = create<ChartsState>((set, get) => ({
  panels: INITIAL_PANELS.map((p) => ({ ...p, pids: [...p.pids] })),
  setPanels: (panels) => set({ panels }),
  setPanelPids: (id, pids) =>
    set((s) => ({
      panels: s.panels.map((p) =>
        p.id === id ? { ...p, pids: pids.slice(0, MAX_PANEL_SERIES) } : p,
      ),
    })),
  addPanel: (pids, windowMs = DEFAULT_PANEL_WINDOW_MS) => {
    const id = nextPanelId(get().panels);
    const unique = [...new Set(pids)].slice(0, MAX_PANEL_SERIES);
    set((s) => ({ panels: [...s.panels, { id, pids: unique, windowMs }] }));
    return id;
  },
  removePanel: (id) => set((s) => ({ panels: s.panels.filter((p) => p.id !== id) })),
}));
