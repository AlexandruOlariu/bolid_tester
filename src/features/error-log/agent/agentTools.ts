/** The error-log feature's contribution to the AI diagnostic agent (plan 34b): the
 *  `read_app_errors` tool (the app's own logged errors, newest first, each message through
 *  `scrubText` so no VIN, device id, address, URL or key reaches the model, then the count per source
 *  over the last 24 h) and the `app_errors` capability skill. App errors are the app's, not a car's.
 *  No adapter time. Composed by the app layer (`src/app/ai-diagnose.tsx`). See
 *  docs/features/error-log.md. */

import { MAX_DIGEST_CHARS, clampDigest, parseSkillFileOrThrow } from '@/shared/obd-core';
import type { AgentContribution, AgentTool, ToolContext, ToolResult } from '@/shared/obd-core';
import type { LoggedError } from '@/shared/lib/errorLog';
import { scrubText } from '@/shared/lib/scrub';
import { useErrorLogStore } from '@/shared/state/errorLogStore';
import appErrorsSkill from './app_errors.skill.json';

/** Errors listed when no limit is given (also the maximum). */
export const MAX_APP_ERRORS = 10;
/** Longest message the digest quotes. */
const MESSAGE_CHARS = 120;
const DAY_MS = 86_400_000;

const NO_ERRORS = 'No app errors logged.';

/** `"45 s"`, `"12 min"`, `"3 h"`, `"2 d"`. */
function ageText(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s} s`;
  const min = Math.floor(s / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h} h` : `${Math.floor(h / 24)} d`;
}

/** The first line of a message, scrubbed, then cut to `MESSAGE_CHARS` (scrubbing first, so a cut
 *  never leaves half an identifier the scrubber no longer recognises). */
function messageText(message: string): string {
  const line = scrubText(message.split(/\r?\n/)[0].trim());
  return line.length <= MESSAGE_CHARS ? line : `${line.slice(0, MESSAGE_CHARS - 1)}…`;
}

const errorLine = (e: LoggedError, now: number): string =>
  `${ageText(now - e.ts)} ago ${scrubText(e.source)} ${e.severity}: ${messageText(e.message)}`;

function limitOf(raw: unknown): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.floor(raw) : MAX_APP_ERRORS;
  return Math.min(MAX_APP_ERRORS, Math.max(1, n));
}

/** `"Last 24 h: ble 2, ai 1 (3 errors)"`, sources by count (ties in newest-first order). */
function last24hLine(errors: LoggedError[], now: number): { line: string; count: number } {
  const recent = errors.filter((e) => now - e.ts <= DAY_MS);
  if (recent.length === 0) return { line: 'Last 24 h: none', count: 0 };
  const bySource = new Map<string, number>();
  for (const e of recent) bySource.set(e.source, (bySource.get(e.source) ?? 0) + 1);
  const parts = [...bySource]
    .sort((a, b) => b[1] - a[1])
    .map(([source, n]) => `${scrubText(source)} ${n}`);
  return {
    line: `Last 24 h: ${parts.join(', ')} (${recent.length} errors)`,
    count: recent.length,
  };
}

async function readAppErrors(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const errors = [...useErrorLogStore.getState().errors].sort((a, b) => b.ts - a.ts);
  if (errors.length === 0) return { digest: NO_ERRORS, summary: 'App errors: none' };
  const now = ctx.now();
  const shown = errors.slice(0, limitOf(args.limit));
  const lines = [
    `${errors.length} app errors logged, newest first:`,
    ...shown.map((e) => errorLine(e, now)),
  ];
  if (errors.length > shown.length) lines.push(`… (${errors.length - shown.length} older errors)`);
  const recent = last24hLine(errors, now);
  // The 24 h counts must survive a clamp: clamp the list into the room left for them.
  const body = clampDigest(lines.join('\n'), MAX_DIGEST_CHARS - recent.line.length - 1, {
    countMore: true,
  });
  return {
    digest: `${body}\n${recent.line}`,
    summary: `App errors: ${recent.count} in 24 h`,
  };
}

const readAppErrorsTool: AgentTool = {
  name: 'read_app_errors',
  description:
    "The app's own logged errors (connection, adapter, AI, storage), newest first with age, source " +
    'and severity, plus counts per source over the last 24 h. Not vehicle fault codes.',
  labelKey: 'errorLog:agent.tool.read_app_errors',
  args: {
    type: 'object',
    properties: {
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: MAX_APP_ERRORS,
        description: 'Errors to list, newest first; default 10.',
      },
    },
  },
  costMs: 0,
  available: () => true,
  run: readAppErrors,
};

export const agentTools: AgentContribution = {
  tools: [readAppErrorsTool],
  skills: [parseSkillFileOrThrow(appErrorsSkill, 'app_errors')],
};
