/** Re-export: the panel store lives in `src/shared/state/chartsStore.ts` (plan 14) so the Extended
 *  PIDs screen can add a panel without a feature → feature import. */
export {
  useChartsStore,
  nextPanelId,
  MAX_PANEL_SERIES,
  DEFAULT_PANEL_WINDOW_MS,
  INITIAL_PANELS,
} from '@/shared/state/chartsStore';
export type { ChartPanel } from '@/shared/state/chartsStore';
