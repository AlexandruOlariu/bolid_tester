/** Pure, dependency-free formatting of fault-code (DTC) checks into a human-readable Markdown report
 *  for export/sharing. Used by the Fault codes screen (the current live read) and the History screen
 *  (every saved check). No React/RN deps, so it is unit-tested in isolation — the same pattern as
 *  errorLog.ts. See docs/features/fault-codes.md. */
import type { Dtc } from '@/shared/obd-core/obd/dtc';

/** One decoded freeze-frame value (mirrors the live-read shape, narrowed to what we print). */
export interface DtcFreezeValue {
  name: string;
  value: number;
  unit: string;
}

/** A single fault-code check, normalised so a saved history entry and a live on-screen read render
 *  through the same code path. The `notReady` / `freezeFrame` extras are only available for a live
 *  read and are simply omitted for history entries. */
export interface DtcCheckReport {
  ts: number;
  vehicleLabel?: string | null;
  vin?: string | null;
  /** Malfunction Indicator Lamp: true = on, false = off, null/undefined = not read. */
  milOn?: boolean | null;
  stored: Dtc[];
  pending: Dtc[];
  permanent: Dtc[];
  monitorsComplete?: number | null;
  monitorsTotal?: number | null;
  /** Names of supported readiness monitors that are not yet complete (live read only). */
  notReady?: string[];
  /** Freeze-frame snapshot captured when a code set (live read only). */
  freezeFrame?: { triggerDtc: string | null; values: DtcFreezeValue[] } | null;
}

export interface DtcReportOptions {
  /** Document H1. Defaults to a generic title. */
  title?: string;
  appVersion?: string;
  /** Injectable clock for the "Exported" line, so tests are deterministic. */
  now?: number;
}

function fmtTime(ts: number): string {
  try {
    return new Date(ts).toISOString();
  } catch {
    return String(ts);
  }
}

function milText(mil: boolean | null | undefined): string {
  if (mil === null || mil === undefined) return 'unknown';
  return mil ? 'ON' : 'off';
}

function codeLines(label: string, codes: Dtc[]): string[] {
  if (codes.length === 0) return [`- ${label} (0): none`];
  const lines = [`- ${label} (${codes.length}):`];
  for (const d of codes) lines.push(`  - ${d.code} — ${d.description}`);
  return lines;
}

function totalCodes(c: DtcCheckReport): number {
  return c.stored.length + c.pending.length + c.permanent.length;
}

/** Render a single check as one `## ` Markdown section (no trailing blank line). */
export function formatDtcCheck(check: DtcCheckReport): string {
  const who =
    check.vehicleLabel && check.vehicleLabel.length > 0 ? check.vehicleLabel : 'Unknown vehicle';
  const lines: string[] = [`## ${who} — ${fmtTime(check.ts)}`, ''];

  if (check.vin) lines.push(`- VIN: ${check.vin}`);
  lines.push(`- MIL: ${milText(check.milOn)}`);
  if (check.monitorsTotal !== null && check.monitorsTotal !== undefined) {
    lines.push(`- Monitors: ${check.monitorsComplete ?? 0}/${check.monitorsTotal} complete`);
  }
  if (check.notReady && check.notReady.length > 0) {
    lines.push(`- Not ready: ${check.notReady.join(', ')}`);
  }

  lines.push('');
  lines.push(...codeLines('Stored', check.stored));
  lines.push(...codeLines('Pending', check.pending));
  lines.push(...codeLines('Permanent', check.permanent));

  if (check.freezeFrame && check.freezeFrame.values.length > 0) {
    lines.push('');
    lines.push(`- Freeze frame (captured when ${check.freezeFrame.triggerDtc ?? 'a code'} set):`);
    for (const v of check.freezeFrame.values) {
      lines.push(`  - ${v.name}: ${v.value} ${v.unit}`.trimEnd());
    }
  }

  return lines.join('\n');
}

/** Full Markdown document for one or more checks, in the order given (callers pass newest-first). */
export function formatDtcReport(checks: DtcCheckReport[], opts: DtcReportOptions = {}): string {
  const lines: string[] = [`# ${opts.title ?? 'Bolid Tester — fault codes'}`, ''];
  lines.push(`Exported: ${fmtTime(opts.now ?? Date.now())}`);
  if (opts.appVersion) lines.push(`App version: ${opts.appVersion}`);
  lines.push(`Checks: ${checks.length}`);
  lines.push(`Total codes: ${checks.reduce((n, c) => n + totalCodes(c), 0)}`);
  lines.push('');

  if (checks.length === 0) {
    lines.push('_No fault-code checks to export._');
    return lines.join('\n') + '\n';
  }

  for (const c of checks) {
    lines.push(formatDtcCheck(c));
    lines.push('');
  }
  return lines.join('\n').trimEnd() + '\n';
}
