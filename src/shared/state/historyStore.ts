/** Persistent history of diagnostic activity: every AI auto-diagnose run and every fault-code check,
 *  each **linked to a car**. File-backed (expo-file-system) via the shared persist storage, so it
 *  survives launches.
 *
 *  Retention is capped at `MAX_HISTORY` newest entries (oldest evicted) so the file can't grow
 *  without bound — each AI entry embeds a full `AiReport`, so unbounded growth meant an
 *  ever-larger `JSON.stringify` on every save and slow hydration at launch (finding F7). Writes are
 *  debounced (see `debouncedStorage`) so a burst of adds/removes rewrites the file once, not once
 *  per mutation. The embedded `AiReport` is kept intact — the detail view re-opens it. See
 *  docs/features/history.md. */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { fileStateStorage, debouncedStorage } from './persistStorage';
import type { AiReport, Dtc } from '@/shared/obd-core';

/** Identity of the car an entry belongs to. `vin` is the true per-car key when the ECU reports it;
 *  otherwise we fall back to the selected profile `id`. `label` is for display. */
export interface HistoryVehicle {
  id: string;
  label: string;
  vin: string | null;
}

/** Stable grouping key for a car: VIN when known, else the profile id. */
export function historyVehicleKey(v: HistoryVehicle): string {
  return v.vin && v.vin.length > 0 ? `vin:${v.vin}` : `id:${v.id}`;
}

/** Chip/label text for a car, disambiguated by a VIN suffix when present. */
export function historyVehicleChipLabel(v: HistoryVehicle): string {
  return v.vin && v.vin.length >= 5 ? `${v.label} ·${v.vin.slice(-5)}` : v.label;
}

/** A saved AI auto-diagnose run. */
export interface AiHistoryEntry {
  kind: 'ai';
  id: string;
  ts: number;
  vehicle: HistoryVehicle;
  source: AiReport['source'];
  overall: AiReport['overall'];
  summary: string;
  findingCount: number;
  /** The full report, so the entry can be re-opened in detail later. */
  report: AiReport;
}

/** A saved fault-code read (Fault codes screen). */
export interface DtcHistoryEntry {
  kind: 'dtc';
  id: string;
  ts: number;
  vehicle: HistoryVehicle;
  milOn: boolean | null;
  stored: Dtc[];
  pending: Dtc[];
  permanent: Dtc[];
  monitorsComplete: number | null;
  monitorsTotal: number | null;
}

export type HistoryEntry = AiHistoryEntry | DtcHistoryEntry;

/** Hard cap on retained entries — newest kept, oldest dropped (mirrors `MAX_ERRORS` in
 *  errorLogStore), so the file and the launch-time hydration stay bounded. */
export const MAX_HISTORY = 200;

/** Coalesce persist writes: a burst of adds/removes rewrites the JSON file once, ~500 ms after the
 *  last mutation, instead of once per mutation. */
const HISTORY_PERSIST_DEBOUNCE_MS = 500;

interface HistoryState {
  entries: HistoryEntry[];
  addAiRun: (e: Omit<AiHistoryEntry, 'kind' | 'id' | 'ts'> & { ts?: number }) => void;
  addDtcCheck: (e: Omit<DtcHistoryEntry, 'kind' | 'id' | 'ts'> & { ts?: number }) => void;
  remove: (id: string) => void;
  clear: () => void;
}

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Prepend an entry and evict the oldest beyond the cap. */
function withEntry(entries: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  return [entry, ...entries].slice(0, MAX_HISTORY);
}

export const useHistoryStore = create<HistoryState>()(
  persist(
    (set) => ({
      entries: [],
      addAiRun: ({ ts, ...rest }) =>
        set((s) => ({
          entries: withEntry(s.entries, { kind: 'ai', id: newId(), ts: ts ?? Date.now(), ...rest }),
        })),
      addDtcCheck: ({ ts, ...rest }) =>
        set((s) => ({
          entries: withEntry(s.entries, { kind: 'dtc', id: newId(), ts: ts ?? Date.now(), ...rest }),
        })),
      remove: (id) => set((s) => ({ entries: s.entries.filter((x) => x.id !== id) })),
      clear: () => set({ entries: [] }),
    }),
    {
      name: 'bolid.history',
      version: 2,
      storage: createJSONStorage(() => debouncedStorage(fileStateStorage, HISTORY_PERSIST_DEBOUNCE_MS)),
      // v1 entries had a flat `vehicleLabel`; lift it into a `vehicle` descriptor.
      migrate: (persisted, version) => {
        const s = (persisted ?? {}) as { entries?: unknown };
        const raw = Array.isArray(s.entries) ? s.entries : [];
        if (version < 2) {
          const entries = raw.map((item) => {
            const e = item as Record<string, unknown>;
            if (e && typeof e === 'object' && !('vehicle' in e)) {
              return {
                ...e,
                vehicle: { id: 'unknown', label: (e.vehicleLabel as string) ?? 'Unknown vehicle', vin: null },
              };
            }
            return e;
          });
          return { entries } as unknown as HistoryState;
        }
        return s as unknown as HistoryState;
      },
      // Entries added during the async (file-backed) rehydration window live in `current.entries`;
      // the default merge would discard them by overwriting with the persisted array. Concatenate
      // instead — newest first (current before persisted), deduped by id, capped — mirroring the
      // errorLogStore safety net so an early add still survives.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<HistoryState>;
        const persistedEntries = Array.isArray(p.entries) ? p.entries : [];
        const seen = new Set<string>();
        const entries: HistoryEntry[] = [];
        for (const e of [...current.entries, ...persistedEntries]) {
          if (e && !seen.has(e.id)) {
            seen.add(e.id);
            entries.push(e);
          }
        }
        return { ...current, ...p, entries: entries.slice(0, MAX_HISTORY) };
      },
    },
  ),
);
