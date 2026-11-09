/** The unified vehicle report (plan 15): one shareable document for the active car — identity,
 *  readiness + fault codes (with VAG numbers and freeze frames), the latest module scan, the
 *  used-car inspection verdict, the battery result, the AI summary and the maintenance due list.
 *
 *  Pure and dependency-free (typechecked by the core tsconfig, unit-tested with ts-jest): it never
 *  imports feature types. The `report` feature's section mappers (`features/report/api/sections.ts`)
 *  narrow each store's shape into the types below, the same pattern as `DtcCheckReport`. Metric
 *  only — km, °C, V, %. See docs/features/report.md. */
import {
  dtcCheckBodyHtml,
  formatDtcCheck,
  milText,
  totalCodes,
  type DtcCheckReport,
} from './dtcReport';
import { REPORT_CSS, escHtml as esc } from './reportHtml';
import { vagCodeForDtc } from '@/shared/obd-core/obd/dtc';

export type ReportSectionId = 'faults' | 'scan' | 'inspection' | 'battery' | 'ai' | 'maintenance';

/** Every section, in document order. */
export const REPORT_SECTIONS: ReportSectionId[] = [
  'faults',
  'scan',
  'inspection',
  'battery',
  'ai',
  'maintenance',
];

/** Human section titles (document headings and the screen's checklist). */
export const REPORT_SECTION_TITLES: Record<ReportSectionId, string> = {
  faults: 'Fault codes & readiness',
  scan: 'Module scan',
  inspection: 'Used-car inspection',
  battery: 'Battery & charging',
  ai: 'AI diagnosis',
  maintenance: 'Maintenance due',
};

export interface ReportIdentity {
  /** `vehicleLabel(profile)` or the garage car's name. */
  label: string;
  vin: string | null;
  vinDecoded?: {
    manufacturer: string;
    country: string;
    modelYear: number | null;
    /** null when the check digit is not mandatory for this VIN (most non-North-American VINs). */
    checkDigitOk: boolean | null;
  };
  profileId: string;
  year?: number;
  engine?: string;
  fuel?: string;
  /** Protocol label (`PROTOCOL_LABELS[...]`), or the last scan's protocol when offline; null if unknown. */
  protocol: string | null;
  /** Adapter name (`deviceName`). */
  adapter: string | null;
  elmVersion: string | null;
  voltage: number | null;
  supportedPidCount: number | null;
  calibrationId: string | null;
  /** A live session was up when the report was built. When false, the identity comes from the
   *  last connection's stored data and the document says so. */
  connected: boolean;
  /** When offline: the newest timestamp among the stored records the report uses, if any. */
  lastSeenAt?: number | null;
}

export interface ReportScanFault {
  display: string;
  vagCode: string;
  description: string;
  statusText: string;
}

export interface ReportScanModule {
  address: string;
  name: string;
  state: string;
  partNumber?: string;
  systemName?: string;
  faults: ReportScanFault[];
}

export interface ReportScan {
  ts: number;
  protocol: string;
  /** UDS modules the profile declares, in scan order. */
  modules: ReportScanModule[];
  /** Pre-UDS (TP2.0) modules from the gateway's installation list, when the scan had any. */
  preUds: ReportScanModule[];
  /** Counts over `modules`, exactly as `formatAutoScanReport`'s header line counts them. */
  answered: number;
  withFaults: number;
  totalFaults: number;
}

export interface ReportInspection {
  ts: number | null;
  verdict: 'pass' | 'caution' | 'fail';
  score: number;
  checks: { label: string; status: 'pass' | 'warn' | 'fail' | 'info'; detail: string }[];
}

export interface ReportBattery {
  ts: number | null;
  restingV: number | null;
  crankingDipV: number | null;
  chargingV: number | null;
  socPct: number | null;
  verdict: string;
  notes: string[];
}

export interface ReportAi {
  ts: number | null;
  source: 'ai' | 'local';
  overall: 'ok' | 'attention' | 'urgent';
  summary: string;
  findings: { title: string; severity: string; detail: string; codes?: string[] }[];
  disclaimer: string;
}

export type ReportDueStatus = 'ok' | 'soon' | 'overdue' | 'unknown';

export interface ReportMaintenance {
  odoKm: number | null;
  due: {
    name: string;
    status: ReportDueStatus;
    dueInKm: number | null;
    dueInDays: number | null;
    lastOdoKm: number | null;
    lastDate: number | null;
  }[];
}

export interface VehicleReportModel {
  generatedAt: number;
  appVersion: string | null;
  identity: ReportIdentity;
  /** Readiness + DTCs + freeze frames (the fault-code report's own shape). */
  faults: DtcCheckReport | null;
  scan: ReportScan | null;
  inspection: ReportInspection | null;
  battery: ReportBattery | null;
  ai: ReportAi | null;
  maintenance: ReportMaintenance | null;
  /** Sections that were requested but had no data; rendered as a muted "not run yet" line. */
  missing: ReportSectionId[];
}

export interface VehicleReportInput {
  identity: ReportIdentity;
  faults?: DtcCheckReport | null;
  scan?: ReportScan | null;
  inspection?: ReportInspection | null;
  battery?: ReportBattery | null;
  ai?: ReportAi | null;
  maintenance?: ReportMaintenance | null;
  include: ReportSectionId[];
  appVersion?: string | null;
  now?: number;
}

/** Compose the report: keep each requested section that has data, drop the unrequested ones, and
 *  list requested-but-empty ones in `missing` (document order). Pure. */
export function buildVehicleReport(input: VehicleReportInput): VehicleReportModel {
  const want = new Set(input.include);
  const pick = <T>(id: ReportSectionId, v: T | null | undefined): T | null =>
    want.has(id) && v ? v : null;
  const model: VehicleReportModel = {
    generatedAt: input.now ?? Date.now(),
    appVersion: input.appVersion ?? null,
    identity: input.identity,
    faults: pick('faults', input.faults),
    scan: pick('scan', input.scan),
    inspection: pick('inspection', input.inspection),
    battery: pick('battery', input.battery),
    ai: pick('ai', input.ai),
    maintenance: pick('maintenance', input.maintenance),
    missing: [],
  };
  model.missing = REPORT_SECTIONS.filter((id) => want.has(id) && !model[id]);
  return model;
}

/** The sections present in a model, in document order. */
export function reportSections(model: VehicleReportModel): ReportSectionId[] {
  return REPORT_SECTIONS.filter((id) => model[id] !== null);
}

// --- Header severity --------------------------------------------------------------------------

export type ReportSeverity = 'ok' | 'attention' | 'urgent';

const SEVERITY_RANK: Record<ReportSeverity, number> = { ok: 0, attention: 1, urgent: 2 };

function worst(a: ReportSeverity, b: ReportSeverity): ReportSeverity {
  return SEVERITY_RANK[b] > SEVERITY_RANK[a] ? b : a;
}

/** The header badge: the worst of MIL on (urgent), the inspection verdict (fail → urgent, caution →
 *  attention), the AI overall health, a weak battery (attention) and any overdue service
 *  (attention). Only the sections present in the model count. */
export function reportSeverity(model: VehicleReportModel): ReportSeverity {
  let s: ReportSeverity = 'ok';
  if (model.faults?.milOn === true) s = worst(s, 'urgent');
  if (model.inspection) {
    const v = model.inspection.verdict;
    s = worst(s, v === 'fail' ? 'urgent' : v === 'caution' ? 'attention' : 'ok');
  }
  if (model.ai) s = worst(s, model.ai.overall);
  if (model.battery?.verdict === 'weak') s = worst(s, 'attention');
  if (model.maintenance?.due.some((d) => d.status === 'overdue')) s = worst(s, 'attention');
  return s;
}

const SEVERITY_LABEL: Record<ReportSeverity, string> = {
  ok: 'OK',
  attention: 'ATTENTION',
  urgent: 'URGENT',
};

/** HTML / PDF export badge colours; the on-screen preview uses palette tones (plan 20). */
export const SEVERITY_COLOR: Record<ReportSeverity, string> = {
  ok: '#2bb673',
  attention: '#d29922',
  urgent: '#d9342b',
};

// --- Formatting helpers (metric only) ---------------------------------------------------------

const p2 = (n: number) => n.toString().padStart(2, '0');

/** `2026-07-14 09:30 UTC` — readable and the same on every device. */
export function fmtReportTime(ts: number): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts);
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())} ${p2(
    d.getUTCHours(),
  )}:${p2(d.getUTCMinutes())} UTC`;
}

function fmtDate(ts: number): string {
  return fmtReportTime(ts).slice(0, 10);
}

/** Thousands grouped with a space: `123 456 km`. */
function fmtKm(km: number): string {
  return `${Math.round(km)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} km`;
}

function fmtV(v: number | null): string {
  return v === null ? '—' : `${v.toFixed(2)} V`;
}

/** "in 1 200 km · in 40 days", "overdue by 300 km", or "—". */
function dueText(d: ReportMaintenance['due'][number]): string {
  const parts: string[] = [];
  if (d.dueInKm !== null) {
    parts.push(d.dueInKm < 0 ? `overdue by ${fmtKm(-d.dueInKm)}` : `in ${fmtKm(d.dueInKm)}`);
  }
  if (d.dueInDays !== null) {
    const n = Math.abs(d.dueInDays);
    const days = `${n} day${n === 1 ? '' : 's'}`;
    parts.push(d.dueInDays < 0 ? `overdue by ${days}` : `in ${days}`);
  }
  return parts.length ? parts.join(' · ') : '—';
}

function lastServiceText(d: ReportMaintenance['due'][number]): string {
  const parts: string[] = [];
  if (d.lastOdoKm !== null) parts.push(fmtKm(d.lastOdoKm));
  if (d.lastDate !== null) parts.push(fmtDate(d.lastDate));
  return parts.length ? parts.join(' · ') : 'never logged';
}

/** One label/value pair of the identity block (value already plain text). */
function identityRows(id: ReportIdentity): [string, string][] {
  const rows: [string, string][] = [['Vehicle', id.label]];
  rows.push(['VIN', id.vin ?? 'not available']);
  if (id.vinDecoded) {
    rows.push(['Manufacturer', `${id.vinDecoded.manufacturer} (${id.vinDecoded.country})`]);
    if (id.vinDecoded.modelYear !== null) {
      rows.push(['Model year (from VIN)', String(id.vinDecoded.modelYear)]);
    }
    if (id.vinDecoded.checkDigitOk !== null) {
      rows.push(['VIN check digit', id.vinDecoded.checkDigitOk ? 'valid' : 'INVALID']);
    }
  }
  const spec = [id.year ? String(id.year) : null, id.engine, id.fuel].filter(Boolean).join(' · ');
  if (spec) rows.push(['Profile', `${spec} (${id.profileId})`]);
  else rows.push(['Profile', id.profileId]);
  rows.push([
    'Connection',
    id.connected
      ? 'connected'
      : `not connected — details from the last connection${
          id.lastSeenAt ? ` (${fmtReportTime(id.lastSeenAt)})` : ''
        }`,
  ]);
  if (id.protocol) rows.push(['Protocol', id.protocol]);
  if (id.adapter) rows.push(['Adapter', id.adapter]);
  if (id.elmVersion) rows.push(['ELM version', id.elmVersion]);
  if (id.voltage !== null) rows.push(['Voltage', `${id.voltage.toFixed(1)} V`]);
  if (id.supportedPidCount !== null) rows.push(['Supported PIDs', String(id.supportedPidCount)]);
  if (id.calibrationId) rows.push(['Calibration ID', id.calibrationId]);
  return rows;
}

const VERDICT_TEXT: Record<ReportInspection['verdict'], string> = {
  pass: 'PASS',
  caution: 'CAUTION',
  fail: 'FAIL',
};

const DUE_TEXT: Record<ReportDueStatus, string> = {
  ok: 'ok',
  soon: 'due soon',
  overdue: 'OVERDUE',
  unknown: 'no record',
};

/** One-line counts for the header ("2 fault codes · 3/4 modules answered · …"). */
export function reportHeadline(model: VehicleReportModel): string {
  const parts: string[] = [];
  if (model.faults) {
    const n = totalCodes(model.faults);
    parts.push(`${n} fault code${n === 1 ? '' : 's'}`);
  }
  if (model.scan) {
    parts.push(
      `${model.scan.answered}/${model.scan.modules.length} modules answered, ${model.scan.totalFaults} module fault${
        model.scan.totalFaults === 1 ? '' : 's'
      }`,
    );
  }
  if (model.inspection) parts.push(`inspection ${VERDICT_TEXT[model.inspection.verdict]}`);
  if (model.battery) parts.push(`battery ${model.battery.verdict}`);
  if (model.ai) parts.push(`AI ${model.ai.overall}`);
  if (model.maintenance) {
    const overdue = model.maintenance.due.filter((d) => d.status === 'overdue').length;
    parts.push(`${overdue} service item${overdue === 1 ? '' : 's'} overdue`);
  }
  return parts.length ? parts.join(' · ') : 'identity only';
}

// --- Markdown ---------------------------------------------------------------------------------

function mdFaults(f: DtcCheckReport): string[] {
  // formatDtcCheck renders one `## ` heading; demote it under this section's own heading. Code
  // lines ("  - P0299 — text") gain the VAG number, as in the HTML table.
  const body = formatDtcCheck(f)
    .split('\n')
    .map((l) => {
      if (l.startsWith('## ')) return `### Read ${fmtReportTime(f.ts)}`;
      const code = /^ {2}- ([PCBU][0-9A-F]{4}) — /.exec(l)?.[1];
      const vag = code ? vagCodeForDtc(code) : '';
      return code && vag ? l.replace(` ${code} — `, ` ${code} (VAG ${vag}) — `) : l;
    });
  return [`## ${REPORT_SECTION_TITLES.faults}`, '', ...body];
}

function mdScanModule(m: ReportScanModule): string[] {
  const lines = [
    `- ${m.address} ${m.name} — ${m.state}${m.partNumber ? ` · ${m.partNumber}` : ''}`,
  ];
  for (const f of m.faults) {
    const vag = f.vagCode ? `${f.vagCode} - ` : '';
    const code = f.display ? `${f.display} - ` : '';
    lines.push(`  - ${vag}${code}${f.description} (${f.statusText})`);
  }
  return lines;
}

function mdScan(s: ReportScan): string[] {
  const lines = [
    `## ${REPORT_SECTION_TITLES.scan}`,
    '',
    `- Scanned: ${fmtReportTime(s.ts)} · ${s.protocol}`,
    `- Modules: ${s.modules.length} declared, ${s.answered} answered, ${s.withFaults} with faults, ${s.totalFaults} fault${
      s.totalFaults === 1 ? '' : 's'
    } total`,
    '',
  ];
  for (const m of s.modules) lines.push(...mdScanModule(m));
  if (s.preUds.length) {
    lines.push('', '### Pre-UDS modules (TP2.0)', '');
    for (const m of s.preUds) lines.push(...mdScanModule(m));
  }
  return lines;
}

function mdInspection(i: ReportInspection): string[] {
  const lines = [
    `## ${REPORT_SECTION_TITLES.inspection}`,
    '',
    `- Verdict: ${VERDICT_TEXT[i.verdict]} (score ${i.score}/100)`,
  ];
  if (i.ts) lines.push(`- Run: ${fmtReportTime(i.ts)}`);
  lines.push('');
  for (const c of i.checks) lines.push(`- [${c.status}] ${c.label}: ${c.detail}`);
  return lines;
}

function mdBattery(b: ReportBattery): string[] {
  const lines = [`## ${REPORT_SECTION_TITLES.battery}`, '', `- Verdict: ${b.verdict}`];
  if (b.ts) lines.push(`- Captured: ${fmtReportTime(b.ts)}`);
  lines.push(
    `- Resting: ${fmtV(b.restingV)}${b.socPct !== null ? ` (≈${Math.round(b.socPct)} % charge)` : ''}`,
  );
  lines.push(`- Cranking dip: ${fmtV(b.crankingDipV)}`);
  lines.push(`- Charging: ${fmtV(b.chargingV)}`);
  for (const n of b.notes) lines.push(`- ${n}`);
  return lines;
}

function mdAi(a: ReportAi): string[] {
  const lines = [
    `## ${REPORT_SECTION_TITLES.ai}`,
    '',
    `- Overall: ${a.overall} (${a.source === 'ai' ? 'AI model' : 'local rules'})`,
  ];
  if (a.ts) lines.push(`- Run: ${fmtReportTime(a.ts)}`);
  lines.push('', a.summary, '');
  for (const f of a.findings) {
    const codes = f.codes?.length ? ` [${f.codes.join(', ')}]` : '';
    lines.push(`- **${f.title}** (${f.severity})${codes}: ${f.detail}`);
  }
  lines.push('', `_${a.disclaimer}_`);
  return lines;
}

function mdMaintenance(m: ReportMaintenance): string[] {
  const lines = [
    `## ${REPORT_SECTION_TITLES.maintenance}`,
    '',
    `- Odometer: ${m.odoKm !== null ? fmtKm(m.odoKm) : 'not entered'}`,
    '',
  ];
  for (const d of m.due) {
    if (d.status === 'unknown' && d.lastOdoKm === null && d.lastDate === null) {
      lines.push(`- ${d.name}: no record yet`);
    } else {
      lines.push(
        `- ${d.name}: ${DUE_TEXT[d.status]} — ${dueText(d)} (last: ${lastServiceText(d)})`,
      );
    }
  }
  return lines;
}

/** The report as Markdown: identity in the header, then one `## ` heading per present section.
 *  Requested sections without data are listed on a single "Not run yet" line. */
export function renderReportMarkdown(model: VehicleReportModel): string {
  const sev = reportSeverity(model);
  const lines: string[] = [
    `# Vehicle report — ${model.identity.label}`,
    '',
    `Status: **${SEVERITY_LABEL[sev]}** · ${reportHeadline(model)}`,
    `Generated: ${fmtReportTime(model.generatedAt)}${
      model.appVersion ? ` · Bolid Tester v${model.appVersion}` : ''
    }`,
    '',
  ];
  for (const [k, v] of identityRows(model.identity)) lines.push(`- ${k}: ${v}`);
  if (model.missing.length) {
    lines.push(
      '',
      `_Not run yet: ${model.missing.map((id) => REPORT_SECTION_TITLES[id]).join(', ')}._`,
    );
  }

  const sections: string[][] = [];
  if (model.faults) sections.push(mdFaults(model.faults));
  if (model.scan) sections.push(mdScan(model.scan));
  if (model.inspection) sections.push(mdInspection(model.inspection));
  if (model.battery) sections.push(mdBattery(model.battery));
  if (model.ai) sections.push(mdAi(model.ai));
  if (model.maintenance) sections.push(mdMaintenance(model.maintenance));
  for (const s of sections) lines.push('', ...s);

  lines.push(
    '',
    '---',
    '',
    'Generated by Bolid Tester. Codes may return if the underlying fault persists.',
  );
  return lines.join('\n') + '\n';
}

// --- HTML -------------------------------------------------------------------------------------

/** Extra rules on top of the fault-code report's stylesheet: severity badges, status chips, page
 *  breaks before the long sections when printed to PDF. */
const VEHICLE_REPORT_CSS = `
  .badge.sev-ok { background: ${SEVERITY_COLOR.ok}; } .badge.sev-attention { background: ${SEVERITY_COLOR.attention}; }
  .badge.sev-urgent { background: ${SEVERITY_COLOR.urgent}; }
  h2.section { font-size: 17px; margin: 28px 0 8px; border-bottom: 2px solid #2bb673; padding-bottom: 4px; }
  .chip { display: inline-block; padding: 1px 8px; border-radius: 10px; font-size: 11px; font-weight: 700; color: #fff; background: #8b949e; }
  .chip.pass, .chip.ok, .chip.good { background: #2bb673; } .chip.warn, .chip.soon, .chip.caution, .chip.fair, .chip.attention { background: #d29922; }
  .chip.fail, .chip.overdue, .chip.weak, .chip.urgent, .chip.critical { background: #d9342b; } .chip.info, .chip.unknown { background: #8b949e; }
  tr.fault td { color: #444; font-size: 12px; padding-top: 2px; }
  .missing { color: #999; font-style: italic; margin: 8px 0; font-size: 13px; }
  .note { font-size: 13px; color: #444; }
  @media print { .page-break { break-before: page; } }`;

function metaHtml(rows: [string, string][]): string {
  return `<div class="meta">${rows
    .map(
      ([k, v]) =>
        `<div class="meta-row"><span class="meta-k">${esc(k)}</span><span class="meta-v">${esc(v)}</span></div>`,
    )
    .join('')}</div>`;
}

function chip(cls: string, text: string): string {
  return `<span class="chip ${esc(cls)}">${esc(text)}</span>`;
}

function sectionHead(id: ReportSectionId, pageBreak = false): string {
  return `<h2 class="section${pageBreak ? ' page-break' : ''}" id="sec-${id}">${esc(
    REPORT_SECTION_TITLES[id],
  )}</h2>`;
}

function htmlFaults(f: DtcCheckReport): string {
  const rows: [string, string][] = [['MIL', milText(f.milOn).toUpperCase()]];
  if (f.monitorsTotal !== null && f.monitorsTotal !== undefined) {
    rows.push(['Readiness', `${f.monitorsComplete ?? 0}/${f.monitorsTotal} monitors complete`]);
  }
  if (f.notReady && f.notReady.length > 0) rows.push(['Not ready', f.notReady.join(', ')]);
  rows.push(['Read', fmtReportTime(f.ts)]);
  return `<section>${sectionHead('faults')}${metaHtml(rows)}</section>
${dtcCheckBodyHtml(f)}`;
}

function scanRows(modules: ReportScanModule[]): string {
  return modules
    .map((m) => {
      const ident = [m.partNumber, m.systemName].filter(Boolean).join(' · ');
      const head = `<tr><td class="code">${esc(m.address)}</td><td>${esc(m.name)}${
        ident ? `<div class="muted">${esc(ident)}</div>` : ''
      }</td><td>${esc(m.state)}</td><td class="num">${m.faults.length}</td></tr>`;
      const faults = m.faults
        .map((f) => {
          const parts = [f.vagCode, f.display, f.description].filter(Boolean).join(' - ');
          return `<tr class="fault"><td></td><td colspan="3">${esc(parts)} <span class="muted">(${esc(
            f.statusText,
          )})</span></td></tr>`;
        })
        .join('');
      return head + faults;
    })
    .join('');
}

function scanTable(modules: ReportScanModule[]): string {
  return `<table><thead><tr><th>Addr</th><th>Module</th><th>State</th><th>Faults</th></tr></thead>
<tbody>${scanRows(modules)}</tbody></table>`;
}

function htmlScan(s: ReportScan): string {
  const rows: [string, string][] = [
    ['Scanned', fmtReportTime(s.ts)],
    ['Protocol', s.protocol],
    [
      'Modules',
      `${s.modules.length} declared, ${s.answered} answered, ${s.withFaults} with faults, ${s.totalFaults} fault${
        s.totalFaults === 1 ? '' : 's'
      } total`,
    ],
  ];
  const pre = s.preUds.length
    ? `<h2>Pre-UDS modules (TP2.0) <span class="count">(${s.preUds.length})</span></h2>${scanTable(s.preUds)}`
    : '';
  return `<section>${sectionHead('scan', true)}${metaHtml(rows)}${scanTable(s.modules)}${pre}</section>`;
}

function htmlInspection(i: ReportInspection): string {
  const rows: [string, string][] = [['Score', `${i.score}/100`]];
  if (i.ts) rows.push(['Run', fmtReportTime(i.ts)]);
  const checks = i.checks
    .map(
      (c) =>
        `<tr><td>${chip(c.status, c.status)}</td><td><strong>${esc(c.label)}</strong><div class="note">${esc(
          c.detail,
        )}</div></td></tr>`,
    )
    .join('');
  return `<section>${sectionHead('inspection')}<p>Verdict: ${chip(i.verdict, VERDICT_TEXT[i.verdict])}</p>${metaHtml(
    rows,
  )}<table><tbody>${checks}</tbody></table></section>`;
}

function htmlBattery(b: ReportBattery): string {
  const rows: [string, string][] = [
    ['Resting', fmtV(b.restingV)],
    ['State of charge', b.socPct !== null ? `≈${Math.round(b.socPct)} %` : '—'],
    ['Cranking dip', fmtV(b.crankingDipV)],
    ['Charging', fmtV(b.chargingV)],
  ];
  if (b.ts) rows.push(['Captured', fmtReportTime(b.ts)]);
  const notes = b.notes.map((n) => `<li>${esc(n)}</li>`).join('');
  return `<section>${sectionHead('battery')}<p>Verdict: ${chip(b.verdict, b.verdict)}</p>${metaHtml(rows)}${
    notes ? `<ul class="note">${notes}</ul>` : ''
  }</section>`;
}

function htmlAi(a: ReportAi): string {
  const rows: [string, string][] = [['Source', a.source === 'ai' ? 'AI model' : 'local rules']];
  if (a.ts) rows.push(['Run', fmtReportTime(a.ts)]);
  const findings = a.findings
    .map((f) => {
      const codes = f.codes?.length
        ? ` <span class="muted">[${esc(f.codes.join(', '))}]</span>`
        : '';
      return `<tr><td>${chip(f.severity, f.severity)}</td><td><strong>${esc(f.title)}</strong>${codes}<div class="note">${esc(
        f.detail,
      )}</div></td></tr>`;
    })
    .join('');
  return `<section>${sectionHead('ai')}<p>Overall: ${chip(a.overall, a.overall)}</p>${metaHtml(rows)}<p>${esc(
    a.summary,
  )}</p>${findings ? `<table><tbody>${findings}</tbody></table>` : ''}<p class="muted">${esc(
    a.disclaimer,
  )}</p></section>`;
}

function htmlMaintenance(m: ReportMaintenance): string {
  const rows: [string, string][] = [
    ['Odometer', m.odoKm !== null ? fmtKm(m.odoKm) : 'not entered'],
  ];
  const due = m.due
    .map(
      (d) =>
        `<tr><td>${esc(d.name)}</td><td>${chip(d.status, DUE_TEXT[d.status])}</td><td>${esc(
          dueText(d),
        )}</td><td class="muted">${esc(lastServiceText(d))}</td></tr>`,
    )
    .join('');
  return `<section>${sectionHead('maintenance', true)}${metaHtml(rows)}
<table><thead><tr><th>Item</th><th>Status</th><th>Due</th><th>Last service</th></tr></thead>
<tbody>${due}</tbody></table></section>`;
}

/** Self-contained HTML (inline CSS, no external assets) — what **Share HTML** sends and what
 *  `expo-print` turns into the PDF. Every string goes through `esc`. */
export function renderReportHtml(model: VehicleReportModel, opts: { title?: string } = {}): string {
  const title = opts.title ?? 'Bolid Tester — vehicle report';
  const sev = reportSeverity(model);
  const missing = model.missing.length
    ? `<p class="missing">Not run yet: ${esc(
        model.missing.map((id) => REPORT_SECTION_TITLES[id]).join(', '),
      )}.</p>`
    : '';
  const body = [
    model.faults ? htmlFaults(model.faults) : '',
    model.scan ? htmlScan(model.scan) : '',
    model.inspection ? htmlInspection(model.inspection) : '',
    model.battery ? htmlBattery(model.battery) : '',
    model.ai ? htmlAi(model.ai) : '',
    model.maintenance ? htmlMaintenance(model.maintenance) : '',
  ]
    .filter(Boolean)
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
${REPORT_CSS}${VEHICLE_REPORT_CSS}
</style></head>
<body><div class="wrap">
<header>
  <h1>${esc(title)}<span class="badge sev-${sev}">${SEVERITY_LABEL[sev]}</span></h1>
  <div class="sub">${esc(model.identity.label)} · ${esc(reportHeadline(model))}</div>
</header>
${metaHtml(identityRows(model.identity))}
${missing}
${body}
<footer>Generated ${esc(fmtReportTime(model.generatedAt))} by Bolid Tester${
    model.appVersion ? ` v${esc(model.appVersion)}` : ''
  } — share with your mechanic. Codes may return if the underlying fault persists.</footer>
</div></body></html>`;
}

/** `bolid-report-<vin-or-profile>-<yyyymmdd-hhmm>` (UTC), safe as a file name on every platform. */
export function reportFileStem(model: VehicleReportModel): string {
  const who = (model.identity.vin || model.identity.profileId).replace(/[^A-Za-z0-9-]+/g, '-');
  const d = new Date(model.generatedAt);
  const stamp = `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}-${p2(
    d.getUTCHours(),
  )}${p2(d.getUTCMinutes())}`;
  return `bolid-report-${who}-${stamp}`;
}
