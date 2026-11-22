/** The adapter-health feature's contribution to the AI diagnostic agent (plan 34b): the
 *  `check_adapter` tool (`runHealthCheck` over the read-only facade — firmware `ATI`, voltage
 *  `ATRV`, protocol `ATDPN`, then a timed burst of 5 `0100` requests, graded by `gradeAdapter`),
 *  the `adapter_health` procedure and the `adapter_health` capability skill. It rules the adapter
 *  in or out as the cause of dropouts; it says nothing about the car. Composed by the app layer
 *  (`src/app/ai-diagnose.tsx`). See docs/features/adapter-health.md. */

import { clampDigest, parseSkillFileOrThrow } from '@/shared/obd-core';
import type {
  AgentContribution,
  AgentTool,
  DiagSeverity,
  SkillProcedure,
  ToolContext,
  ToolResult,
} from '@/shared/obd-core';
import type { AdapterGrade } from '../api/gradeAdapter';
import { runHealthCheck } from '../api/runHealthCheck';
import adapterHealthSkill from './adapter_health.skill.json';

/** Timed `0100` requests one agent check makes (the screen makes 10). */
export const AGENT_BURST = 5;

/** How serious each grade is for the report. */
const SEVERITY: Record<AdapterGrade, DiagSeverity> = { good: 'ok', ok: 'info', poor: 'warn' };

async function checkAdapter(_args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const { session } = ctx;
  const report = await runHealthCheck(
    {
      version: () => session.adapterVersion(),
      voltage: () => session.voltage(),
      protocolNumber: () => session.protocolNumber(),
      command: (cmd) => session.request(cmd),
    },
    { burst: AGENT_BURST, now: () => ctx.now(), shouldStop: () => ctx.signal.aborted },
  );
  const { grade, latency, cloneSuspected } = report.result;
  const timeouts = report.attempts - report.latenciesMs.length;
  const latencyText = latency
    ? `median ${Math.round(latency.median)} ms, slowest ${Math.round(latency.max)} ms`
    : 'no answers';
  const lines = [
    `Grade: ${grade}${cloneSuspected ? ' (clone firmware suspected)' : ''}`,
    `Firmware: ${report.version || 'none reported'}`,
    `Voltage: ${report.voltage == null ? 'unreadable' : `${report.voltage.toFixed(1)} V`}`,
    `Protocol: ${report.protocol}`,
    `Latency: ${latencyText}`,
    `Timeouts: ${timeouts}/${report.attempts}`,
  ];
  return {
    digest: clampDigest(lines.join('\n')),
    summary: `Adapter: ${grade}, ${latency ? `median ${Math.round(latency.median)} ms` : 'no answers'}`,
    findings: [{ key: `adapterHealth:agent.finding.${grade}`, severity: SEVERITY[grade] }],
  };
}

const checkAdapterTool: AgentTool = {
  name: 'check_adapter',
  description:
    'Check the OBD adapter itself: firmware, supply voltage (V), protocol and the latency (ms) ' +
    'of 5 timed requests, graded good / ok / poor. Rules the adapter in or out as the problem.',
  labelKey: 'adapterHealth:agent.tool.check_adapter',
  args: { type: 'object', properties: {} },
  costMs: 5000,
  available: () => true,
  run: checkAdapter,
};

const adapterHealthProcedure: SkillProcedure = {
  id: 'adapter_health',
  costMs: checkAdapterTool.costMs,
  run: (ctx) => ctx.callTool('check_adapter', {}),
};

export const agentTools: AgentContribution = {
  tools: [checkAdapterTool],
  procedures: [adapterHealthProcedure],
  skills: [parseSkillFileOrThrow(adapterHealthSkill, 'adapter_health')],
};
