/** Pure time-series ring buffer + decimation for the live charts. No rendering. No device I/O.
 *  See docs/features/live-charts.md. */

export interface Point {
  t: number; // epoch ms
  v: number;
}

/** Fixed-capacity ring buffer of points (oldest dropped first). */
export class ChartBuffer {
  private buf: Point[] = [];

  constructor(private capacity = 2000) {}

  push(p: Point): void {
    this.buf.push(p);
    if (this.buf.length > this.capacity) this.buf.shift();
  }

  clear(): void {
    this.buf = [];
  }

  get size(): number {
    return this.buf.length;
  }

  /** Points within the last `windowMs` (relative to `now`, default the latest point). */
  window(windowMs: number, now?: number): Point[] {
    if (this.buf.length === 0) return [];
    const end = now ?? this.buf[this.buf.length - 1].t;
    const start = end - windowMs;
    return this.buf.filter((p) => p.t >= start);
  }

  all(): Point[] {
    return this.buf.slice();
  }
}

/** Reduce a series to at most `maxPoints` by min/max bucketing, preserving extremes per bucket. */
export function decimate(points: Point[], maxPoints: number): Point[] {
  if (maxPoints <= 0 || points.length <= maxPoints) return points.slice();
  const bucketSize = points.length / maxPoints;
  const out: Point[] = [];
  for (let i = 0; i < maxPoints; i++) {
    const lo = Math.floor(i * bucketSize);
    const hi = Math.min(points.length, Math.floor((i + 1) * bucketSize));
    if (hi <= lo) continue;
    let min = points[lo];
    let max = points[lo];
    for (let j = lo; j < hi; j++) {
      if (points[j].v < min.v) min = points[j];
      if (points[j].v > max.v) max = points[j];
    }
    // Emit in time order to keep the line monotonic in t.
    if (min.t <= max.t) {
      out.push(min);
      if (max !== min) out.push(max);
    } else {
      out.push(max);
      if (max !== min) out.push(min);
    }
  }
  return out;
}

export interface SeriesStats {
  min: number;
  max: number;
  current: number;
}

export function seriesStats(points: Point[]): SeriesStats | null {
  if (points.length === 0) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const p of points) {
    if (p.v < min) min = p.v;
    if (p.v > max) max = p.v;
  }
  return { min, max, current: points[points.length - 1].v };
}
