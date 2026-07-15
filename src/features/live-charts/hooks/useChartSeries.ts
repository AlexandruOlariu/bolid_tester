import { useEffect, useRef, useState } from 'react';
import { ChartBuffer, Point, SeriesStats, decimate, seriesStats } from '@/shared/obd-core';
import { useLiveDataStore } from '@/features/live-data/model/liveDataStore';

// Unique subscriber id per chart panel so panels don't clobber each other's PID registration.
let nextChartRegId = 0;

/** Maintain a rolling buffer per PID from the live snapshot; return decimated, plot-ready series.
 *  Registers this panel's PIDs so the app-wide poll loop (EngineHost) reads them while the chart is
 *  mounted — a chart is now self-sufficient instead of relying on a live screen also being open.
 *
 *  `endOffsetMs` shifts the window's end backwards from "now" for pan/scrub: 0 tracks live; a positive
 *  value shows older data. `oldestOffsetMs` (returned) is how far back real data exists, so the caller
 *  can clamp the pan to the buffer instead of scrolling into emptiness. */
export function useChartSeries(pids: string[], windowMs: number, maxPoints = 120, endOffsetMs = 0) {
  const buffers = useRef<Record<string, ChartBuffer>>({});
  const values = useLiveDataStore((s) => s.values);
  const acquire = useLiveDataStore((s) => s.acquire);
  const idRef = useRef<string>(`chart-${nextChartRegId++}`);
  const [series, setSeries] = useState<Record<string, Point[]>>({});
  const [stats, setStats] = useState<Record<string, SeriesStats | null>>({});
  const [oldestOffsetMs, setOldestOffsetMs] = useState(0);

  useEffect(() => acquire(idRef.current, pids), [acquire, pids]);

  useEffect(() => {
    const now = Date.now();
    const end = now - Math.max(0, endOffsetMs);
    const next: Record<string, Point[]> = {};
    const nextStats: Record<string, SeriesStats | null> = {};
    let earliest = Infinity;
    for (const pid of pids) {
      const buf = (buffers.current[pid] ??= new ChartBuffer(4000));
      const v = values[pid];
      if (v) buf.push({ t: v.ts ?? now, v: v.value });
      const bounds = buf.bounds();
      if (bounds) earliest = Math.min(earliest, bounds.first);
      const windowed = buf.window(windowMs, end);
      next[pid] = decimate(windowed, maxPoints);
      // Stats (incl. `current`) come from the FULL-resolution window — the decimated series' last
      // point is a per-bucket min/max extreme, not necessarily the newest reading.
      nextStats[pid] = seriesStats(windowed);
    }
    setSeries(next);
    setStats(nextStats);
    setOldestOffsetMs(Number.isFinite(earliest) ? Math.max(0, now - earliest) : 0);
  }, [values, pids, windowMs, maxPoints, endOffsetMs]);

  return { series, stats, oldestOffsetMs };
}
