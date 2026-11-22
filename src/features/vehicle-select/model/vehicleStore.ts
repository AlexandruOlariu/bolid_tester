/** Re-export: the selection store lives in `src/shared/state/vehicleStore.ts` (plan 06 review), so
 *  features can read it without a feature → feature import. New code imports the shared path. */
export { useVehicleStore } from '@/shared/state/vehicleStore';
