/** Persistent history of completed auto-scans, so two scans can be diffed ("did the repair work?" /
 *  used-car baseline) and any scan re-shared as a report. File-backed via the shared persist storage
 *  (key 'bolid.scans'), capped and debounced exactly like historyStore (findings F7). A scan is a
 *  compact, serializable SNAPSHOT — not the live ModuleScanResult[] (which embeds the whole
 *  DiagModule); `buildSavedScan` normalizes results into it. See docs/features/module-scan.md. */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { fileStateStorage, debouncedStorage } from '@/shared/state/persistStorage';
import type { HistoryVehicle } from '@/shared/state/historyStore';
import type { ModuleScanResult } from './moduleScanStore';
import type { Tp20ModuleResult } from '@/shared/obd-core';

/** One fault in a saved scan (the fields the report / diff / search need). */
export interface SavedScanDtc {
  /** SAE code, e.g. 'P2183'. */
  sae: string;
  /** Display form with failure type, e.g. 'P2183 00'. */
  display: string;
  /** VAG 5-digit number (VCDS), e.g. '08579' ('' for non-P codes). */
  vagCode: string;
  description: string;
  /** ISO 14229 status byte (re-decoded for flags in the report). */
  status: number;
}

export interface SavedScanModule {
  address: string;
  name: string;
  state: ModuleScanResult['state'];
  reason?: string;
  partNumber?: string;
  softwareVersion?: string;
  hardwareNumber?: string;
  systemName?: string;
  /** Long coding, when known. A plain module scan does not read coding (that is the Coding screen);
   *  present for forward-compat / imported scans. */
  coding?: string;
  experimental?: boolean;
  dtcs: SavedScanDtc[];
}

/** A pre-UDS (TP2.0) module in a saved scan. */
export interface SavedScanTp20Module {
  address: number;
  name: string;
  state: string;
  ident?: string;
  dtcs?: { vag: string; status: number }[];
}

export interface SavedScan {
  id: string;
  ts: number;
  vehicle: HistoryVehicle;
  /** Protocol display label at scan time, e.g. 'ISO 15765-4 CAN (11-bit, 500 kbps)'. */
  protocol: string;
  modules: SavedScanModule[];
  tp20?: { installed: number[]; modules: SavedScanTp20Module[] } | null;
}

/** Cap on retained scans — newest kept, oldest dropped (mirrors MAX_HISTORY), so the file and the
 *  launch-time hydration stay bounded even after many scans. */
export const MAX_SCANS = 50;

const SCANS_PERSIST_DEBOUNCE_MS = 500;

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Normalize live scan results into a compact, serializable SavedScan. `id`/`ts` default to now. */
export function buildSavedScan(input: {
  vehicle: HistoryVehicle;
  protocol: string;
  results: ModuleScanResult[];
  tp20?: { installed: number[]; modules: Tp20ModuleResult[] } | null;
  ts?: number;
  id?: string;
}): SavedScan {
  return {
    id: input.id ?? newId(),
    ts: input.ts ?? Date.now(),
    vehicle: input.vehicle,
    protocol: input.protocol,
    modules: input.results.map((r) => ({
      address: r.module.address,
      name: r.module.name,
      state: r.state,
      reason: r.reason,
      partNumber: r.ident?.partNumber,
      softwareVersion: r.ident?.softwareVersion,
      hardwareNumber: r.ident?.hardwareNumber,
      systemName: r.ident?.systemName,
      experimental: r.module.experimental,
      dtcs: r.dtcs.map((d) => ({
        sae: d.sae,
        display: d.display,
        vagCode: d.vagCode,
        description: d.description,
        status: d.status,
      })),
    })),
    tp20: input.tp20
      ? {
          installed: input.tp20.installed,
          modules: input.tp20.modules.map((m) => ({
            address: m.address,
            name: m.name,
            state: m.state,
            ident: m.ident,
            dtcs: m.dtcs?.map((d) => ({ vag: d.vag, status: d.status })),
          })),
        }
      : null,
  };
}

interface ScanHistoryState {
  scans: SavedScan[];
  /** Save a completed scan (prepended, capped). Returns the stored scan (with id/ts filled in). */
  saveScan: (scan: SavedScan) => void;
  remove: (id: string) => void;
  clear: () => void;
}

function withScan(scans: SavedScan[], scan: SavedScan): SavedScan[] {
  return [scan, ...scans].slice(0, MAX_SCANS);
}

export const useScanHistoryStore = create<ScanHistoryState>()(
  persist(
    (set) => ({
      scans: [],
      saveScan: (scan) => set((s) => ({ scans: withScan(s.scans, scan) })),
      remove: (id) => set((s) => ({ scans: s.scans.filter((x) => x.id !== id) })),
      clear: () => set({ scans: [] }),
    }),
    {
      name: 'bolid.scans',
      storage: createJSONStorage(() =>
        debouncedStorage(fileStateStorage, SCANS_PERSIST_DEBOUNCE_MS),
      ),
      // Concatenate scans saved during the async rehydration window with the persisted ones
      // (newest-first, deduped by id, capped) rather than letting the persisted array overwrite
      // them — the same safety net historyStore uses.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<ScanHistoryState>;
        const persistedScans = Array.isArray(p.scans) ? p.scans : [];
        const seen = new Set<string>();
        const scans: SavedScan[] = [];
        for (const sc of [...current.scans, ...persistedScans]) {
          if (sc && !seen.has(sc.id)) {
            seen.add(sc.id);
            scans.push(sc);
          }
        }
        return { ...current, ...p, scans: scans.slice(0, MAX_SCANS) };
      },
    },
  ),
);
