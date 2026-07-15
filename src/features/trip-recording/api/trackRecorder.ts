/** GPS track capture for trip recording. Accumulates a coarse **foreground** GPS track
 *  (expo-location) alongside the OBD sample firehose; the track is attached to the finished Trip on
 *  stop so it round-trips through the CSV (see obd-core/analysis/trip.ts `toCsv`/`trackFromCsv`).
 *
 *  expo-location is loaded via a variable specifier so the project builds and unit-tests without the
 *  native module present — the same dependency-tolerant pattern as `shared/notify`. Any degrade path —
 *  module missing, permission denied, or a watcher error — leaves recording untouched: capture becomes
 *  a no-op and the trip simply carries no track. A single warning is logged for a real failure (a
 *  present-but-denied/broken location service); a merely-absent module is an expected silent no-op.
 *  See docs/features/trip-recording.md. */
import type { TrackPoint } from '@/shared/obd-core';
import { logError } from '@/shared/state/errorLogStore';

const LOCATION_MODULE = 'expo-location';

/** Coarse cadence: at most one fix per ~5 s or ~25 m of movement — battery-friendly and matched to the
 *  trip's own sampling rate. Fine enough for a distance/odometer sanity check, not a survey trace. */
const TIME_INTERVAL_MS = 5000;
const DISTANCE_INTERVAL_M = 25;

// Module-level singleton: exactly one recording (and thus one capture) runs at a time.
let points: TrackPoint[] = [];
let subscription: { remove: () => void } | null = null;
let active = false;
// One-shot guard so a persistent degrade (e.g. permission permanently denied) is logged once, not on
// every Record press.
let warned = false;

/** Load expo-location, or null when it is simply not installed (tests / web). A missing module is an
 *  expected no-op and must NOT be logged; only a present-but-failing service is a real failure. */
async function loadLocation(): Promise<any> {
  try {
    return await import(LOCATION_MODULE as string);
  } catch {
    return null;
  }
}

function warnOnce(error: unknown): void {
  if (warned) return;
  warned = true;
  logError({ source: 'trip-recording/gps', error, severity: 'warning' });
}

/** Begin accumulating a GPS track for the current recording. Requests foreground location permission;
 *  on a missing module, denied permission, or a watcher error it degrades to no capture (never throws)
 *  so trip recording is never blocked. Idempotent: a call while already capturing is a no-op. */
export async function startTrackCapture(): Promise<void> {
  if (active) return;
  active = true;
  points = [];
  const Location = await loadLocation();
  if (!Location) {
    active = false; // module absent (tests / web) — silent no-op, trip records without a track
    return;
  }
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      warnOnce(new Error(`location permission not granted (${status})`));
      active = false;
      return;
    }
    subscription = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy?.Balanced ?? 3,
        timeInterval: TIME_INTERVAL_MS,
        distanceInterval: DISTANCE_INTERVAL_M,
      },
      (pos: any) => {
        const c = pos?.coords;
        if (!c || typeof c.latitude !== 'number' || typeof c.longitude !== 'number') return;
        points.push({
          t: typeof pos.timestamp === 'number' ? pos.timestamp : Date.now(),
          lat: c.latitude,
          lon: c.longitude,
          // expo-location reports ground speed in m/s; -1/absent means "unknown".
          speed: typeof c.speed === 'number' && c.speed >= 0 ? c.speed : null,
        });
      },
    );
  } catch (e) {
    warnOnce(e);
    active = false;
  }
}

/** Stop capturing and return the accumulated track (possibly empty). Always safe to call — even when
 *  capture never started or was denied — and resets the buffer for the next recording. */
export function stopTrackCapture(): TrackPoint[] {
  if (subscription) {
    try {
      subscription.remove();
    } catch (e) {
      warnOnce(e);
    }
    subscription = null;
  }
  active = false;
  const out = points;
  points = [];
  return out;
}

/** Whether a GPS capture is currently active (permission granted + watcher running). */
export function isTrackCapturing(): boolean {
  return active;
}
