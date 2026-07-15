import { create } from 'zustand';
import type { LiveValue } from '@/shared/obd-core/session/DiagnosticSession';

interface LiveDataState {
  values: Record<string, LiveValue>;
  polling: boolean;
  /** PID interest per subscriber id — the union drives what the app-wide poll loop reads. A screen
   *  registers the set it wants shown; when the last subscriber releases (and nothing is recording)
   *  the loop idles with no bus traffic. */
  registrations: Record<string, string[]>;
  setValues: (v: Record<string, LiveValue>) => void;
  setPolling: (v: boolean) => void;
  /** Register a subscriber's PID interest; returns a release function (idempotent). */
  acquire: (id: string, pids: string[]) => () => void;
  release: (id: string) => void;
}

export const useLiveDataStore = create<LiveDataState>((set, get) => ({
  values: {},
  polling: false,
  registrations: {},
  setValues: (values) => set({ values }),
  setPolling: (polling) => set({ polling }),
  acquire: (id, pids) => {
    set((s) => ({ registrations: { ...s.registrations, [id]: pids } }));
    return () => get().release(id);
  },
  release: (id) =>
    set((s) => {
      if (!(id in s.registrations)) return {};
      const next = { ...s.registrations };
      delete next[id];
      return { registrations: next };
    }),
}));
