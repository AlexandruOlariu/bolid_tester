/** The used-car inspection's contribution to the AI diagnostic agent (plan 34b): the
 *  `read_inspection` tool (the standard-OBD2 snapshot through `runInspection` on the read-only
 *  facade: MIL, stored / pending / permanent codes, readiness and the recently-cleared heuristic,
 *  freeze frame, in-use counters, VIN), the `used_car_check` procedure and the `used_car_check`
 *  capability skill. Composed by the app layer (`src/app/ai-diagnose.tsx`). See
 *  docs/features/used-car-inspection.md. */

import { clampDigest, parseSkillFileOrThrow } from '@/shared/obd-core';
import type {
  AgentContribution,
  AgentTool,
  DiagSeverity,
  SkillProcedure,
  ToolContext,
  ToolResult,
  Verdict,
} from '@/shared/obd-core';
import { runInspection } from '../api/runInspection';
import usedCarCheckSkill from './used_car_check.skill.json';

/** How serious each verdict is for the report. */
const SEVERITY: Record<Verdict, DiagSeverity> = { pass: 'ok', caution: 'info', fail: 'warn' };

async function runReadInspection(
  _args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const report = await runInspection(ctx.session, ctx.vin);
  const lines = [
    `Verdict: ${report.verdict} (score ${report.score}/100)`,
    ...report.checks.map((c) => `${c.status}: ${c.label} — ${c.detail}`),
  ];
  return {
    digest: clampDigest(lines.join('\n'), undefined, { countMore: true }),
    summary: `Used-car check: ${report.verdict}, score ${report.score}/100`,
    findings: [
      {
        key: `inspection:agent.finding.${report.verdict}`,
        severity: SEVERITY[report.verdict],
        values: { score: report.score },
      },
    ],
  };
}

const readInspectionTool: AgentTool = {
  name: 'read_inspection',
  description:
    'Run the standard-OBD2 used-car check: MIL, stored / pending / permanent codes, readiness ' +
    '(with the recently-cleared heuristic), freeze frame, in-use counters and VIN, with a ' +
    'pass / caution / fail verdict and a 0-100 score.',
  labelKey: 'inspection:agent.tool.read_inspection',
  args: { type: 'object', properties: {} },
  costMs: 6000,
  available: () => true,
  run: runReadInspection,
};

const usedCarCheckProcedure: SkillProcedure = {
  id: 'used_car_check',
  costMs: readInspectionTool.costMs,
  run: (ctx) => ctx.callTool('read_inspection', {}),
};

export const agentTools: AgentContribution = {
  tools: [readInspectionTool],
  procedures: [usedCarCheckProcedure],
  skills: [parseSkillFileOrThrow(usedCarCheckSkill, 'used_car_check')],
};
