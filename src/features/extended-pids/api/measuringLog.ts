/** Measuring-block logging (6b.6) — VCDS's "Log" button for module DIDs. The recording buffer lives
 *  at MODULE scope (not React state) so appending thousands of rows over a long log never re-renders
 *  the screen; the UI reacts only to a small sweep counter in the hook. The CSV builder is pure and
 *  unit-tested. File write + share happen in the hook via the same dependency-tolerant expo pattern
 *  as useDtcExport / the trip recorder (we copy the pattern rather than import across features).
 *  See docs/features/extended-pids.md. */

export interface MeasuringLogRow {
  /** Sample time, epoch ms. */
  t: number;
  /** DID hex (e.g. '1708'). */
  did: string;
  name: string;
  /** Decoded value, or null when the DID returned no data that sweep. */
  value: number | null;
  unit: string;
}

/** Quote a CSV field only when it contains a comma, quote or newline (RFC-4180 minimal quoting). */
function csvField(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Build the measuring-log CSV. Columns: timestamp_iso, epoch_ms, did, name, value, unit. Rows are
 *  sorted by time then DID for a stable, diff-friendly export. Pure — no I/O. */
export function buildMeasuringLogCsv(rows: MeasuringLogRow[]): string {
  const header = 'timestamp_iso,epoch_ms,did,name,value,unit';
  const sorted = [...rows].sort((a, b) => a.t - b.t || a.did.localeCompare(b.did));
  const lines = sorted.map((r) => {
    const iso = new Date(r.t).toISOString();
    const value = r.value == null ? '' : String(r.value);
    return [iso, String(r.t), r.did, csvField(r.name), value, csvField(r.unit)].join(',');
  });
  return [header, ...lines].join('\n') + '\n';
}

// --- Module-level recording buffer -------------------------------------------------------------
let buffer: MeasuringLogRow[] = [];

export function resetMeasuringLog(): void {
  buffer = [];
}

export function appendMeasuringRow(row: MeasuringLogRow): void {
  buffer.push(row);
}

export function getMeasuringLog(): MeasuringLogRow[] {
  return buffer;
}

export function measuringLogSize(): number {
  return buffer.length;
}
