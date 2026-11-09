import { create } from 'zustand';
import type { UdsDtc, ModuleIdent, Tp20ModuleResult, DiscoveredModule } from '@/shared/obd-core';
import { diagModuleKey, type DiagModule } from '@/shared/vehicles';

export interface DiscoveryOwner {
  profileId: string;
  session: object;
}

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
  /** Last **Discover modules** run (plan 25): one row per probed candidate, or null. */
  discovery: DiscoveredModule[] | null;
  /** The car (active profile id) and live session the discovery ran on. A discovery from another
   *  car or connection is stale: the hook drops it instead of showing it or adding it to the
   *  current car's module list. */
  discoveryOwner: DiscoveryOwner | null;
  discoveryProgress: { done: number; total: number } | null;
  setRunning: (running: boolean) => void;
  setProgress: (progress: { done: number; total: number } | null) => void;
  setResults: (results: ModuleScanResult[]) => void;
  upsertResult: (r: ModuleScanResult) => void;
  setLastScanTs: (ts: number | null) => void;
  setTp20: (tp20: { installed: number[]; modules: Tp20ModuleResult[] } | null) => void;
  setTp20Error: (tp20Error: string | null) => void;
  /** `owner` is required with a result; clearing (`null`) clears the owner too. */
  setDiscovery: (discovery: DiscoveredModule[] | null, owner?: DiscoveryOwner) => void;
  setDiscoveryProgress: (p: { done: number; total: number } | null) => void;
}

export const useModuleScanStore = create<ModuleScanState>((set) => ({
  running: false,
  progress: null,
  results: [],
  lastScanTs: null,
  tp20: null,
  tp20Error: null,
  discovery: null,
  discoveryOwner: null,
  discoveryProgress: null,
  setRunning: (running) => set({ running }),
  setProgress: (progress) => set({ progress }),
  setResults: (results) => set({ results }),
  upsertResult: (r) =>
    set((s) => {
      // Keyed by transport + address: a UDS and a TP2.0 module can share an address.
      const key = diagModuleKey(r.module);
      const i = s.results.findIndex((x) => diagModuleKey(x.module) === key);
      const results = s.results.slice();
      if (i >= 0) results[i] = r;
      else results.push(r);
      return { results };
    }),
  setLastScanTs: (lastScanTs) => set({ lastScanTs }),
  setTp20: (tp20) => set({ tp20 }),
  setTp20Error: (tp20Error) => set({ tp20Error }),
  setDiscovery: (discovery, owner) =>
    set({ discovery, discoveryOwner: discovery && owner ? owner : null }),
  setDiscoveryProgress: (discoveryProgress) => set({ discoveryProgress }),
}));

/** The part number (F187) the last module scan read from the module at `reqHeader`, if any. A
 *  security-access plugin scoped by part-number prefix (plan 23) matches only this live value —
 *  never a profile's static, illustrative `partNumber` — so an unscanned module fails closed. */
export function scannedPartNumber(
  results: ModuleScanResult[],
  reqHeader: string,
): string | undefined {
  return results.find((r) => r.module.reqHeader === reqHeader)?.ident?.partNumber ?? undefined;
}
