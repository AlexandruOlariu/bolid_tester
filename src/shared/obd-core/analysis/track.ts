/** Pure GPS-track helpers for the trip detail screen (plan 17): a fitted equirectangular projection
 *  for drawing the track with react-native-svg (no map tiles, no API key, offline), a "nice"
 *  scale bar, per-point overlay values (speed / RPM / fuel rate) aligned from the OBD samples,
 *  speed-bucket colouring, the GPS-vs-OBD distance check with a plain verdict, a downsampled
 *  speed-over-time profile, and the simulator's deterministic synthetic loop. Metric only.
 *  See docs/features/trip-recording.md → "Trip detail". */

import type { TrackPoint, TripSample } from './trip';
import {
  haversineKm,
  obdDistanceKmFromSamples,
  trackAverageSpeedKmh,
  trackDistanceKm,
} from './trip';

export interface Bounds {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

/** A track point in screen pixels; `i` is its index into the track. */
export interface ProjectedPoint {
  x: number;
  y: number;
  i: number;
}

/** Metres per degree of latitude on the mean-radius sphere `haversineKm` uses (6371.0088 km). */
const M_PER_DEG_LAT = (6371008.8 * Math.PI) / 180;
const DEFAULT_PADDING = 16;

const toRad = (d: number) => (d * Math.PI) / 180;

/** Lat/lon bounding box of the track, or null for an empty track. */
export function trackBounds(track: TrackPoint[]): Bounds | null {
  if (track.length === 0) return null;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const p of track) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
  }
  return { minLat, maxLat, minLon, maxLon };
}

interface Fit {
  /** Longitude scale factor cos(latMid), so a degree of lon and of lat cover the same pixels per metre. */
  kx: number;
  /** Pixels per (latitude-equivalent) degree, or 0 for a single-spot track. */
  scale: number;
  spanX: number;
  spanY: number;
}

/** The fit shared by `projectTrack` and `scaleBar`, so the bar always matches the drawing. */
function fit(bounds: Bounds, width: number, height: number, padding: number): Fit {
  const kx = Math.cos(toRad((bounds.minLat + bounds.maxLat) / 2));
  const spanX = (bounds.maxLon - bounds.minLon) * kx;
  const spanY = bounds.maxLat - bounds.minLat;
  const innerW = Math.max(0, width - 2 * padding);
  const innerH = Math.max(0, height - 2 * padding);
  const sx = spanX > 0 ? innerW / spanX : Infinity;
  const sy = spanY > 0 ? innerH / spanY : Infinity;
  const s = Math.min(sx, sy);
  return { kx, scale: Number.isFinite(s) ? s : 0, spanX, spanY };
}

/** Equirectangular projection fitted into width×height with padding; preserves aspect (lon scaled by
 *  cos(latMid)); y flipped so north is up. The track is centred in the padded box; a single-spot
 *  track lands in the centre. */
export function projectTrack(
  track: TrackPoint[],
  width: number,
  height: number,
  padding: number = DEFAULT_PADDING,
): ProjectedPoint[] {
  const bounds = trackBounds(track);
  if (!bounds) return [];
  const { kx, scale, spanX, spanY } = fit(bounds, width, height, padding);
  const innerW = Math.max(0, width - 2 * padding);
  const innerH = Math.max(0, height - 2 * padding);
  const offX = padding + (innerW - spanX * scale) / 2;
  const offY = padding + (innerH - spanY * scale) / 2;
  return track.map((p, i) => ({
    x: offX + (p.lon - bounds.minLon) * kx * scale,
    y: offY + (bounds.maxLat - p.lat) * scale,
    i,
  }));
}

/** Candidate scale-bar lengths in metres (100 m … 100 km). */
const NICE_BAR_METRES = [100, 200, 500, 1000, 2000, 5000, 10_000, 20_000, 50_000, 100_000];
/** The bar takes at most this share of the padded width. */
const BAR_MAX_SHARE = 1 / 3;

/** Metres per pixel at the fitted scale and a "nice" scale-bar length (100 m, 200 m, 500 m, 1 km,
 *  2 km, 5 km, …): the longest one that fits in a third of the padded width (100 m when none does).
 *  Pass the map `height` to match a height-bound fit; without it the fit is width-bound.
 *  A single-spot track has no scale: `{ metresPerPx: 0, barMetres: 100, barPx: 0 }`. */
export function scaleBar(
  bounds: Bounds,
  width: number,
  padding: number = DEFAULT_PADDING,
  height: number = Infinity,
): { metresPerPx: number; barMetres: number; barPx: number } {
  const { scale } = fit(bounds, width, height, padding);
  if (scale <= 0) return { metresPerPx: 0, barMetres: NICE_BAR_METRES[0], barPx: 0 };
  const metresPerPx = M_PER_DEG_LAT / scale;
  const maxPx = Math.max(0, width - 2 * padding) * BAR_MAX_SHARE;
  let barMetres = NICE_BAR_METRES[0];
  for (const m of NICE_BAR_METRES) if (m / metresPerPx <= maxPx) barMetres = m;
  return { metresPerPx, barMetres, barPx: barMetres / metresPerPx };
}

/** "500 m" / "2 km" for a scale-bar length. */
export function formatBarLength(metres: number): string {
  return metres >= 1000 ? `${metres / 1000} km` : `${metres} m`;
}

/** The projected point nearest to (x, y) within `maxPx` (24 px by default — a fingertip), or null. */
export function nearestPoint(
  points: ProjectedPoint[],
  x: number,
  y: number,
  maxPx = 24,
): ProjectedPoint | null {
  let best: ProjectedPoint | null = null;
  let bestD = maxPx * maxPx;
  for (const p of points) {
    const d = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d <= bestD) {
      best = p;
      bestD = d;
    }
  }
  return best;
}

export type OverlayChannel = 'speed' | 'rpm' | 'fuelRate' | 'none';

export interface TrackSegment {
  from: ProjectedPoint;
  to: ProjectedPoint;
  value: number | null;
  colour: string;
}

/** OBD PID behind each sample-backed overlay channel. */
const CHANNEL_PID: Record<Exclude<OverlayChannel, 'none'>, string> = {
  speed: '010D',
  rpm: '010C',
  fuelRate: '015E',
};

/** Index of the sample nearest in time to `t` (samples sorted by time); a tie picks the earlier. */
function nearestSampleIndex(samples: TripSample[], t: number): number {
  let lo = 0;
  let hi = samples.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  // lo = first sample with t >= target (or the last one); compare with its predecessor.
  if (lo > 0 && t - samples[lo - 1].t <= samples[lo].t - t) return lo - 1;
  return lo;
}

/** Nearest sample (by time, binary search; a tie picks the earlier sample) for each track point →
 *  channel value: speed from the GPS fix (m/s → km/h) with fallback to 010D; rpm = 010C;
 *  fuelRate = 015E (L/h); `none` → all null. */
export function alignSamplesToTrack(
  track: TrackPoint[],
  samples: TripSample[],
  channel: OverlayChannel,
): (number | null)[] {
  if (channel === 'none') return track.map(() => null);
  const sorted = samples.length > 1 ? [...samples].sort((a, b) => a.t - b.t) : samples;
  const pid = CHANNEL_PID[channel];
  return track.map((p) => {
    if (channel === 'speed' && p.speed != null) return p.speed * 3.6;
    if (sorted.length === 0) return null;
    const v = sorted[nearestSampleIndex(sorted, p.t)].values[pid];
    return v == null ? null : v;
  });
}

/** 5-step palette from the app accent to red; null values draw grey. */
export const TRACK_PALETTE = ['#2bb673', '#9bc53d', '#e3b341', '#f0883e', '#f85149'] as const;
export const TRACK_NO_DATA = '#8b949e';

const SPEED_EDGES = [30, 60, 90, 130]; // km/h
const RPM_EDGES = [1500, 2500, 3500]; // rpm

/** A bucket edge rounded to the legend's display precision (`fmtEdge`): whole L/h from 10 up,
 *  else 0.1 L/h — so two edges that would print the same are the same edge. */
const roundEdge = (v: number) => (Math.abs(v) >= 10 ? Math.round(v) : Math.round(v * 10) / 10);

const finiteValues = (values: (number | null)[]) =>
  values.filter((v): v is number => v != null && Number.isFinite(v));

/** Fuel-rate bucket edges: this trip's quartiles (q1, q2, q3) rounded to display precision, keeping
 *  only distinct edges strictly above the (rounded) minimum — so a steady fuel rate (every value
 *  equal, or a spread below 0.1 L/h) gives no edges and one bucket instead of painting the whole
 *  track in the top bucket under repeated labels. Null when there are no values. */
function fuelEdges(values: (number | null)[]): number[] | null {
  const xs = finiteValues(values).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const q = (f: number) => {
    const pos = (xs.length - 1) * f;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return xs[lo] + (xs[hi] - xs[lo]) * (pos - lo);
  };
  const floor = roundEdge(xs[0]);
  const edges: number[] = [];
  for (const e of [q(0.25), q(0.5), q(0.75)].map(roundEdge)) {
    if (e > floor && (edges.length === 0 || e > edges[edges.length - 1])) edges.push(e);
  }
  return edges;
}

/** Bucket edges for a channel (fuel rate: this trip's quartiles), or null when nothing to bucket. */
function edgesFor(channel: OverlayChannel, values: (number | null)[]): number[] | null {
  if (channel === 'speed') return SPEED_EDGES;
  if (channel === 'rpm') return RPM_EDGES;
  if (channel === 'fuelRate') return fuelEdges(values);
  return null;
}

/** Palette colour of bucket `b` out of `n` buckets, spread over the 5 steps (4 buckets → 0,1,3,4);
 *  a lone bucket (a steady fuel rate) takes the middle step — neither "low" nor "high". */
function bucketColour(b: number, n: number): string {
  const step =
    n <= 1
      ? (TRACK_PALETTE.length - 1) / 2
      : Math.round((b * (TRACK_PALETTE.length - 1)) / (n - 1));
  return TRACK_PALETTE[step];
}

function bucketOf(v: number, edges: number[]): number {
  let b = 0;
  while (b < edges.length && v >= edges[b]) b++;
  return b;
}

/** One segment per consecutive pair of points (n − 1 for n points). A segment's value is the mean of
 *  its two ends (or the one that has a value). Fixed metric buckets: speed km/h [0,30) [30,60)
 *  [60,90) [90,130) 130+; rpm [0,1500) [1500,2500) [2500,3500) 3500+; fuel rate L/h by this trip's
 *  quartiles (a steady fuel rate → one middle-colour bucket). Null → grey; channel `none` → every segment in the accent colour. */
export function colourSegments(
  points: ProjectedPoint[],
  values: (number | null)[],
  channel: OverlayChannel,
): TrackSegment[] {
  const edges = edgesFor(channel, values);
  const segments: TrackSegment[] = [];
  for (let k = 1; k < points.length; k++) {
    const from = points[k - 1];
    const to = points[k];
    if (channel === 'none') {
      segments.push({ from, to, value: null, colour: TRACK_PALETTE[0] });
      continue;
    }
    const a = values[from.i] ?? null;
    const b = values[to.i] ?? null;
    const value = a != null && b != null ? (a + b) / 2 : (a ?? b);
    const colour =
      value == null || !edges
        ? TRACK_NO_DATA
        : bucketColour(bucketOf(value, edges), edges.length + 1);
    segments.push({ from, to, value, colour });
  }
  return segments;
}

const fmtEdge = (v: number) => (Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(1));

/** Legend chips for the channel's buckets, plus "No data" (grey) when any value is missing.
 *  `none` has no legend. */
export function legendFor(
  channel: OverlayChannel,
  values: (number | null)[],
): { label: string; colour: string }[] {
  if (channel === 'none') return [];
  const edges = edgesFor(channel, values);
  const unit = channel === 'speed' ? 'km/h' : channel === 'rpm' ? 'rpm' : 'L/h';
  const out: { label: string; colour: string }[] = [];
  if (edges && edges.length === 0) {
    // One bucket (a steady fuel rate): label it with the range the values actually span.
    const xs = finiteValues(values);
    const lo = fmtEdge(roundEdge(Math.min(...xs)));
    const hi = fmtEdge(roundEdge(Math.max(...xs)));
    out.push({
      label: lo === hi ? `${lo} ${unit}` : `${lo}–${hi} ${unit}`,
      colour: bucketColour(0, 1),
    });
  } else if (edges) {
    const n = edges.length + 1;
    for (let b = 0; b < n; b++) {
      const label =
        b === 0
          ? channel === 'fuelRate'
            ? `under ${fmtEdge(edges[0])} ${unit}`
            : `0–${fmtEdge(edges[0])} ${unit}`
          : b === n - 1
            ? `${fmtEdge(edges[b - 1])}+ ${unit}`
            : `${fmtEdge(edges[b - 1])}–${fmtEdge(edges[b])} ${unit}`;
      out.push({ label, colour: bucketColour(b, n) });
    }
  }
  if (values.length === 0 || values.some((v) => v == null)) {
    out.push({ label: 'No data', colour: TRACK_NO_DATA });
  }
  return out;
}

export interface GpsObdCheck {
  gpsKm: number;
  obdKm: number | null;
  /** (OBD − GPS) ÷ GPS distance, in %. */
  deltaPct: number | null;
  gpsAvgKmh: number | null;
  obdAvgKmh: number | null;
  verdict: 'ok' | 'check' | 'mismatch' | 'unknown';
  note: string;
}

/** Below this |delta| the distances agree. Validate against a known-good odometer (on-car pending). */
export const GPS_OBD_OK_PCT = 3;
/** Below this |delta| the gap is a tyre-size / speedo offset; at or above it, a mismatch. */
export const GPS_OBD_CHECK_PCT = 8;

const VERDICT_NOTES: Record<GpsObdCheck['verdict'], string> = {
  ok: 'GPS and the car agree on the distance — the speedometer reading looks right.',
  check: 'Small difference — usually a tyre size or speedometer offset.',
  mismatch: 'Odometer or sensor issue — compare with a second trip.',
  unknown: 'Not enough data — needs at least two GPS fixes and the vehicle speed reading.',
};

/** GPS-vs-OBD distance check: |delta| < 3 % → ok; < 8 % → check (tyre size / speedo offset);
 *  ≥ 8 % → mismatch (odometer or sensor issue — compare with a second trip); no OBD speed, fewer
 *  than two fixes, or a zero GPS distance → unknown. */
export function gpsVsObd(
  track: TrackPoint[],
  samples: TripSample[],
  durationMs: number,
): GpsObdCheck {
  const gpsKm = trackDistanceKm(track);
  const obdKm = obdDistanceKmFromSamples(samples);
  const gpsAvgKmh = trackAverageSpeedKmh(track);
  const obdAvgKmh = obdKm != null && durationMs > 0 ? obdKm / (durationMs / 3_600_000) : null;
  const deltaPct =
    obdKm != null && track.length >= 2 && gpsKm > 0 ? ((obdKm - gpsKm) / gpsKm) * 100 : null;
  const verdict: GpsObdCheck['verdict'] =
    deltaPct == null
      ? 'unknown'
      : Math.abs(deltaPct) < GPS_OBD_OK_PCT
        ? 'ok'
        : Math.abs(deltaPct) < GPS_OBD_CHECK_PCT
          ? 'check'
          : 'mismatch';
  return { gpsKm, obdKm, deltaPct, gpsAvgKmh, obdAvgKmh, verdict, note: VERDICT_NOTES[verdict] };
}

/** Downsampled (max `maxPoints`, default 300) speed-over-time series for the strip chart, from 010D
 *  and falling back to the GPS fix speed (m/s → km/h) when no sample carries a speed. Evenly spaced,
 *  keeping the first and last point; sorted by time. */
export function speedProfile(
  samples: TripSample[],
  track: TrackPoint[],
  maxPoints = 300,
): { t: number; kmh: number }[] {
  let series: { t: number; kmh: number }[] = [];
  for (const s of samples) {
    const v = s.values['010D'];
    if (v != null) series.push({ t: s.t, kmh: v });
  }
  if (series.length === 0) {
    for (const p of track) if (p.speed != null) series.push({ t: p.t, kmh: p.speed * 3.6 });
  }
  series = series.sort((a, b) => a.t - b.t);
  const cap = Math.max(2, Math.floor(maxPoints));
  if (series.length <= cap) return series;
  const out: { t: number; kmh: number }[] = [];
  for (let k = 0; k < cap; k++) out.push(series[Math.round((k * (series.length - 1)) / (cap - 1))]);
  return out;
}

/** Origin of the simulator's synthetic loop (central Bucharest). */
export const SYNTHETIC_ORIGIN = { lat: 44.4268, lon: 26.1025 };
/** Synthetic loop: a rounded rectangle, 2 km round. */
export const SYNTHETIC_LOOP_LENGTH_M = 2000;
const LOOP_R = 60; // corner radius, m
const LOOP_A = 500; // east–west straight, m
const LOOP_B = (SYNTHETIC_LOOP_LENGTH_M - 2 * LOOP_A - 2 * Math.PI * LOOP_R) / 2; // north–south straight

/** Local (east, north) metres of the loop at `d` metres along it, starting at the origin heading east
 *  and running anticlockwise. */
function loopXY(d: number): { x: number; y: number } {
  const r = LOOP_R;
  const a = LOOP_A;
  const b = LOOP_B;
  const arc = (Math.PI / 2) * r;
  let s = ((d % SYNTHETIC_LOOP_LENGTH_M) + SYNTHETIC_LOOP_LENGTH_M) % SYNTHETIC_LOOP_LENGTH_M;
  // bottom straight, east
  if (s < a) return { x: s, y: 0 };
  s -= a;
  if (s < arc) {
    const phi = -Math.PI / 2 + s / r;
    return { x: a + r * Math.cos(phi), y: r + r * Math.sin(phi) };
  }
  s -= arc;
  // right straight, north
  if (s < b) return { x: a + r, y: r + s };
  s -= b;
  if (s < arc) {
    const phi = s / r;
    return { x: a + r * Math.cos(phi), y: r + b + r * Math.sin(phi) };
  }
  s -= arc;
  // top straight, west
  if (s < a) return { x: a - s, y: 2 * r + b };
  s -= a;
  if (s < arc) {
    const phi = Math.PI / 2 + s / r;
    return { x: r * Math.cos(phi), y: r + b + r * Math.sin(phi) };
  }
  s -= arc;
  // left straight, south
  if (s < b) return { x: -r, y: r + b - s };
  s -= b;
  const phi = Math.PI + Math.min(s, arc) / r;
  return { x: r * Math.cos(phi), y: r + r * Math.sin(phi) };
}

/** The simulator's deterministic synthetic GPS loop (origin 44.4268 N, 26.1025 E; a 2 km rounded
 *  rectangle) at `distanceM` metres along it; wraps every `SYNTHETIC_LOOP_LENGTH_M`. */
export function syntheticLoopPoint(distanceM: number): { lat: number; lon: number } {
  const { x, y } = loopXY(distanceM);
  return {
    lat: SYNTHETIC_ORIGIN.lat + y / M_PER_DEG_LAT,
    lon: SYNTHETIC_ORIGIN.lon + x / (M_PER_DEG_LAT * Math.cos(toRad(SYNTHETIC_ORIGIN.lat))),
  };
}

/** Straight-line (haversine, as `trackDistanceKm` measures it) metres between two loop positions. */
function loopChordM(fromM: number, toM: number): number {
  const a = syntheticLoopPoint(fromM);
  const b = syntheticLoopPoint(toM);
  return haversineKm(a.lat, a.lon, b.lat, b.lon) * 1000;
}

/** The loop position (metres along it) whose straight-line distance from `fromM` is `chordM`.
 *  The simulator advances its fixes with this, so the GPS distance (straight lines between fixes)
 *  equals the distance driven (speed × time) even where a 5 s step cuts one of the loop's corners —
 *  otherwise a steady 90 km/h would read more than 3 % short of the OBD distance and the GPS-vs-OBD
 *  check would flag the loop's geometry, not a speedometer. On a straight it is `fromM + chordM`
 *  exactly; a step too long for any chord to match (beyond ~500 km/h) falls back to that too. */
export function syntheticLoopAdvance(fromM: number, chordM: number): number {
  if (!(chordM > 0)) return fromM;
  const straight = fromM + chordM;
  if (Math.abs(loopChordM(fromM, straight) - chordM) < 1e-3) return straight;
  // A corner shortens the chord, so the matching position lies between `straight` and twice the
  // step on; bisect there (the chord grows with the distance along a step this short).
  let lo = straight;
  let hi = fromM + 2 * chordM;
  if (loopChordM(fromM, hi) < chordM) return straight;
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    if (loopChordM(fromM, mid) < chordM) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
