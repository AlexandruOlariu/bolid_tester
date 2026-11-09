/** The selected vehicle id (`bolid.vehicle` v1): a registry profile id or a garage `user:` id.
 *  Lives in shared/state because most features read the active car (through `activeProfile.ts`);
 *  `features/vehicle-select/model/vehicleStore.ts` re-exports it for the older call sites. See
 *  docs/features/vehicle-select.md. */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { fileStateStorage } from './persistStorage';

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
