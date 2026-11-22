/** The DPF feature's contribution to the AI diagnostic agent (plan 34b): the `read_dpf` tool (soot
 *  load and mass, ash, distance and count since the last regeneration, exhaust temperature and the
 *  `assessDpf` status, read through `readDpf` on the read-only facade), the `dpf` procedure and the
 *  `dpf` capability skill. Every value from a DID not yet confirmed on the car is labelled
 *  `unconfirmed`, and so is the status finding when any value it used is (34a caps it at info).
 *  Composed by the app layer (`src/app/ai-diagnose.tsx`). See docs/features/dpf.md. */

import { clampDigest, oneDecimal, parseSkillFileOrThrow } from '@/shared/obd-core';
import type {
  AgentContribution,
  AgentTool,
  DiagSeverity,
  DpfStatus,
  SkillFinding,
  SkillProcedure,
  ToolContext,
  ToolResult,
} from '@/shared/obd-core';
import { verificationState } from '@/shared/vehicles';
import type { ExtendedPid } from '@/shared/vehicles';
import type { DpfValue } from '../model/dpfStore';
import { dpfAvailable, dpfPids, isDpfInputRole, readDpf } from '../api/dpfRead';
import dpfSkill from './dpf.skill.json';

/** How serious each status is for the report. */
const SEVERITY: Record<DpfStatus, DiagSeverity> = {
  ok: 'ok',
  filling: 'info',
  regenerating: 'info',
  'regen-due': 'warn',
  high: 'warn',
  unknown: 'info',
};

/** The digest label of each `assessDpf` input role, in digest order. */
const ROLE_LABELS: [NonNullable<ExtendedPid['role']>, string][] = [
  ['sootPct', 'Soot load'],
  ['sootMassG', 'Soot mass'],
  ['ashMassG', 'Ash'],
  ['kmSinceRegen', 'Distance since regen'],
  ['regenCount', 'Regenerations'],
  ['egtC', 'EGT'],
];

const UNCONFIRMED = ' (unconfirmed)';

const valueText = (v: DpfValue): string =>
  v.value == null ? 'no answer' : `${oneDecimal(v.value)}${v.unit ? ` ${v.unit}` : ''}`;

async function runReadDpf(_args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const out = await readDpf(ctx.session, ctx.profile);
  if (!out) {
    const line = 'No DPF data for this car: it needs a diesel with DPF DIDs on a CAN link.';
    return { digest: line, summary: 'DPF: not available' };
  }
  const { values, report } = out;
  const pidOf = new Map(dpfPids(ctx.profile).map((p) => [p.did, p]));
  const unverified = (v: DpfValue): boolean => {
    const pid = pidOf.get(v.did);
    return !pid || verificationState(pid) === 'unverified';
  };
  const tag = (v: DpfValue): string => (v.value != null && unverified(v) ? UNCONFIRMED : '');

  const head =
    report.sootPct != null
      ? `DPF status: ${report.status} (soot ${oneDecimal(report.sootPct)} %)`
      : `DPF status: ${report.status}`;
  const lines = [head];
  for (const [role, label] of ROLE_LABELS) {
    const v = values.find((x) => x.role === role);
    if (v) lines.push(`${label}: ${valueText(v)}${tag(v)}`);
  }
  for (const v of values.filter((x) => !isDpfInputRole(x.role))) {
    lines.push(`${v.did} ${v.name}: ${valueText(v)}${tag(v)}`);
  }
  lines.push(`Advice: ${report.advice}`);

  const read = values.filter((v) => v.value != null);
  // The values the assessment used: every answered input role (the diesel extras do not feed it).
  const used = read.filter((v) => isDpfInputRole(v.role));
  const finding: SkillFinding = {
    key: `dpf:agent.finding.${report.status}`,
    severity: SEVERITY[report.status],
    ...(report.sootPct != null ? { values: { pct: report.sootPct } } : {}),
    unconfirmed: used.some(unverified),
  };
  return {
    digest: clampDigest(lines.join('\n')),
    summary:
      report.sootPct != null
        ? `DPF: ${report.status}, soot ${oneDecimal(report.sootPct)} %`
        : `DPF: ${report.status}`,
    findings: [finding],
    ...(read.length > 0 && read.every(unverified) ? { unconfirmed: true } : {}),
  };
}

const readDpfTool: AgentTool = {
  name: 'read_dpf',
  description:
    'Read the diesel particulate filter: soot load (%) and mass (g), ash (g), km since the last ' +
    'regeneration, regeneration count, exhaust temperature (°C) and the assessed status.',
  labelKey: 'dpf:agent.tool.read_dpf',
  args: { type: 'object', properties: {} },
  costMs: 4000,
  available: (ctx) => dpfAvailable(ctx.profile, ctx.protocol),
  run: runReadDpf,
};

const dpfProcedure: SkillProcedure = {
  id: 'dpf',
  costMs: readDpfTool.costMs,
  run: (ctx) => ctx.callTool('read_dpf', {}),
};

export const agentTools: AgentContribution = {
  tools: [readDpfTool],
  procedures: [dpfProcedure],
  skills: [parseSkillFileOrThrow(dpfSkill, 'dpf')],
};
