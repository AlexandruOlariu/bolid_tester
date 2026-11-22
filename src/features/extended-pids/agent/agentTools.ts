/** The extended-PIDs feature's contribution to the AI diagnostic agent (plan 34b): the
 *  `read_extended` tool (the profile's manufacturer Mode 22 DIDs, read once through the read-only
 *  facade's `pollExtendedOnce` on the engine's default addressing and decoded with each DID's
 *  profile decoder) and the `extended_data` capability skill. Only DIDs the profile declares are
 *  ever sent; a value from a DID not yet confirmed on the car is labelled `unconfirmed`. Composed
 *  by the app layer (`src/app/ai-diagnose.tsx`). See docs/features/extended-pids.md. */

import { clampDigest, isCan, oneDecimal, parseSkillFileOrThrow } from '@/shared/obd-core';
import type { AgentContribution, AgentTool, ToolContext, ToolResult } from '@/shared/obd-core';
import { verificationState } from '@/shared/vehicles';
import type { ExtendedPid } from '@/shared/vehicles';
import extendedDataSkill from './extended_data.skill.json';

/** Most DIDs one call reads (and the default: the first this many the profile declares). */
const MAX_DIDS = 8;
/** Adapter time one Mode 22 read may take. */
const DID_COST_MS = 500;

/** One DID's digest line: `"<did> <name>: <value> <unit>"`, ` (unconfirmed)` when unverified. */
function didLine(pid: ExtendedPid, raw: number[] | null): { line: string; value: number | null } {
  const decoded = raw && raw.length > 0 ? pid.decode(raw) : null;
  const value = decoded != null && Number.isFinite(decoded) ? decoded : null;
  if (value == null) return { line: `${pid.did} ${pid.name}: no answer`, value };
  const unit = pid.unit ? ` ${pid.unit}` : '';
  const tag = verificationState(pid) === 'unverified' ? ' (unconfirmed)' : '';
  return { line: `${pid.did} ${pid.name}: ${oneDecimal(value)}${unit}${tag}`, value };
}

async function readExtended(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const declared = ctx.profile.extendedPids ?? [];
  if (declared.length === 0) {
    return {
      digest: 'No extended (Mode 22) DIDs are declared for this car.',
      summary: 'Extended data: none declared',
    };
  }

  const requested = Array.isArray(args.dids)
    ? [...new Set(args.dids.map((d) => String(d).toUpperCase()))].slice(0, MAX_DIDS)
    : null;
  const chosen =
    requested === null
      ? declared.slice(0, MAX_DIDS)
      : requested
          .map((did) => declared.find((p) => p.did.toUpperCase() === did))
          .filter((p): p is ExtendedPid => p !== undefined);
  const undeclared = (requested ?? []).filter(
    (did) => !declared.some((p) => p.did.toUpperCase() === did),
  );

  const raw = chosen.length > 0 ? await ctx.session.pollExtendedOnce(chosen.map((p) => p.did)) : {};
  const rows = chosen.map((p) => ({ pid: p, ...didLine(p, raw[p.did] ?? null) }));
  const answered = rows.filter((r) => r.value != null);
  const lines = [
    `Extended data: ${rows.length} DIDs read, ${answered.length} answered.`,
    ...rows.map((r) => r.line),
    ...undeclared.map((did) => `${did}: not declared for this car (not read)`),
  ];
  return {
    digest: clampDigest(lines.join('\n'), undefined, { countMore: true }),
    summary: `Extended data: ${answered.length}/${rows.length} DIDs answered`,
    ...(answered.length > 0 && answered.every((r) => verificationState(r.pid) === 'unverified')
      ? { unconfirmed: true }
      : {}),
  };
}

const readExtendedTool: AgentTool = {
  name: 'read_extended',
  description:
    "Read the car's manufacturer-specific Mode 22 values (DPF, oil temperature, EGR, ...) once. " +
    'Absent dids: the first 8 the car profile declares.',
  labelKey: 'extendedPids:agent.tool.read_extended',
  args: {
    type: 'object',
    properties: {
      dids: {
        type: 'array',
        items: { type: 'string', pattern: '^[0-9A-F]{4}$' },
        maxItems: MAX_DIDS,
        description: 'Declared DIDs, e.g. ["1702","1707"]. Absent: the first 8 declared.',
      },
    },
  },
  costMs: DID_COST_MS * MAX_DIDS,
  available: (ctx) => (ctx.profile.extendedPids?.length ?? 0) > 0 && isCan(ctx.protocol),
  run: readExtended,
};

export const agentTools: AgentContribution = {
  tools: [readExtendedTool],
  skills: [parseSkillFileOrThrow(extendedDataSkill, 'extended_data')],
};
