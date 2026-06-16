import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { fileStateStorage } from '@/shared/state/persistStorage';
import { DEFAULT_SERVICE_ITEMS, ServiceItem, LogEntry } from '@/shared/obd-core';

interface MaintenanceState {
  items: ServiceItem[];
  entries: LogEntry[];
  odoKm: number | null;
  kmPerYear: number;
  setOdometer: (v: number | null) => void;
  setKmPerYear: (v: number) => void;
  addEntry: (e: Omit<LogEntry, 'id'>) => void;
  removeEntry: (id: string) => void;
}

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export const useMaintenanceStore = create<MaintenanceState>()(
  persist(
    (set) => ({
      items: DEFAULT_SERVICE_ITEMS,
      entries: [],
      odoKm: null,
      kmPerYear: 15000,
      setOdometer: (odoKm) => set({ odoKm }),
      setKmPerYear: (kmPerYear) => set({ kmPerYear }),
      addEntry: (e) => set((s) => ({ entries: [{ id: newId(), ...e }, ...s.entries] })),
      removeEntry: (id) => set((s) => ({ entries: s.entries.filter((x) => x.id !== id) })),
    }),
    {
      name: 'bolid.maintenance',
      version: 1,
      storage: createJSONStorage(() => fileStateStorage),
      // Keep the default catalogue fresh across launches; only entries/odometer are user data.
      partialize: (s) => ({ entries: s.entries, odoKm: s.odoKm, kmPerYear: s.kmPerYear }),
      merge: (persisted, current) => ({ ...current, ...(persisted as object) }),
    },
  ),
);
