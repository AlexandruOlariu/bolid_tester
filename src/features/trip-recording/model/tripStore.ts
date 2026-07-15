/** Trip recording store. The **in-progress** recording (samples + markers) lives in memory only —
 *  it is a transient firehose that becomes a CSV on stop. What persists across launches is the
 *  lightweight **trip summary** list (header + stats + marker count, NOT the samples): the full
 *  sample grid is lazy-loaded from `trip-<id>.csv` when a trip is opened (finding F6). File I/O
 *  (CSV write/read/delete/share) lives in the feature layer — see hooks/useTripRecorder.ts — so this
 *  store stays free of native (expo) imports. Persisted via the shared file storage with debounced
 *  writes (key `bolid.trips`). See docs/features/trip-recording.md. */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { fileStateStorage, debouncedStorage } from '@/shared/state/persistStorage';
import type { TripSample, TripMarker, TripHeader, TripStats } from '@/shared/obd-core';

/** Persisted, samples-free record of a finished trip. Everything needed to list a trip; the sample
 *  grid is read from the CSV on demand. */
export interface TripSummary {
  header: TripHeader;
  stats: TripStats;
  markerCount: number;
}

/** Coalesce persist writes: adding/removing trips rewrites the JSON once, ~500 ms after the last
 *  change, rather than once per mutation. */
const TRIPS_PERSIST_DEBOUNCE_MS = 500;

interface TripState {
  recording: boolean;
  startedAt: number | null;
  samples: TripSample[];
  markers: TripMarker[];
  trips: TripSummary[];
  start: () => void;
  pushSample: (s: TripSample) => void;
  pushMarker: (m: TripMarker) => void;
  /** Record a finished trip's summary and clear the in-progress buffers. The caller (stopRecording)
   *  has already written the CSV and computed the stats. */
  finish: (summary: TripSummary) => void;
  /** Remove a trip's summary from the list. CSV deletion is done by the feature-layer `deleteTrip`. */
  removeTrip: (id: string) => void;
}

export const useTripStore = create<TripState>()(
  persist(
    (set) => ({
      recording: false,
      startedAt: null,
      samples: [],
      markers: [],
      trips: [],
      start: () => set({ recording: true, startedAt: Date.now(), samples: [], markers: [] }),
      pushSample: (s) => set((st) => (st.recording ? { samples: [...st.samples, s] } : {})),
      pushMarker: (m) => set((st) => (st.recording ? { markers: [...st.markers, m] } : {})),
      finish: (summary) =>
        set((st) => ({ recording: false, startedAt: null, samples: [], markers: [], trips: [summary, ...st.trips] })),
      removeTrip: (id) => set((st) => ({ trips: st.trips.filter((t) => t.header.id !== id) })),
    }),
    {
      name: 'bolid.trips',
      version: 1,
      storage: createJSONStorage(() => debouncedStorage(fileStateStorage, TRIPS_PERSIST_DEBOUNCE_MS)),
      // Persist only the summary list — never the transient in-progress recording buffers.
      partialize: (s) => ({ trips: s.trips }),
      // A trip finished during the async rehydration window lives in `current.trips`; concatenate
      // (current first) and dedupe by header id so it isn't overwritten by the persisted array.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<TripState>;
        const persistedTrips = Array.isArray(p.trips) ? p.trips : [];
        const seen = new Set<string>();
        const trips: TripSummary[] = [];
        for (const t of [...current.trips, ...persistedTrips]) {
          if (t && !seen.has(t.header.id)) {
            seen.add(t.header.id);
            trips.push(t);
          }
        }
        return { ...current, ...p, trips };
      },
    },
  ),
);
