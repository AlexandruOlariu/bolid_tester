import type { Point } from '@/shared/obd-core';

/** RFC 4180 quoting for a free-text field (labels may carry commas or quotes). */
function csvField(s: string): string {
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Turn one panel's plot-ready series (per-key point arrays) into CSV text. Pure — no I/O — so it is
 *  unit-tested and reused by the share flow. Long format (`pid,timestamp_iso,epoch_ms,value`) keeps it
 *  robust when overlaid series are sampled/decimated at different timestamps. Rows are sorted by time
 *  then key for a stable, diff-friendly export.
 *
 *  `pid` is the live-value key — a Mode 01 PID (`010C`) or an extended key (`22:1701`). Pass
 *  `labels` (key → human label, `labelForLiveKey`) to add a trailing `label` column so a mixed
 *  panel stays readable outside the app; without it the format is unchanged. */
export function seriesToCsv(
  series: Record<string, Point[]>,
  labels?: Record<string, string>,
): string {
  const withLabels = labels !== undefined;
  const header = 'pid,timestamp_iso,epoch_ms,value' + (withLabels ? ',label' : '');
  const rows: { t: number; pid: string; line: string }[] = [];
  for (const pid of Object.keys(series)) {
    const label = withLabels ? ',' + csvField(labels[pid] ?? pid) : '';
    for (const p of series[pid] ?? []) {
      const iso = new Date(p.t).toISOString();
      rows.push({ t: p.t, pid, line: `${pid},${iso},${p.t},${p.v}${label}` });
    }
  }
  rows.sort((a, b) => a.t - b.t || a.pid.localeCompare(b.pid));
  return [header, ...rows.map((r) => r.line)].join('\n') + '\n';
}
