/** GPS track capture for trip recording. Accumulates a coarse **foreground** GPS track
 *  (expo-location) alongside the OBD sample firehose; the track is attached to the finished Trip on
 *  stop so it round-trips through the CSV (see obd-core/analysis/trip.ts `toCsv`/`trackFromCsv`).
 *
 *  expo-location is loaded via a variable specifier so the project builds and unit-tests without the
 *  native module present — the same dependency-tolerant pattern as `shared/notify`. Any degrade path —
 *  module missing, permission denied, or a watcher error — leaves recording untouched: capture becomes
 *  a no-op and the trip simply carries no track. A single warning is logged for a real failure (a
 *  present-but-denied/broken location service); a merely-absent module is an expected silent no-op.
 *
 *  In the **simulator** (`settingsStore.adapterSource === 'mock'`) no location service is touched:
 *  a deterministic synthetic generator walks the 2 km loop of `syntheticLoopPoint` (obd-core
 *  `analysis/track.ts`) at the live `010D` speed instead (each step a straight line of speed × time,
 *  `syntheticLoopAdvance`, so GPS and OBD distances agree), so the trip detail map is demoable and
 *  testable without a car (plan 17). `isSyntheticTrack()` tells the UI to badge it "simulated GPS".
 *  See docs/features/trip-recording.md. */
import { syntheticLoopAdvance, syntheticLoopPoint, type TrackPoint } from '@/shared/obd-core';
import { logError } from '@/shared/state/errorLogStore';
import { useSettingsStore } from '@/shared/state/settingsStore';
import { useLiveDataStore } from '@/shared/state/liveDataStore';

const LOCATION_MODULE = 'expo-location';

/** Coarse cadence: at most one fix per ~5 s or ~25 m of movement — battery-friendly and matched to the
 *  trip's own sampling rate. Fine enough for a distance/odometer sanity check, not a survey trace. */
const TIME_INTERVAL_MS = 5000;
const DISTANCE_INTERVAL_M = 25;

// Module-level singleton: exactly one recording (and thus one capture) runs at a time.
let points: TrackPoint[] = [];
let subscription: { remove: () => void } | null = null;
let active = false;
// Simulator mode: the synthetic generator's timer, distance along the loop, and whether the capture
// running (or the one stopTrackCapture last returned) is synthetic.
let syntheticTimer: ReturnType<typeof setInterval> | null = null;
let syntheticDistanceM = 0;
let synthetic = false;
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

/** Synthetic-track speed when the simulator publishes no `010D` (not connected yet), in km/h. */
const SYNTHETIC_DEFAULT_KMH = 40;

/** The live simulator speed (`010D`, km/h), or the default when absent. */
function liveSpeedKmh(): number {
  const v = useLiveDataStore.getState().values['010D']?.value;
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : SYNTHETIC_DEFAULT_KMH;
}

/** Advance the synthetic position by the live speed over the time since the last point and push a
 *  fix there (speed in m/s, like expo-location). The step is taken as the straight line from the
 *  last fix (`syntheticLoopAdvance`), so the GPS distance matches the OBD distance at any speed. */
function pushSyntheticPoint(now: number): void {
  const kmh = liveSpeedKmh();
  const last = points[points.length - 1];
  if (last) {
    syntheticDistanceM = syntheticLoopAdvance(
      syntheticDistanceM,
      (kmh / 3.6) * ((now - last.t) / 1000),
    );
  }
  const { lat, lon } = syntheticLoopPoint(syntheticDistanceM);
  points.push({ t: now, lat, lon, speed: kmh / 3.6 });
}

function startSyntheticCapture(): void {
  synthetic = true;
  syntheticDistanceM = 0;
  pushSyntheticPoint(Date.now());
  syntheticTimer = setInterval(() => pushSyntheticPoint(Date.now()), TIME_INTERVAL_MS);
}

/** A tail shorter than this is not worth a closing fix. */
const SYNTHETIC_MIN_TAIL_MS = 500;

/** Begin accumulating a GPS track for the current recording. In the simulator it starts the synthetic
 *  generator; otherwise it requests foreground location permission and, on a missing module, denied
 *  permission, or a watcher error, degrades to no capture (never throws) so trip recording is never
 *  blocked. Idempotent: a call while already capturing is a no-op. */
export async function startTrackCapture(): Promise<void> {
  if (active) return;
  active = true;
  points = [];
  synthetic = false;
  if (useSettingsStore.getState().adapterSource === 'mock') {
    startSyntheticCapture();
    return;
  }
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
  if (syntheticTimer) {
    clearInterval(syntheticTimer);
    syntheticTimer = null;
    // Close the track at the stop time so the GPS distance covers the whole recording, as the OBD
    // samples do (a fix only every 5 s would otherwise drop up to 5 s of driving).
    const last = points[points.length - 1];
    const now = Date.now();
    if (last && now - last.t >= SYNTHETIC_MIN_TAIL_MS) pushSyntheticPoint(now);
  }
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

/** Whether a GPS capture is currently active (permission granted + watcher running, or the
 *  simulator's synthetic generator). */
export function isTrackCapturing(): boolean {
  return active;
}

/** Whether the running capture — or, after a stop, the track `stopTrackCapture` last returned — is
 *  the simulator's synthetic loop rather than real GPS. Reset by the next `startTrackCapture`. */
export function isSyntheticTrack(): boolean {
  return synthetic;
}
