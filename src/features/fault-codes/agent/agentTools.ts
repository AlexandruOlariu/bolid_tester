/** The fault-codes feature's contribution to the AI diagnostic agent (plan 34a): the
 *  `read_dtcs_detail` tool (one code's description, status now, freeze frame and this car's guide
 *  note, as the Faults detail sheet shows it) and the `fault_codes` capability skill. Composed by
 *  the app layer (`src/app/ai-diagnose.tsx`). See docs/features/ai-diagnose.md. */

import { clampDigest, oneDecimal, parseSkillFile, readProfileDtcs } from '@/shared/obd-core';
import type { AgentContribution, AgentTool, ToolContext, ToolResult } from '@/shared/obd-core';
import type { Dtc } from '@/shared/obd-core/obd/dtc';
import type { FreezeFrame } from '@/shared/obd-core/session/DiagnosticSession';
import { GENERIC_GUIDE, matchFaultGuide } from '@/shared/vehicles/faultGuides';
import { buildDtcDetail } from '../model/dtcDetail';
import faultCodesSkill from './fault_codes.skill.json';

function skillOrThrow(raw: unknown) {
  const parsed = parseSkillFile(raw);
  if (!parsed.ok) throw new Error(`Invalid skill file fault_codes: ${parsed.error}`);
  return parsed.skill;
}

const yesNo = (read: boolean, has: boolean): string =>
  read ? (has ? 'yes' : 'no') : 'not read on this car';

function freezeFrameLine(code: string, frame: FreezeFrame): string {
  const values = frame.values.map(
    (v) => `${v.name} ${oneDecimal(v.value)}${v.unit ? ` ${v.unit}` : ''}`,
  );
  return `Freeze frame (when ${code} set): ${values.length ? values.join(', ') : 'no values'}.`;
}

async function readDtcsDetail(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const code = String(args.code ?? '').toUpperCase();
  const modes = ctx.profile.dtcModes;
  const dtcs = await readProfileDtcs(ctx.session, ctx.profile);
  const has = (list: Dtc[]) => list.some((d) => d.code === code);
  const stored = has(dtcs.stored);
  const pending = has(dtcs.pending);
  const permanent = has(dtcs.permanent);
  const reported = [...dtcs.stored, ...dtcs.pending, ...dtcs.permanent].find(
    (d) => d.code === code,
  );

  const detail = buildDtcDetail(code, reported?.description, ctx.profile.make);
  // Mode 02 frames belong to stored codes only, so a code that is not stored has none to read.
  const frame = stored
    ? (await ctx.session.readFreezeFrames()).find((f) => f.triggerDtc === code)
    : undefined;
  const guide = matchFaultGuide(ctx.guideProfileId, code, detail.vagCode || null);

  const head = detail.vagCode ? `${code} (VAG ${detail.vagCode})` : code;
  const lines = [
    `${head} — ${detail.description}`,
    `System: ${detail.systemLine}`,
    `Stored now: ${yesNo(modes.includes('03'), stored)}. Pending now: ${yesNo(modes.includes('07'), pending)}. ` +
      `Permanent now: ${yesNo(modes.includes('0A'), permanent)}.`,
  ];
  if (frame) lines.push(freezeFrameLine(code, frame));
  if (guide !== GENERIC_GUIDE) lines.push(`Guide for this car: ${guide.note}`);

  const status = [stored && 'stored', pending && 'pending', permanent && 'permanent'].filter(
    (s): s is string => typeof s === 'string',
  );
  return {
    digest: clampDigest(lines.join('\n')),
    summary:
      `${head}: ${status.length ? status.join(', ') : 'not reported now'}` +
      `${frame ? '; freeze frame' : ''}${guide !== GENERIC_GUIDE ? '; guide note' : ''}`,
  };
}

const readDtcsDetailTool: AgentTool = {
  name: 'read_dtcs_detail',
  description:
    'Details of one fault code: description, system, VAG number, whether it is stored / pending / ' +
    "permanent now, the freeze frame it triggered and this car's guide note.",
  labelKey: 'faultCodes:agent.tool.read_dtcs_detail',
  args: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        pattern: '^[PCBU][0-3][0-9A-F]{3}$',
        description: 'A fault code, e.g. "P0401".',
      },
    },
    required: ['code'],
  },
  costMs: 2000,
  available: () => true,
  run: readDtcsDetail,
};

export const agentTools: AgentContribution = {
  tools: [readDtcsDetailTool],
  skills: [skillOrThrow(faultCodesSkill)],
};
