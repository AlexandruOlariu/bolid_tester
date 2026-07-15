import { useAlertsStore } from '../model/alertsStore';

/** Read the currently-active alerts. Evaluation, default-rule seeding, and OS notifications are
 *  owned app-wide by EngineHost (they run whether or not the Alerts screen is mounted), so this hook
 *  is now just a store subscription — its public shape is unchanged for the screen. */
export function useAlerts() {
  return { active: useAlertsStore((s) => s.active) };
}
