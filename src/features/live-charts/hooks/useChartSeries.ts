import { useEffect, useRef, useState } from 'react';
import { ChartBuffer, Point, decimate, seriesStats } from '@/shared/obd-core';
import { useLiveDataStore } from '@/features/live-data/model/liveDataStore';

/** Maintain a rolling buffer per PID from the live snapshot; return decimated, plot-ready series. */
export function useChartSeries(pids: string[], windowMs: number, maxPoints = 120) {
  const buffers = useRef<Record<string, ChartBuffer>>({});
  const values = useLiveDataStore((s) => s.values);
  const [series, setSeries] = useState<Record<string, Point[]>>({});

  useEffect(() => {
    const now = Date.now();
    const next: Record<string, Point[]> = {};
    for (const pid of pids) {
      const buf = (buffers.current[pid] ??= new ChartBuffer(4000));
      const v = values[pid];
      if (v) buf.push({ t: v.ts ?? now, v: v.value });
      next[pid] = decimate(buf.window(windowMs, now), maxPoints);
    }
    setSeries(next);
  }, [values, pids, windowMs, maxPoints]);

  const stats = Object.fromEntries(Object.entries(series).map(([pid, pts]) => [pid, seriesStats(pts)]));
  return { series, stats };
}
