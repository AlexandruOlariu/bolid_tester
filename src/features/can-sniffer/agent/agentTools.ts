/** The can-sniffer feature's contribution to the AI diagnostic agent (plan 34b): `listen_bus`, a
 *  short passive listen to the CAN bus (1-10 s through the read-only facade's `listenBus`: the
 *  adapter's `ATMA` monitor, nothing transmitted on the bus) summarised per CAN id, and the
 *  `bus_listen` capability skill. Offered only on a CAN car over a link that can stream the monitor
 *  (never Classic Bluetooth SPP). Composed by the app layer (`src/app/ai-diagnose.tsx`). See
 *  docs/features/can-sniffer.md. */

import { clampDigest, isCan, parseMonitorLine, parseSkillFileOrThrow } from '@/shared/obd-core';
import type { AgentContribution, AgentTool, ToolContext, ToolResult } from '@/shared/obd-core';
import busListenSkill from './bus_listen.skill.json';

export const LISTEN_MIN_SECONDS = 1;
export const LISTEN_MAX_SECONDS = 10;
export const LISTEN_DEFAULT_SECONDS = 5;
/** CAN ids the digest lists, busiest first. */
export const LISTEN_TOP_IDS = 10;

const frames = (n: number): string => `${n} frame${n === 1 ? '' : 's'}`;

async function listenBus(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const secondsArg =
    typeof args.seconds === 'number' && Number.isFinite(args.seconds)
      ? Math.floor(args.seconds)
      : LISTEN_DEFAULT_SECONDS;
  const seconds = Math.min(LISTEN_MAX_SECONDS, Math.max(LISTEN_MIN_SECONDS, secondsArg));

  let lines: string[];
  try {
    lines = await ctx.session.listenBus(seconds * 1000);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { digest: message, summary: `Bus listen failed: ${message}`, status: 'error' };
  }

  const counts = new Map<string, number>();
  let total = 0;
  let unparsed = 0;
  for (const line of lines) {
    const frame = parseMonitorLine(line);
    if (!frame) {
      unparsed += 1;
      continue;
    }
    total += 1;
    const id = frame.id ?? '(no id)';
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  if (total === 0) {
    return {
      digest: `No frames heard in ${seconds} s.${unparsed ? ` Unparsed lines: ${unparsed}.` : ''}`,
      summary: `Bus ${seconds} s: no frames`,
    };
  }

  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const out = [
    `Listened ${seconds} s (passive monitor): ${frames(total)}, distinct ids: ${counts.size}.`,
    'Top ids by count:',
    ...ranked
      .slice(0, LISTEN_TOP_IDS)
      .map(([id, n]) => `${id}: ${frames(n)}, ${(n / seconds).toFixed(1)} frames/s`),
  ];
  if (ranked.length > LISTEN_TOP_IDS) out.push(`… (${ranked.length - LISTEN_TOP_IDS} more ids)`);
  if (unparsed) out.push(`Unparsed lines: ${unparsed}.`);
  return {
    digest: clampDigest(out.join('\n')),
    summary: `Bus ${seconds} s: ${frames(total)}, ${counts.size} ids`,
  };
}

const listenBusTool: AgentTool = {
  name: 'listen_bus',
  description:
    'Listen passively to the CAN bus for 1-10 s (nothing is sent on the bus): frame count, ' +
    'distinct CAN ids and the 10 busiest ids with frames per second.',
  labelKey: 'canSniffer:agent.tool.listen_bus',
  args: {
    type: 'object',
    properties: {
      seconds: {
        type: 'integer',
        minimum: LISTEN_MIN_SECONDS,
        maximum: LISTEN_MAX_SECONDS,
        description: `Listening time, ${LISTEN_MIN_SECONDS}-${LISTEN_MAX_SECONDS} s (default ${LISTEN_DEFAULT_SECONDS}).`,
      },
    },
  },
  // A tool declares one cost, so it is the longest call: the full 10 s window plus start / stop.
  costMs: 1000 + LISTEN_MAX_SECONDS * 1000,
  available: (ctx) => ctx.canMonitor && isCan(ctx.protocol),
  run: listenBus,
};

export const agentTools: AgentContribution = {
  tools: [listenBusTool],
  skills: [parseSkillFileOrThrow(busListenSkill, 'bus_listen')],
};
