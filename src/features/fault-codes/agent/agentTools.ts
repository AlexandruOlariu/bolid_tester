/** The fault-codes feature's contribution to the AI diagnostic agent (plans 34a / 34b): the
 *  `read_dtcs_detail` tool (one code's description, status now, freeze frame and this car's guide
 *  note, as the Faults detail sheet shows it), the `lookup_guide` tool (this car's curated fault
 *  guide by code or by topic, with its related DIDs and routine; no adapter traffic) and the
 *  `fault_codes` capability skill. Composed by the app layer (`src/app/ai-diagnose.tsx`). See
 *  docs/features/fault-codes.md. */

import { clampDigest, oneDecimal, parseSkillFileOrThrow, readProfileDtcs } from '@/shared/obd-core';
import type { AgentContribution, AgentTool, ToolContext, ToolResult } from '@/shared/obd-core';
import type { Dtc } from '@/shared/obd-core/obd/dtc';
import type { FreezeFrame } from '@/shared/obd-core/session/DiagnosticSession';
import {
  GENERIC_GUIDE,
  findFaultGuides,
  matchFaultGuide,
  type FaultGuide,
} from '@/shared/vehicles/faultGuides';
import type { VehicleProfile } from '@/shared/vehicles/types';
import { buildDtcDetail } from '../model/dtcDetail';
import faultCodesSkill from './fault_codes.skill.json';

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

/** The guide's related DIDs and routine as digest lines, named from the car's profile. */
function guideDataLines(guide: FaultGuide, profile: VehicleProfile): string[] {
  const lines: string[] = [];
  if (guide.relatedDids?.length) {
    const dids = guide.relatedDids.map((did) => {
      const name = profile.extendedPids?.find((p) => p.did === did)?.name;
      return name ? `${did} ${name}` : did;
    });
    lines.push(`Related DIDs: ${dids.join(', ')}.`);
  }
  if (guide.routineId) {
    const name = profile.routines?.find((r) => r.id === guide.routineId)?.name;
    lines.push(
      `Routine: ${guide.routineId}${name ? ` ${name}` : ''} (the user runs it from the Routines ` +
        'screen; the agent never runs routines).',
    );
  }
  return lines;
}

async function lookupGuide(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const code = typeof args.code === 'string' ? args.code.trim().toUpperCase() : '';
  const topic = typeof args.topic === 'string' ? args.topic.trim() : '';

  if (code) {
    const vagCode = buildDtcDetail(code, undefined, ctx.profile.make).vagCode;
    const guide = matchFaultGuide(ctx.guideProfileId, code, vagCode || null);
    if (guide === GENERIC_GUIDE) {
      return {
        digest: `No curated guide for ${code} on this car.`,
        summary: `Guide for ${code}: none`,
      };
    }
    const lines = [
      `Guide for ${code} on this car: ${guide.note}`,
      ...guideDataLines(guide, ctx.profile),
    ];
    return { digest: clampDigest(lines.join('\n')), summary: `Guide for ${code}: found` };
  }

  if (topic) {
    const found = findFaultGuides(ctx.guideProfileId, topic);
    if (!found.length) {
      return {
        digest: `No curated guide for ${topic} on this car.`,
        summary: `Guides for "${topic}": none`,
      };
    }
    const lines = [`Guides for "${topic}" on this car: ${found.length}`];
    for (const { codes, prefix, guide } of found) {
      const covers = [codes.join(', '), prefix ? `family ${prefix}` : '']
        .filter(Boolean)
        .join('; ');
      lines.push(`Codes ${covers}: ${guide.note}`, ...guideDataLines(guide, ctx.profile));
    }
    return {
      digest: clampDigest(lines.join('\n')),
      summary: `Guides for "${topic}": ${found.length}`,
    };
  }

  return { digest: 'Give a code or a topic.', summary: 'Guide lookup: no code or topic' };
}

const lookupGuideTool: AgentTool = {
  name: 'lookup_guide',
  description:
    'This car\'s curated fault guide, by code or by topic (e.g. "egr", "dpf", "glow"): what ' +
    'to check, the related extended DIDs to read and the guided routine for it. No adapter traffic.',
  labelKey: 'faultCodes:agent.tool.lookup_guide',
  args: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        pattern: '^[PCBU][0-3][0-9A-F]{3}$',
        description: 'A fault code, e.g. "P0401". Used first when both are given.',
      },
      topic: {
        type: 'string',
        description: 'Words to search the guides for, e.g. "egr" or "intake flap".',
      },
    },
  },
  costMs: 0,
  available: () => true,
  run: lookupGuide,
};

export const agentTools: AgentContribution = {
  tools: [readDtcsDetailTool, lookupGuideTool],
  skills: [parseSkillFileOrThrow(faultCodesSkill, 'fault_codes')],
};
