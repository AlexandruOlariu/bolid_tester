import type { Point } from '@/shared/obd-core';

/** Turn one panel's plot-ready series (per-PID point arrays) into CSV text. Pure — no I/O — so it is
 *  unit-tested and reused by the share flow. Long format (`pid,timestamp_iso,epoch_ms,value`) keeps it
 *  robust when overlaid PIDs are sampled/decimated at different timestamps. Rows are sorted by time
 *  then PID for a stable, diff-friendly export. */
export function seriesToCsv(series: Record<string, Point[]>): string {
  const header = 'pid,timestamp_iso,epoch_ms,value';
  const rows: { t: number; pid: string; line: string }[] = [];
  for (const pid of Object.keys(series)) {
    for (const p of series[pid] ?? []) {
      const iso = new Date(p.t).toISOString();
      rows.push({ t: p.t, pid, line: `${pid},${iso},${p.t},${p.v}` });
    }
  }
  rows.sort((a, b) => a.t - b.t || a.pid.localeCompare(b.pid));
  return [header, ...rows.map((r) => r.line)].join('\n') + '\n';
}
