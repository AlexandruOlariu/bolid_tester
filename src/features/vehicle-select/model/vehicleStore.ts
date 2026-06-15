import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { fileStateStorage } from '@/shared/state/persistStorage';

interface VehicleState {
  selectedProfileId: string;
  select: (id: string) => void;
}

export const useVehicleStore = create<VehicleState>()(
  persist(
    (set) => ({
      selectedProfileId: 'generic',
      select: (selectedProfileId) => set({ selectedProfileId }),
    }),
    {
      name: 'bolid.vehicle',
      version: 1,
      storage: createJSONStorage(() => fileStateStorage),
    },
  ),
);
