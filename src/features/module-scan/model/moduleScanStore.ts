import { create } from 'zustand';
import type { UdsDtc, ModuleIdent, Tp20ModuleResult } from '@/shared/obd-core';
import type { DiagModule } from '@/shared/vehicles';

export interface ModuleScanResult {
  module: DiagModule;
  /** 'ok' scanned; 'silent' no response (module absent / not reachable); 'skipped' wrong transport
   *  (tp20 modules use the separate TP2.0 gateway scan) or non-CAN link; 'error' unexpected
   *  failure. */
  state: 'ok' | 'silent' | 'skipped' | 'error';
  reason?: string;
  ident?: ModuleIdent;
  dtcs: UdsDtc[];
}

interface ModuleScanState {
  running: boolean;
  progress: { done: number; total: number } | null;
  results: ModuleScanResult[];
  lastScanTs: number | null;
  tp20: { installed: number[]; modules: Tp20ModuleResult[] } | null;
  /** Why the last TP2.0 scan failed / degraded (probe failure, gateway unreachable) — for the UI. */
  tp20Error: string | null;
  setRunning: (running: boolean) => void;
  setProgress: (progress: { done: number; total: number } | null) => void;
  setResults: (results: ModuleScanResult[]) => void;
  upsertResult: (r: ModuleScanResult) => void;
  setLastScanTs: (ts: number | null) => void;
  setTp20: (tp20: { installed: number[]; modules: Tp20ModuleResult[] } | null) => void;
  setTp20Error: (tp20Error: string | null) => void;
}

export const useModuleScanStore = create<ModuleScanState>((set) => ({
  running: false,
  progress: null,
  results: [],
  lastScanTs: null,
  tp20: null,
  tp20Error: null,
  setRunning: (running) => set({ running }),
  setProgress: (progress) => set({ progress }),
  setResults: (results) => set({ results }),
  upsertResult: (r) =>
    set((s) => {
      const i = s.results.findIndex((x) => x.module.address === r.module.address);
      const results = s.results.slice();
      if (i >= 0) results[i] = r;
      else results.push(r);
      return { results };
    }),
  setLastScanTs: (lastScanTs) => set({ lastScanTs }),
  setTp20: (tp20) => set({ tp20 }),
  setTp20Error: (tp20Error) => set({ tp20Error }),
}));
