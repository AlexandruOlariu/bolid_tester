/** The alerts feature's contribution to the AI diagnostic agent (plan 34b): the `read_alerts` tool
 *  (every threshold rule with its PID, operator, threshold and on / off state, then the alerts active
 *  right now) and the `alerts_history` capability skill. The alerts store keeps the rules and the
 *  active set only: fired alerts are never stored, and the digest says so. Rules are the app's, not
 *  a car's. No adapter time. Composed by the app layer (`src/app/ai-diagnose.tsx`). See
 *  docs/features/alerts.md. */

import {
  MAX_DIGEST_CHARS,
  PID_REGISTRY,
  clampDigest,
  parseSkillFileOrThrow,
} from '@/shared/obd-core';
import type {
  ActiveAlert,
  AgentContribution,
  AgentTool,
  AlertOp,
  AlertRule,
  ToolContext,
  ToolResult,
} from '@/shared/obd-core';
import { useAlertsStore } from '../model/alertsStore';
import alertsHistorySkill from './alerts_history.skill.json';

export const FIRED_NOT_STORED =
  'Fired alerts are not stored; only the ones active right now are known.';

const OP_TEXT: Record<AlertOp, string> = { gt: '>', lt: '<', outside: 'outside', inside: 'inside' };

const unitOf = (pid: string): string => {
  const unit = PID_REGISTRY[pid]?.unit;
  return unit ? ` ${unit}` : '';
};

/** The rule's name as written (English for the starter rules), else its PID. Model-facing, so never
 *  the translated on-screen label. */
const labelOf = (rule: Pick<AlertRule, 'pid' | 'label'>): string => rule.label ?? rule.pid;

/** `"Coolant overheating: 0105 > 110 °C (on)"`, a band as `"010B outside 90..250 kPa"`. */
function ruleLine(rule: AlertRule): string {
  const threshold =
    (rule.op === 'outside' || rule.op === 'inside') && rule.value2 != null
      ? `${rule.value}..${rule.value2}`
      : `${rule.value}`;
  const state = rule.enabled === false ? 'off' : 'on';
  return `${labelOf(rule)}: ${rule.pid} ${OP_TEXT[rule.op] ?? rule.op} ${threshold}${unitOf(rule.pid)} (${state})`;
}

/** `"2 min"` / `"45 s"` / `"3 h"`. */
function durationText(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const min = Math.round(s / 60);
  return min < 60 ? `${min} min` : `${Math.round(min / 60)} h`;
}

/** `"Coolant overheating: 0105 = 112 °C, critical, for 2 min"`. */
function activeLine(a: ActiveAlert, now: number): string {
  return (
    `${labelOf(a.rule)}: ${a.pid} = ${a.value}${unitOf(a.pid)}, ${a.severity}, ` +
    `for ${durationText(now - a.since)}`
  );
}

async function readAlerts(_args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const { rules, active } = useAlertsStore.getState();
  const now = ctx.now();
  const lines: string[] = rules.length
    ? [`Rules (${rules.length}):`, ...rules.map(ruleLine)]
    : ['No alert rules set.'];
  if (active.length)
    lines.push(`Active now (${active.length}):`, ...active.map((a) => activeLine(a, now)));
  else lines.push('Active now: none.');
  // The closing line must survive a clamp: clamp the rest into the room left for it.
  const room = MAX_DIGEST_CHARS - FIRED_NOT_STORED.length - 1;
  const body = clampDigest(lines.join('\n'), room, { countMore: true });
  return {
    digest: `${body}\n${FIRED_NOT_STORED}`,
    summary: `Alerts: ${rules.length} rules, ${active.length} active`,
  };
}

const readAlertsTool: AgentTool = {
  name: 'read_alerts',
  description:
    "The app's threshold alert rules (label, PID, operator, threshold, on / off) and the alerts " +
    'active right now. Fired alerts are not stored, so there is no alert history.',
  labelKey: 'alerts:agent.tool.read_alerts',
  args: { type: 'object', properties: {} },
  costMs: 0,
  available: () => true,
  run: readAlerts,
};

export const agentTools: AgentContribution = {
  tools: [readAlertsTool],
  skills: [parseSkillFileOrThrow(alertsHistorySkill, 'alerts_history')],
};
