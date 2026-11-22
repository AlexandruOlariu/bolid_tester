/** Re-export: the live-value store lives in `src/shared/state/liveDataStore.ts` (plan 14 review) so
 *  the Extended PIDs screen can register its DID keys without a feature → feature import. New code
 *  imports the shared path. See docs/features/live-data.md. */
export { useLiveDataStore } from '@/shared/state/liveDataStore';
