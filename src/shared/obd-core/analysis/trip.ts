/** Pure trip recording helpers: downsampling, stats, and CSV/JSON export. The actual persistence
 *  (file system) lives in the feature layer. See docs/features/trip-recording.md. */

import type { FuelType } from './fuelEconomy';
import { tripFuelAverage } from './fuelEconomy';

export interface TripSample {
  t: number; // epoch ms
  values: Record<string, number | null>;
}

export interface TripMarker {
  t: number;
  kind: 'dtc' | 'alert' | 'note';
  label: string;
}

/** One coarse GPS fix captured during a recording (expo-location, foreground only). Speed is the
 *  GPS-reported ground speed in **m/s** (SI, as the OS provides it); it is null when the fix carries
 *  no speed. Kept separate from OBD samples — a different source and cadence (~5 s / 25 m). */
export interface TrackPoint {
  t: number; // epoch ms
  lat: number;
  lon: number;
  /** GPS ground speed in m/s, or null when unavailable. */
  speed: number | null;
}

export interface TripHeader {
  id: string;
  startedAt: number;
  endedAt: number;
  profileId: string;
  vin: string | null;
  protocol: string;
}

export interface Trip {
  header: TripHeader;
  samples: TripSample[];
  markers: TripMarker[];
  /** Optional coarse GPS track captured alongside the samples (foreground only, may be absent). */
  track?: TrackPoint[];
}

/** Keep at most one sample per `intervalMs` bucket (the first in each bucket). */
export function downsample(samples: TripSample[], intervalMs: number): TripSample[] {
  if (intervalMs <= 0 || samples.length === 0) return samples.slice();
  const out: TripSample[] = [];
  let bucket = -1;
  for (const s of samples) {
    const b = Math.floor(s.t / intervalMs);
    if (b !== bucket) {
      out.push(s);
      bucket = b;
    }
  }
  return out;
}

/** Union of every PID key present across the samples, sorted. */
export function tripPids(trip: Trip): string[] {
  const set = new Set<string>();
  for (const s of trip.samples) for (const k of Object.keys(s.values)) set.add(k);
  return [...set].sort();
}

/** Great-circle distance between two lat/lon points in km (haversine, mean Earth radius). */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371.0088; // mean Earth radius, km
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Sum of great-circle hops between consecutive fixes, in km. */
export function trackDistanceKm(track: TrackPoint[]): number {
  let km = 0;
  for (let i = 1; i < track.length; i++) {
    const a = track[i - 1];
    const b = track[i];
    km += haversineKm(a.lat, a.lon, b.lat, b.lon);
  }
  return km;
}

/** Average ground speed over the track in km/h (distance ÷ elapsed time), or null when the track has
 *  fewer than two fixes or zero elapsed time. Derived from position, not the GPS speed field, so it
 *  works even when individual fixes carry no speed. */
export function trackAverageSpeedKmh(track: TrackPoint[]): number | null {
  if (track.length < 2) return null;
  const hours = (track[track.length - 1].t - track[0].t) / 3_600_000;
  if (hours <= 0) return null;
  return trackDistanceKm(track) / hours;
}

export interface TripFuelStats {
  /** Total fuel burned over the trip, in litres. */
  litres: number;
  /** Trip average consumption in L/100km, or null when no distance was covered. */
  litresPer100km: number | null;
  /** Trip average fuel flow in L/h, or null for a zero-length window. */
  litresPerHour: number | null;
}

export interface TripGpsStats {
  /** GPS-measured distance over the track, in km (haversine). */
  distanceKm: number;
  /** GPS average speed in km/h, or null. */
  avgSpeedKmh: number | null;
  /** OBD average speed in km/h (integrated speed distance ÷ duration), or null when speed absent. */
  obdAvgSpeedKmh: number | null;
  /** OBD minus GPS average speed in km/h — the odometer/clone sanity delta — or null. */
  speedDeltaKmh: number | null;
  /** Number of GPS fixes captured. */
  points: number;
}

export interface TripStats {
  durationMs: number;
  sampleCount: number;
  distanceKm: number | null; // integrated from speed PID 010D if present
  max: Record<string, number>;
  /** Fuel stats — present only when a fuel type was supplied and the samples carried fuel PIDs. */
  fuel?: TripFuelStats;
  /** GPS-derived stats — present only when the trip carries a track with at least one fix. */
  gps?: TripGpsStats;
}

/** Distance integrated from the speed PID (010D, km/h), in km, or null when the PID is absent. */
function obdDistanceKm(trip: Trip): number | null {
  if (!tripPids(trip).includes('010D')) return null;
  let meters = 0;
  for (let i = 1; i < trip.samples.length; i++) {
    const a = trip.samples[i - 1].values['010D'];
    const b = trip.samples[i].values['010D'];
    if (a == null || b == null) continue;
    const dt = (trip.samples[i].t - trip.samples[i - 1].t) / 1000;
    meters += (((a + b) / 2) / 3.6) * dt;
  }
  return meters / 1000;
}

/** Trip stats. `fuel` is optional and additive: pass the vehicle's fuel type to also compute fuel
 *  consumption (needs a fuel-rate `015E` or MAF `0110` PID in the samples). GPS stats are derived
 *  from `trip.track` when present. Existing callers that omit `fuel` get the original shape plus a
 *  `gps` field only when the trip has a track. */
export function tripStats(trip: Trip, fuel?: FuelType): TripStats {
  const pids = tripPids(trip);
  const max: Record<string, number> = {};
  for (const pid of pids) {
    let m = -Infinity;
    for (const s of trip.samples) {
      const v = s.values[pid];
      if (v !== null && v !== undefined && v > m) m = v;
    }
    if (m > -Infinity) max[pid] = m;
  }

  const distanceKm = obdDistanceKm(trip);
  const durationMs = trip.header.endedAt - trip.header.startedAt;
  const stats: TripStats = { durationMs, sampleCount: trip.samples.length, distanceKm, max };

  if (fuel && (pids.includes('015E') || pids.includes('0110'))) {
    const avg = tripFuelAverage(trip.samples, fuel);
    if (avg.litresPerHour != null) {
      stats.fuel = {
        litres: avg.litres,
        litresPer100km: avg.litresPer100km,
        litresPerHour: avg.litresPerHour,
      };
    }
  }

  const track = trip.track;
  if (track && track.length > 0) {
    const gpsDistanceKm = trackDistanceKm(track);
    const gpsAvg = trackAverageSpeedKmh(track);
    const obdAvg =
      distanceKm != null && durationMs > 0 ? distanceKm / (durationMs / 3_600_000) : null;
    stats.gps = {
      distanceKm: gpsDistanceKm,
      avgSpeedKmh: gpsAvg,
      obdAvgSpeedKmh: obdAvg,
      speedDeltaKmh: obdAvg != null && gpsAvg != null ? obdAvg - gpsAvg : null,
      points: track.length,
    };
  }

  return stats;
}

/** Marker line that separates the sample grid from the optional GPS track section in a CSV. */
const TRACK_MARKER = '#TRACK';

/** CSV with a `t_ms,iso` prefix and one column per PID (union, sorted). When the trip carries a GPS
 *  track, a `#TRACK` section is appended after the samples with its own `t_ms,iso,lat,lon,speed`
 *  header; `fromCsv` stops at the marker so the sample grid round-trips unchanged, and `trackFromCsv`
 *  recovers the track. A trip with no track produces no track section (byte-for-byte the old format). */
export function toCsv(trip: Trip): string {
  const pids = tripPids(trip);
  const header = ['t_ms', 'iso', ...pids].join(',');
  const rows = trip.samples.map((s) => {
    const cells = [String(s.t), new Date(s.t).toISOString()];
    for (const pid of pids) {
      const v = s.values[pid];
      cells.push(v === null || v === undefined ? '' : String(v));
    }
    return cells.join(',');
  });
  const lines = [header, ...rows];
  if (trip.track && trip.track.length > 0) {
    lines.push(TRACK_MARKER);
    lines.push(['t_ms', 'iso', 'lat', 'lon', 'speed'].join(','));
    for (const p of trip.track) {
      lines.push(
        [
          String(p.t),
          new Date(p.t).toISOString(),
          String(p.lat),
          String(p.lon),
          p.speed === null || p.speed === undefined ? '' : String(p.speed),
        ].join(','),
      );
    }
  }
  return lines.join('\n');
}

/** Parse the sample rows of a `toCsv` document back into `TripSample[]` — the inverse of `toCsv`
 *  for the value grid. The trip **header** and **markers** are not stored in the CSV (they live in
 *  the persisted trip summary), so this recovers samples only. Empty cells decode to `null`; the
 *  `iso` column is derived from `t_ms` on write and ignored on read. A header-only document (a trip
 *  with no samples) yields `[]`. Used to lazy-load a trip's samples from disk when it is opened. */
export function fromCsv(csv: string): TripSample[] {
  const lines = csv.split('\n').filter((l) => l.length > 0);
  if (lines.length <= 1) return [];
  const pids = lines[0].split(',').slice(2); // drop the `t_ms` + `iso` prefix columns
  const samples: TripSample[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].startsWith('#')) break; // reached the GPS track section — samples end here
    const cells = lines[i].split(',');
    const values: Record<string, number | null> = {};
    for (let j = 0; j < pids.length; j++) {
      const cell = cells[j + 2];
      values[pids[j]] = cell === undefined || cell === '' ? null : Number(cell);
    }
    samples.push({ t: Number(cells[0]), values });
  }
  return samples;
}

/** Recover the GPS track from a `toCsv` document — the inverse of the `#TRACK` section. Returns `[]`
 *  when the document has no track section (an old-format CSV, or a trip recorded without GPS). */
export function trackFromCsv(csv: string): TrackPoint[] {
  const lines = csv.split('\n').filter((l) => l.length > 0);
  const marker = lines.indexOf(TRACK_MARKER);
  if (marker < 0 || marker + 2 > lines.length) return [];
  const track: TrackPoint[] = [];
  for (let i = marker + 2; i < lines.length; i++) {
    // rows after the marker + its own header
    const cells = lines[i].split(',');
    const speed = cells[4];
    track.push({
      t: Number(cells[0]),
      lat: Number(cells[2]),
      lon: Number(cells[3]),
      speed: speed === undefined || speed === '' ? null : Number(speed),
    });
  }
  return track;
}

export function toJson(trip: Trip): string {
  return JSON.stringify(trip);
}
