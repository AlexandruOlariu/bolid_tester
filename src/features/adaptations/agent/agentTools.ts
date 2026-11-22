/** The adaptations feature's contribution to the AI diagnostic agent (plan 34b): the
 *  `read_adaptations` tool (the profile's adaptation channels reachable on this link, each read once
 *  through `readChannelReadOnly` on the read-only facade and decoded with the channel's scaling) and
 *  the `adaptations_read` capability skill. Read only: no session change, no login, no write — the
 *  owner changes a value on the Adaptations screen. A value from a channel not yet confirmed on the
 *  car is labelled `unconfirmed`. Composed by the app layer (`src/app/ai-diagnose.tsx`). See
 *  docs/features/adaptations.md. */

import {
  ModuleNotAllowedError,
  bytesToHexString,
  clampDigest,
  decodeAdaptationRaw,
  isCan,
  isKLine,
  oneDecimal,
  parseSkillFileOrThrow,
} from '@/shared/obd-core';
import type {
  AgentContribution,
  AgentTool,
  ProtocolId,
  ToolContext,
  ToolResult,
} from '@/shared/obd-core';
import { verificationState } from '@/shared/vehicles';
import type { AdaptationChannel, VehicleProfile } from '@/shared/vehicles';
import { isKwpChannel, readChannelReadOnly } from '../api/adaptationService';
import adaptationsReadSkill from './adaptations_read.skill.json';

/** Most channels one call reads. */
export const MAX_ADAPTATION_CHANNELS = 10;
/** Adapter time one channel read may take (addressing + one read, K-line included). */
const CHANNEL_COST_MS = 1000;

/** The profile's channels reachable on `protocol`: UDS channels on CAN, KWP channels on K-line
 *  (the Adaptations screen's own rule). */
export function reachableChannels(
  profile: VehicleProfile,
  protocol: ProtocolId,
): AdaptationChannel[] {
  return (profile.adaptations ?? []).filter((ch) =>
    isKwpChannel(ch) ? isKLine(protocol) : isCan(protocol),
  );
}

type ChannelRow = { line: string; answered: boolean; unverified: boolean };

async function readOne(ctx: ToolContext, ch: AdaptationChannel): Promise<ChannelRow> {
  const head = `${ch.name} (${ch.module})`;
  const unverified = verificationState(ch) === 'unverified';
  let raw: number[] | null;
  try {
    raw = await readChannelReadOnly(ctx.session, ch);
  } catch (e) {
    if (e instanceof ModuleNotAllowedError) {
      return { line: `${head}: skipped (outside the agent's scope)`, answered: false, unverified };
    }
    throw e;
  }
  if (!raw || raw.length === 0) {
    const why = isKwpChannel(ch)
      ? 'not readable without the adaptation session; open Adaptations'
      : 'no answer';
    return { line: `${head}: ${why}`, answered: false, unverified };
  }
  const unit = ch.unit ? ` ${ch.unit}` : '';
  const value = oneDecimal(decodeAdaptationRaw(raw, ch));
  const tag = unverified ? ' (unconfirmed)' : '';
  return {
    line: `${head}: ${value}${unit} raw ${bytesToHexString(raw)}${tag}`,
    answered: true,
    unverified,
  };
}

async function readAdaptations(
  _args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const reachable = reachableChannels(ctx.profile, ctx.session.currentProtocol);
  if (reachable.length === 0) {
    return {
      digest: 'No adaptation channels are declared for this car on this link.',
      summary: 'Adaptations: none on this link',
    };
  }
  const chosen = reachable.slice(0, MAX_ADAPTATION_CHANNELS);
  const rows: ChannelRow[] = [];
  for (const ch of chosen) {
    if (ctx.signal.aborted) break;
    rows.push(await readOne(ctx, ch));
  }
  const answered = rows.filter((r) => r.answered);
  const notRead = reachable.length - rows.length;
  const lines = [
    `Adaptation channels read: ${rows.length}, answered: ${answered.length}.`,
    ...rows.map((r) => r.line),
    ...(notRead > 0 ? [`Channels not read: ${notRead}.`] : []),
  ];
  return {
    digest: clampDigest(lines.join('\n'), undefined, { countMore: true }),
    summary: `Adaptations: ${answered.length}/${rows.length} channels answered`,
    // Any unverified value marks the step, so a model finding built on it is capped at info.
    ...(answered.some((r) => r.unverified) ? { unconfirmed: true } : {}),
  };
}

const readAdaptationsTool: AgentTool = {
  name: 'read_adaptations',
  description:
    "Read the car's adaptation channels once (up to 10): each value decoded with its unit and the " +
    'raw bytes. Read only; it never changes a value.',
  labelKey: 'adaptations:agent.tool.read_adaptations',
  args: { type: 'object', properties: {} },
  costMs: CHANNEL_COST_MS * MAX_ADAPTATION_CHANNELS,
  available: (ctx) => reachableChannels(ctx.profile, ctx.protocol).length > 0,
  run: readAdaptations,
};

export const agentTools: AgentContribution = {
  tools: [readAdaptationsTool],
  skills: [parseSkillFileOrThrow(adaptationsReadSkill, 'adaptations_read')],
};
