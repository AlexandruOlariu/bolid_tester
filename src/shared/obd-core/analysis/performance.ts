/** Pure performance-test math: acceleration runs, distance runs (¼-mile), and braking, computed
 *  from timestamped speed samples. No device I/O. See docs/features/performance-tests.md. */

export interface SpeedSample {
  t: number; // ms
  speed: number; // km/h
}

const KMH_TO_MS = 1 / 3.6;
const QUARTER_MILE_M = 402.336;
const EIGHTH_MILE_M = 201.168;
const SIXTY_FEET_M = 18.288;

/** Linear interpolation of the time (ms, relative to the first sample) at which speed first
 *  reaches `targetKmh`. Returns null if never reached. */
export function timeToSpeed(samples: SpeedSample[], targetKmh: number): number | null {
  if (samples.length === 0) return null;
  const t0 = samples[0].t;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    if (a.speed < targetKmh && b.speed >= targetKmh) {
      const frac = (targetKmh - a.speed) / (b.speed - a.speed || 1);
      return a.t + frac * (b.t - a.t) - t0;
    }
    if (b.speed === targetKmh) return b.t - t0;
  }
  return null;
}

/** Cumulative distance (m) at each sample via trapezoidal integration of speed over time. */
export function cumulativeDistance(samples: SpeedSample[]): number[] {
  const out: number[] = [];
  let d = 0;
  for (let i = 0; i < samples.length; i++) {
    if (i > 0) {
      const dt = (samples[i].t - samples[i - 1].t) / 1000;
      const v = ((samples[i].speed + samples[i - 1].speed) / 2) * KMH_TO_MS;
      d += v * dt;
    }
    out.push(d);
  }
  return out;
}

/** Time (ms) and trap speed (km/h) at which cumulative distance first reaches `distM`. */
export function timeToDistance(
  samples: SpeedSample[],
  distM: number,
): { timeMs: number; trapKmh: number } | null {
  if (samples.length === 0) return null;
  const dist = cumulativeDistance(samples);
  const t0 = samples[0].t;
  for (let i = 1; i < dist.length; i++) {
    if (dist[i - 1] < distM && dist[i] >= distM) {
      const frac = (distM - dist[i - 1]) / (dist[i] - dist[i - 1] || 1);
      const timeMs = samples[i - 1].t + frac * (samples[i].t - samples[i - 1].t) - t0;
      const trapKmh = samples[i - 1].speed + frac * (samples[i].speed - samples[i - 1].speed);
      return { timeMs, trapKmh };
    }
  }
  return null;
}

export interface AccelResult {
  targetKmh: number;
  timeMs: number | null;
  splits: { fromKmh: number; toKmh: number; timeMs: number | null }[];
  maxKmh: number;
  sampleRateHz: number;
}

/** 0→target with mid-point splits (e.g. 0–50 / 50–100). Launch is the first sample at/above 0. */
export function computeAccelRun(
  samples: SpeedSample[],
  targetKmh = 100,
): AccelResult {
  const maxKmh = samples.reduce((m, s) => Math.max(m, s.speed), 0);
  const mid = Math.round(targetKmh / 2);
  const tMid = timeToSpeed(samples, mid);
  const tFull = timeToSpeed(samples, targetKmh);
  const splits = [
    { fromKmh: 0, toKmh: mid, timeMs: tMid },
    { fromKmh: mid, toKmh: targetKmh, timeMs: tFull !== null && tMid !== null ? tFull - tMid : null },
  ];
  const span = samples.length > 1 ? (samples[samples.length - 1].t - samples[0].t) / 1000 : 0;
  const sampleRateHz = span > 0 ? (samples.length - 1) / span : 0;
  return { targetKmh, timeMs: tFull, splits, maxKmh, sampleRateHz };
}

export interface DragResult {
  sixtyFtMs: number | null;
  eighthMile: { timeMs: number; trapKmh: number } | null;
  quarterMile: { timeMs: number; trapKmh: number } | null;
}

export function computeDragRun(samples: SpeedSample[]): DragResult {
  const sixty = timeToDistance(samples, SIXTY_FEET_M);
  return {
    sixtyFtMs: sixty ? sixty.timeMs : null,
    eighthMile: timeToDistance(samples, EIGHTH_MILE_M),
    quarterMile: timeToDistance(samples, QUARTER_MILE_M),
  };
}

export interface BrakeResult {
  fromKmh: number;
  toKmh: number;
  timeMs: number | null;
  distanceM: number | null;
}

/** Braking from the first sample at/above `fromKmh` down to `toKmh` (default 0). */
export function computeBrakeRun(samples: SpeedSample[], fromKmh = 100, toKmh = 0): BrakeResult {
  const startIdx = samples.findIndex((s) => s.speed >= fromKmh);
  if (startIdx < 0) return { fromKmh, toKmh, timeMs: null, distanceM: null };
  const slice = samples.slice(startIdx);
  const t0 = slice[0].t;
  for (let i = 1; i < slice.length; i++) {
    if (slice[i - 1].speed > toKmh && slice[i].speed <= toKmh) {
      const seg = slice.slice(0, i + 1);
      const dist = cumulativeDistance(seg);
      return { fromKmh, toKmh, timeMs: slice[i].t - t0, distanceM: dist[dist.length - 1] };
    }
  }
  return { fromKmh, toKmh, timeMs: null, distanceM: null };
}
