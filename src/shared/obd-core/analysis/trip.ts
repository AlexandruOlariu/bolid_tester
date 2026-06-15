/** Pure trip recording helpers: downsampling, stats, and CSV/JSON export. The actual persistence
 *  (file system) lives in the feature layer. See docs/features/trip-recording.md. */

export interface TripSample {
  t: number; // epoch ms
  values: Record<string, number | null>;
}

export interface TripMarker {
  t: number;
  kind: 'dtc' | 'alert' | 'note';
  label: string;
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

export interface TripStats {
  durationMs: number;
  sampleCount: number;
  distanceKm: number | null; // integrated from speed PID 010D if present
  max: Record<string, number>;
}

export function tripStats(trip: Trip): TripStats {
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

  let distanceKm: number | null = null;
  if (pids.includes('010D')) {
    let meters = 0;
    for (let i = 1; i < trip.samples.length; i++) {
      const a = trip.samples[i - 1].values['010D'];
      const b = trip.samples[i].values['010D'];
      if (a == null || b == null) continue;
      const dt = (trip.samples[i].t - trip.samples[i - 1].t) / 1000;
      meters += (((a + b) / 2) / 3.6) * dt;
    }
    distanceKm = meters / 1000;
  }

  const durationMs = trip.header.endedAt - trip.header.startedAt;
  return { durationMs, sampleCount: trip.samples.length, distanceKm, max };
}

/** CSV with a `t_ms,iso` prefix and one column per PID (union, sorted). */
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
  return [header, ...rows].join('\n');
}

export function toJson(trip: Trip): string {
  return JSON.stringify(trip);
}
