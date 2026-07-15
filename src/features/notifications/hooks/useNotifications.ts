/** Notification edge-detection and the `setNotifPrefs` sync are owned app-wide by EngineHost so they
 *  run whether or not the Notifications screen is mounted (and with REAL milOn/dtcCount). This hook
 *  remains as a no-op to keep the screen's public API stable. */
export function useNotifications(): void {
  // Intentionally empty — see EngineHost.
}
