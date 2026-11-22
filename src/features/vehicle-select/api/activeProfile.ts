/** Re-export: the active-profile helpers live in `src/shared/state/activeProfile.ts` (plan 06
 *  review), so features can read the active car without a feature → feature import. New code
 *  imports the shared path. See docs/features/vehicle-select.md. */
export {
  getActiveProfile,
  getActiveUserVehicle,
  useActiveProfile,
} from '@/shared/state/activeProfile';
