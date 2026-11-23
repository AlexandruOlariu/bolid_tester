/** The "Send to Claude / ChatGPT" package (plan 34d): one plain-English text with everything an AI
 *  diagnose run read and concluded — the car, the complaint, the fault codes, the assistant's report
 *  with the steps each finding rests on, and every check the agent made with its data — headed by an
 *  instruction for the assistant the owner pastes it into. It leaves the phone only through the
 *  system share sheet (no network destination of its own), so the VIN is hidden everywhere unless
 *  the owner turns it on in the preview. English on purpose: it is a document read by another app,
 *  not app UI. Pure; see docs/features/ai-diagnose.md → Send to Claude / ChatGPT. */
import type { AgentRunRequest, AiReport, OverallHealth } from '@/shared/obd-core';
import type { Dtc } from '@/shared/obd-core/obd/dtc';
import type { TrailRow } from '@/shared/state/historyStore';
import { findVins } from './scrub';

/** Longest package handed to the share sheet; a longer one is cut and ends with `… (cut to fit)`. */
export const SHARE_PACKAGE_MAX_CHARS = 20_000;
/** What every VIN in the package becomes while **Include VIN** is off. */
export const VIN_HIDDEN = '[VIN hidden]';

const CUT_NOTE = '… (cut to fit)';

const HEADER =
  'I used the Bolid Tester app to read my car over OBD2. Below is everything it read and what its ' +
  'assistant concluded. Please explain the most likely causes, how sure we can be, and what I ' +
  'should check next. You cannot ask the app for new readings; tell me what to check and I will ' +
  'report back.';

const OVERALL_TEXT: Record<OverallHealth, string> = {
  ok: 'no problems found',
  attention: 'needs attention',
  urgent: 'urgent',
};

export interface AgentShareInput {
  vehicleLabel: string;
  vin: string | null;
  generatedAt: number;
  report: AiReport;
  dtcs: { stored: Dtc[]; pending: Dtc[]; permanent: Dtc[] };
  trail: readonly TrailRow[];
  request: AgentRunRequest | null;
}

function complaint(request: AgentRunRequest | null): string | null {
  if (!request) return null;
  const parts: string[] = [];
  const symptom = request.mode === 'symptom' ? request.symptom?.trim() : undefined;
  if (symptom) parts.push(symptom);
  if (request.focusCode) parts.push(`explain fault code ${request.focusCode}`);
  return parts.length > 0 ? parts.join(' — ') : 'Check everything';
}

function codeList(label: string, codes: readonly Dtc[]): string {
  if (codes.length === 0) return `  ${label}: none`;
  return [
    `  ${label}:`,
    ...codes.map((d) => (d.description ? `    ${d.code} — ${d.description}` : `    ${d.code}`)),
  ].join('\n');
}

function reportLines(report: AiReport): string[] {
  const source = report.source === 'ai' ? 'AI assistant' : 'on-device rules';
  const lines = [
    `  Overall: ${OVERALL_TEXT[report.overall]} (${source})`,
    `  Summary: ${report.summary}`,
  ];
  if (report.findings.length === 0) lines.push('  Findings: none');
  report.findings.forEach((f, i) => {
    lines.push(
      `  ${i + 1}. ${f.title} [${f.severity}]${f.unconfirmed ? ' (unconfirmed data)' : ''}`,
    );
    if (f.detail) lines.push(`     ${f.detail}`);
    if (f.codes && f.codes.length > 0) lines.push(`     Codes: ${f.codes.join(', ')}`);
    if (f.likelyCauses && f.likelyCauses.length > 0) {
      lines.push(`     Likely causes: ${f.likelyCauses.join('; ')}`);
    }
    if (f.steps && f.steps.length > 0) lines.push(`     (based on steps ${f.steps.join(', ')})`);
  });
  return lines;
}

function stepLines(step: TrailRow): string[] {
  const name = step.kind === 'triage' ? 'Triage' : (step.tool ?? step.kind);
  const lines = [`Step ${step.id} — ${name} — ${step.why}`];
  const notes: string[] = [];
  if (step.status !== 'ok') notes.push(`result: ${step.status}`);
  if (step.unconfirmed) notes.push('unconfirmed data');
  if (notes.length > 0) lines.push(`  (${notes.join(', ')})`);
  for (const l of step.digest.split('\n')) lines.push(`  ${l}`);
  return lines;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Every occurrence of the car's VIN (any case, even inside a longer word) and every other
 *  VIN-looking word (`findVins`) → `VIN_HIDDEN`. */
function hideVins(text: string, vin: string | null): string {
  let out = text;
  const known = vin?.trim();
  if (known) out = out.replace(new RegExp(escapeRe(known), 'gi'), VIN_HIDDEN);
  for (const v of findVins(out)) out = out.replace(new RegExp(escapeRe(v), 'g'), VIN_HIDDEN);
  return out;
}

/** The package text (see the file comment). With `includeVin: false` (the default in the preview)
 *  the `VIN:` line is left out and every VIN in the whole text — the car's, wherever a step's data
 *  printed it, and any other VIN-looking word — becomes `[VIN hidden]`. VINs are hidden before the
 *  text is clamped to `SHARE_PACKAGE_MAX_CHARS`, so the cut never leaves part of one behind. */
export function buildAgentSharePackage(
  input: AgentShareInput,
  opts: { includeVin: boolean },
): string {
  const vehicle = [`Vehicle: ${input.vehicleLabel || 'unknown'}`];
  if (opts.includeVin && input.vin) vehicle.push(`VIN: ${input.vin}`);
  vehicle.push(
    `Read on: ${new Date(input.generatedAt).toISOString().slice(0, 16).replace('T', ' ')} UTC`,
  );

  const sections: string[] = [HEADER, vehicle.join('\n')];
  const asked = complaint(input.request);
  if (asked) sections.push(`Complaint: ${asked}`);
  sections.push(
    [
      'Fault codes:',
      codeList('Stored', input.dtcs.stored),
      codeList('Pending', input.dtcs.pending),
      codeList('Permanent', input.dtcs.permanent),
    ].join('\n'),
  );
  sections.push(['Assistant report:', ...reportLines(input.report)].join('\n'));
  sections.push(
    input.trail.length > 0
      ? ['Checks made:', ...input.trail.flatMap(stepLines)].join('\n')
      : 'Checks made: none recorded',
  );
  sections.push(input.report.disclaimer);

  const full = sections.join('\n\n');
  const text = opts.includeVin ? full : hideVins(full, input.vin);
  if (text.length <= SHARE_PACKAGE_MAX_CHARS) return text;
  return `${text.slice(0, SHARE_PACKAGE_MAX_CHARS - CUT_NOTE.length - 1)}\n${CUT_NOTE}`;
}
