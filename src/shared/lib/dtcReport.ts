/** Pure, dependency-free formatting of fault-code (DTC) checks into a human-readable Markdown report
 *  for export/sharing. Used by the Fault codes screen (the current live read) and the History screen
 *  (every saved check). No React/RN deps, so it is unit-tested in isolation — the same pattern as
 *  errorLog.ts. See docs/features/fault-codes.md. */
import type { Dtc } from '@/shared/obd-core/obd/dtc';
import { vagCodeForDtc } from '@/shared/obd-core/obd/dtc';
import type { MonitorStatus } from '@/shared/obd-core/obd/readiness';
import { PROTOCOL_LABELS } from '@/shared/obd-core/obd/protocols';
import type { FreezeFrame, SessionInfo } from '@/shared/obd-core/session/DiagnosticSession';
import { REPORT_CSS, escHtml } from './reportHtml';

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
  /** All captured frames (one per stored code) — preferred over `freezeFrame` when present. */
  freezeFrames?: { triggerDtc: string | null; values: DtcFreezeValue[] }[];
  /** Negotiated OBD protocol (e.g. 'ISO 15765-4 (CAN 11/500)') — HTML report only. */
  protocol?: string | null;
  /** Adapter battery voltage in volts (ATRV) — HTML report only. */
  voltage?: number | null;
  /** Adapter label/source (e.g. 'Simulator', 'BLE') — HTML report only. */
  adapter?: string | null;
}

/** A live fault-code read, as `dtcStore` holds it (structurally: codes, readiness, frames). */
export interface DtcLiveRead {
  stored: Dtc[];
  pending: Dtc[];
  permanent: Dtc[];
  readiness: MonitorStatus | null;
  freezeFrames: FreezeFrame[];
}

const freezeValues = (values: FreezeFrame['values']): DtcFreezeValue[] =>
  values.map((v) => ({ name: v.name, value: v.value, unit: v.unit }));

/** Snapshot a live read as the normalised report shape — readiness, every code mode, all freeze
 *  frames, the VIN / protocol label / voltage from the session and the adapter name. The Faults
 *  screen's Export / Share report buttons and the unified vehicle report (plan 15, as
 *  `faultsFromStores`) both use it. Pure. */
export function dtcCheckFromRead(
  read: DtcLiveRead,
  info: Pick<SessionInfo, 'vin' | 'protocol' | 'voltage'> | null,
  vehicleLabel: string,
  opts: { ts?: number; adapter?: string | null } = {},
): DtcCheckReport {
  const { readiness, freezeFrames } = read;
  const supported = readiness ? readiness.monitors.filter((m) => m.supported) : [];
  return {
    ts: opts.ts ?? Date.now(),
    vehicleLabel,
    vin: info?.vin ?? null,
    protocol: info ? PROTOCOL_LABELS[info.protocol] : null,
    voltage: info?.voltage ?? null,
    adapter: opts.adapter ?? null,
    milOn: readiness ? readiness.milOn : null,
    stored: read.stored,
    pending: read.pending,
    permanent: read.permanent,
    monitorsComplete: readiness ? supported.filter((m) => m.complete).length : null,
    monitorsTotal: readiness ? supported.length : null,
    notReady: readiness ? supported.filter((m) => !m.complete).map((m) => m.name) : [],
    freezeFrame: freezeFrames[0]
      ? { triggerDtc: freezeFrames[0].triggerDtc, values: freezeValues(freezeFrames[0].values) }
      : null,
    freezeFrames: freezeFrames.map((ff) => ({
      triggerDtc: ff.triggerDtc,
      values: freezeValues(ff.values),
    })),
  };
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

export function milText(mil: boolean | null | undefined): string {
  if (mil === null || mil === undefined) return 'unknown';
  return mil ? 'ON' : 'off';
}

function codeLines(label: string, codes: Dtc[]): string[] {
  if (codes.length === 0) return [`- ${label} (0): none`];
  const lines = [`- ${label} (${codes.length}):`];
  for (const d of codes) lines.push(`  - ${d.code} — ${d.description}`);
  return lines;
}

export function totalCodes(c: DtcCheckReport): number {
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

  const frames = check.freezeFrames?.length
    ? check.freezeFrames
    : check.freezeFrame
      ? [check.freezeFrame]
      : [];
  for (const [i, frame] of frames.entries()) {
    if (!frame.values.length) continue;
    lines.push('');
    lines.push(
      `- Freeze frame ${frames.length > 1 ? `${i + 1}/${frames.length} ` : ''}(captured when ${frame.triggerDtc ?? 'a code'} set):`,
    );
    for (const v of frame.values) {
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

// --- Shareable HTML report (the "send to my mechanic" artifact) -------------------------------

const esc = escHtml;

/** One `<tr>` per code, with the VAG cross-reference number when the DTC has one (VAG cars, classic
 *  2-byte powertrain codes). Empty section renders a muted "none" row. */
function codeRows(codes: Dtc[]): string {
  if (codes.length === 0) {
    return '<tr><td class="muted" colspan="3">none</td></tr>';
  }
  return codes
    .map((d) => {
      const vag = vagCodeForDtc(d.code);
      return `<tr><td class="code">${esc(d.code)}</td><td class="vag">${
        vag ? esc(vag) : '—'
      }</td><td>${esc(d.description)}</td></tr>`;
    })
    .join('');
}

function codeTable(title: string, codes: Dtc[]): string {
  return `<section><h2>${esc(title)} <span class="count">(${codes.length})</span></h2>
<table><thead><tr><th>OBD-II</th><th>VAG</th><th>Description</th></tr></thead>
<tbody>${codeRows(codes)}</tbody></table></section>`;
}

/** The freeze-frame sections of a check as HTML (empty string when none were captured). Shared
 *  with the unified vehicle report (`vehicleReport.ts`). */
export function freezeFramesHtml(check: DtcCheckReport): string {
  const frames = check.freezeFrames?.length
    ? check.freezeFrames
    : check.freezeFrame
      ? [check.freezeFrame]
      : [];
  return frames
    .filter((f) => f.values.length > 0)
    .map((frame, i) => {
      const rows = frame.values
        .map(
          (v) =>
            `<tr><td>${esc(v.name)}</td><td class="num">${esc(String(v.value))} ${esc(v.unit)}</td></tr>`,
        )
        .join('');
      const label = frames.length > 1 ? `Freeze frame ${i + 1}/${frames.length}` : 'Freeze frame';
      return `<section><h2>${label} <span class="count">(when ${esc(frame.triggerDtc ?? 'a code')} set)</span></h2>
<table><tbody>${rows}</tbody></table></section>`;
    })
    .join('');
}

/** The stored / pending / permanent code tables followed by the freeze frames — the body of the
 *  fault-code report, reused verbatim by the unified vehicle report. */
export function dtcCheckBodyHtml(check: DtcCheckReport): string {
  return `${codeTable('Stored codes', check.stored)}
${codeTable('Pending codes', check.pending)}
${codeTable('Permanent codes', check.permanent)}
${freezeFramesHtml(check)}`;
}

/** Self-contained styled HTML for one fault-code check — the printable/shareable diagnostic report.
 *  Inline CSS only (no external assets), print-friendly. Includes vehicle + VIN + protocol, adapter
 *  + voltage, readiness, stored/pending/permanent DTCs with VAG numbers, any freeze frames, and the
 *  timestamp. Pure and dependency-free, so it is unit-tested in isolation. */
export function buildDtcReportHtml(check: DtcCheckReport, opts: DtcReportOptions = {}): string {
  const who =
    check.vehicleLabel && check.vehicleLabel.length > 0 ? check.vehicleLabel : 'Unknown vehicle';
  const title = opts.title ?? 'Bolid Tester — diagnostic report';

  const meta: string[] = [];
  const metaRow = (label: string, value: string) =>
    meta.push(
      `<div class="meta-row"><span class="meta-k">${esc(label)}</span><span class="meta-v">${value}</span></div>`,
    );
  metaRow('Vehicle', esc(who));
  if (check.vin) metaRow('VIN', esc(check.vin));
  if (check.protocol) metaRow('Protocol', esc(check.protocol));
  if (check.adapter) metaRow('Adapter', esc(check.adapter));
  if (check.voltage !== null && check.voltage !== undefined) {
    metaRow('Voltage', `${check.voltage.toFixed(1)} V`);
  }
  metaRow('MIL', milText(check.milOn).toUpperCase());
  if (check.monitorsTotal !== null && check.monitorsTotal !== undefined) {
    metaRow('Readiness', `${check.monitorsComplete ?? 0}/${check.monitorsTotal} monitors complete`);
  }
  if (check.notReady && check.notReady.length > 0) {
    metaRow('Not ready', esc(check.notReady.join(', ')));
  }
  metaRow('Checked', esc(fmtTime(check.ts)));
  metaRow('Exported', esc(fmtTime(opts.now ?? Date.now())));

  const total = totalCodes(check);
  const milOnFlag = check.milOn === true;

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
${REPORT_CSS}
</style></head>
<body><div class="wrap">
<header>
  <h1>${esc(title)}<span class="badge ${milOnFlag ? 'on' : 'off'}">MIL ${milOnFlag ? 'ON' : 'off'}</span></h1>
  <div class="sub">${total} fault code${total === 1 ? '' : 's'} · generated by Bolid Tester${
    opts.appVersion ? ` v${esc(opts.appVersion)}` : ''
  }</div>
</header>
<div class="meta">${meta.join('')}</div>
${dtcCheckBodyHtml(check)}
<footer>Generated ${esc(fmtTime(opts.now ?? Date.now()))} — share with your mechanic. Codes may return if the underlying fault persists.</footer>
</div></body></html>`;
}
