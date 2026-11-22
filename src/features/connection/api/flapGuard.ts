/** Flap guard for auto-reconnect — pure, so the policy is unit-tested without timers or stores.
 *  A link that keeps dropping (adapter half out of the port, phone at the edge of range) would
 *  otherwise reconnect → drop → reconnect forever, hammering the adapter and the battery. After
 *  `MAX_DROPS_PER_WINDOW` unsolicited drops inside `FLAP_WINDOW_MS`, connectionService pauses
 *  auto-reconnect and asks the user to reconnect by hand. See docs/features/connection.md. */

/** Sliding window the drops are counted in. */
export const FLAP_WINDOW_MS = 60_000;
/** The drop that brings the in-window count to this number pauses auto-reconnect. */
export const MAX_DROPS_PER_WINDOW = 3;

/** Keep only drops inside the window (`now - FLAP_WINDOW_MS`, `now`]. */
export function pruneDrops(dropsAt: number[], now: number): number[] {
  return dropsAt.filter((t) => now - t < FLAP_WINDOW_MS && t <= now);
}

/** Drop timestamps (ms), including the drop being handled now. Returns true when another automatic
 *  reconnect is allowed: the 1st and 2nd drop in a minute reconnect, the 3rd pauses. */
export function shouldAutoReconnect(dropsAt: number[], now: number): boolean {
  return pruneDrops(dropsAt, now).length < MAX_DROPS_PER_WINDOW;
}
