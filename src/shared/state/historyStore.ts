/** Persistent history of diagnostic activity: every AI auto-diagnose run and every fault-code check,
 *  each **linked to a car**. File-backed (expo-file-system) via the shared persist storage, so it
 *  survives launches. Unlimited retention until the user clears it. See docs/features/history.md. */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { fileStateStorage } from './persistStorage';
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

export const useHistoryStore = create<HistoryState>()(
  persist(
    (set) => ({
      entries: [],
      addAiRun: ({ ts, ...rest }) =>
        set((s) => ({ entries: [{ kind: 'ai', id: newId(), ts: ts ?? Date.now(), ...rest }, ...s.entries] })),
      addDtcCheck: ({ ts, ...rest }) =>
        set((s) => ({ entries: [{ kind: 'dtc', id: newId(), ts: ts ?? Date.now(), ...rest }, ...s.entries] })),
      remove: (id) => set((s) => ({ entries: s.entries.filter((x) => x.id !== id) })),
      clear: () => set({ entries: [] }),
    }),
    {
      name: 'bolid.history',
      version: 2,
      storage: createJSONStorage(() => fileStateStorage),
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
    },
  ),
);
