import { create } from 'zustand';
import type { Trip, TripSample, TripMarker } from '@/shared/obd-core';

interface TripState {
  recording: boolean;
  startedAt: number | null;
  samples: TripSample[];
  markers: TripMarker[];
  trips: Trip[];
  start: () => void;
  pushSample: (s: TripSample) => void;
  pushMarker: (m: TripMarker) => void;
  finish: (trip: Trip) => void;
  removeTrip: (id: string) => void;
}

export const useTripStore = create<TripState>((set) => ({
  recording: false,
  startedAt: null,
  samples: [],
  markers: [],
  trips: [],
  start: () => set({ recording: true, startedAt: Date.now(), samples: [], markers: [] }),
  pushSample: (s) => set((st) => (st.recording ? { samples: [...st.samples, s] } : {})),
  pushMarker: (m) => set((st) => (st.recording ? { markers: [...st.markers, m] } : {})),
  finish: (trip) => set((st) => ({ recording: false, startedAt: null, trips: [trip, ...st.trips] })),
  removeTrip: (id) => set((st) => ({ trips: st.trips.filter((t) => t.header.id !== id) })),
}));
