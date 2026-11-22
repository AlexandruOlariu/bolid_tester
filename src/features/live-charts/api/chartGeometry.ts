/** Chart geometry (plan 21): map a series into a plot of a measured size. Pure — the panel measures
 *  its width with `onLayout` and passes it in, so the same maths serves a 320 dp phone strip and a
 *  600 dp tablet panel. See docs/features/live-charts.md → "Layout". */
import type { Point } from '@/shared/obd-core';

/** Plot width before the panel has been measured (the old fixed width). */
export const DEFAULT_CHART_WIDTH = 320;
/** Tallest a plot grows, however wide it is. */
export const MAX_CHART_HEIGHT = 220;

export interface ScreenPoint {
  x: number;
  y: number;
  t: number;
  v: number;
}

/** Plot height for a width: 3 : 8 (320 → 120, the old fixed size), capped at `MAX_CHART_HEIGHT`. */
export function chartHeight(width: number): number {
  return Math.min(MAX_CHART_HEIGHT, Math.round(width * 0.375));
}

/** Milliseconds of history one horizontal pixel spans (the drag-to-pan rate). */
export function msPerPx(windowMs: number, width: number): number {
  return windowMs / (width || 1);
}

/** Map a series to screen coordinates in a `w` × `h` plot, each series independently normalized
 *  (matches the gauges' auto-scaling): time spans `[0, w]`, value spans `[h, 0]` (SVG y grows
 *  down). Returns both the coords (for tap-inspect) and the polyline string. */
export function toScreen(
  pts: Point[],
  w: number,
  h: number,
): { screen: ScreenPoint[]; polyline: string } {
  if (pts.length < 1) return { screen: [], polyline: '' };
  const ts = pts.map((p) => p.t);
  const vs = pts.map((p) => p.v);
  const tMin = Math.min(...ts);
  const tSpan = Math.max(...ts) - tMin || 1;
  const vMin = Math.min(...vs);
  const vSpan = Math.max(...vs) - vMin || 1;
  const screen = pts.map((p) => ({
    x: ((p.t - tMin) / tSpan) * w,
    y: h - ((p.v - vMin) / vSpan) * h,
    t: p.t,
    v: p.v,
  }));
  return { screen, polyline: screen.map((s) => `${s.x.toFixed(1)},${s.y.toFixed(1)}`).join(' ') };
}
