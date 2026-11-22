/** The coding feature's contribution to the AI diagnostic agent (plan 34b): the `read_coding` tool
 *  (each codeable module's coding read once through `readCodingReadOnly` on the read-only facade,
 *  decoded with the module schema merged with any label-pack bit names) and the `coding_read`
 *  capability skill. Read only: no session change, no SecurityAccess, no write — the owner changes
 *  a coding on the Coding screen. Fields of a module whose bit positions are not yet confirmed on
 *  the car are labelled `unconfirmed`. Composed by the app layer (`src/app/ai-diagnose.tsx`). See
 *  docs/features/coding.md. */

import {
  ModuleNotAllowedError,
  clampDigest,
  isCan,
  parseSkillFileOrThrow,
} from '@/shared/obd-core';
import type { AgentContribution, AgentTool, ToolContext, ToolResult } from '@/shared/obd-core';
import { findLabelPack } from '@/shared/labels';
import { verificationState } from '@/shared/vehicles';
import type { CodingModule } from '@/shared/vehicles';
import { readCodingReadOnly } from '../api/codingRead';
import codingReadSkill from './coding_read.skill.json';

/** Most modules one call reads. */
export const MAX_CODING_MODULES = 4;
/** Most decoded fields one module's digest lists. */
export const MAX_CODING_FIELDS = 12;
/** Adapter time one module's coding read may take. */
const MODULE_COST_MS = 1000;

type ModuleRows = { lines: string[]; answered: boolean; unverified: boolean };

async function readOne(ctx: ToolContext, m: CodingModule): Promise<ModuleRows> {
  const unverified = verificationState(m) === 'unverified';
  let out: Awaited<ReturnType<typeof readCodingReadOnly>>;
  try {
    out = await readCodingReadOnly(ctx.session, m, findLabelPack);
  } catch (e) {
    if (e instanceof ModuleNotAllowedError) {
      return {
        lines: [`${m.module}: skipped (outside the agent's scope)`],
        answered: false,
        unverified,
      };
    }
    throw e;
  }
  if (!out) return { lines: [`${m.module}: no answer`], answered: false, unverified };
  const tag = unverified ? ' (unconfirmed)' : '';
  const shown = out.fields.slice(0, MAX_CODING_FIELDS);
  const hidden = out.fields.length - shown.length;
  return {
    lines: [
      `${m.module}: coding ${out.hex}`,
      ...shown.map((f) => `- ${f.name}: ${f.value}${tag}`),
      ...(hidden > 0 ? [`- … (${hidden} more fields)`] : []),
    ],
    answered: true,
    unverified,
  };
}

async function readCoding(_args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const modules = ctx.profile.codingModules ?? [];
  if (modules.length === 0 || !isCan(ctx.session.currentProtocol)) {
    return {
      digest: 'No codeable modules are declared for this car on this link.',
      summary: 'Coding: none on this link',
    };
  }
  const rows: ModuleRows[] = [];
  for (const m of modules.slice(0, MAX_CODING_MODULES)) {
    if (ctx.signal.aborted) break;
    rows.push(await readOne(ctx, m));
  }
  const answered = rows.filter((r) => r.answered);
  const lines = [
    `Coding modules read: ${rows.length}, answered: ${answered.length}.`,
    ...rows.flatMap((r) => r.lines),
    ...(modules.length > rows.length ? [`Modules not read: ${modules.length - rows.length}.`] : []),
  ];
  return {
    digest: clampDigest(lines.join('\n'), undefined, { countMore: true }),
    summary: `Coding: ${answered.length}/${rows.length} modules answered`,
    // Any unverified decoding marks the step, so a model finding built on it is capped at info.
    ...(answered.some((r) => r.unverified) ? { unconfirmed: true } : {}),
  };
}

const readCodingTool: AgentTool = {
  name: 'read_coding',
  description:
    "Read each codeable module's long coding once (up to 4): the coding hex and up to 12 decoded " +
    'fields (a bit reads on/off). Read only; it never changes a coding.',
  labelKey: 'coding:agent.tool.read_coding',
  args: { type: 'object', properties: {} },
  costMs: MODULE_COST_MS * MAX_CODING_MODULES,
  available: (ctx) => (ctx.profile.codingModules?.length ?? 0) > 0 && isCan(ctx.protocol),
  run: readCoding,
};

export const agentTools: AgentContribution = {
  tools: [readCodingTool],
  skills: [parseSkillFileOrThrow(codingReadSkill, 'coding_read')],
};
