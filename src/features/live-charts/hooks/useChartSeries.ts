import { useEffect, useRef, useState } from 'react';
import { ChartBuffer, Point, SeriesStats, decimate, seriesStats } from '@/shared/obd-core';
import { useLiveDataStore } from '@/features/live-data/model/liveDataStore';

/** Maintain a rolling buffer per PID from the live snapshot; return decimated, plot-ready series. */
export function useChartSeries(pids: string[], windowMs: number, maxPoints = 120) {
  const buffers = useRef<Record<string, ChartBuffer>>({});
  const values = useLiveDataStore((s) => s.values);
  const [series, setSeries] = useState<Record<string, Point[]>>({});
  const [stats, setStats] = useState<Record<string, SeriesStats | null>>({});

  useEffect(() => {
    const now = Date.now();
    const next: Record<string, Point[]> = {};
    const nextStats: Record<string, SeriesStats | null> = {};
    for (const pid of pids) {
      const buf = (buffers.current[pid] ??= new ChartBuffer(4000));
      const v = values[pid];
      if (v) buf.push({ t: v.ts ?? now, v: v.value });
      const windowed = buf.window(windowMs, now);
      next[pid] = decimate(windowed, maxPoints);
      // Stats (incl. `current`) come from the FULL-resolution window — the decimated series' last
      // point is a per-bucket min/max extreme, not necessarily the newest reading.
      nextStats[pid] = seriesStats(windowed);
    }
    setSeries(next);
    setStats(nextStats);
  }, [values, pids, windowMs, maxPoints]);

  return { series, stats };
}
