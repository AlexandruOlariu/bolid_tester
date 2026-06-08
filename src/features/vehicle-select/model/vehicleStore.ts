import { create } from 'zustand';

interface VehicleState {
  selectedProfileId: string;
  select: (id: string) => void;
}

export const useVehicleStore = create<VehicleState>((set) => ({
  selectedProfileId: 'generic',
  select: (selectedProfileId) => set({ selectedProfileId }),
}));
