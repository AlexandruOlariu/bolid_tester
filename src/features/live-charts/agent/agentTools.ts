/** The live-charts feature's contribution to the AI diagnostic agent (plan 34b): `record_live`, a
 *  short recording (3-15 s, one poll every 500 ms) of up to 4 Mode 01 PIDs giving min / avg / max
 *  and the trend of each, and the `record_live` capability skill. Sampling is the shared obd-core
 *  `sampleLivePids` (as `read_live`); every read goes through the read-only facade. Composed by
 *  the app layer (`src/app/ai-diagnose.tsx`). See docs/features/live-charts.md. */

import {
  clampDigest,
  liveSampleNotes,
  oneDecimal,
  parseLivePids,
  parseSkillFileOrThrow,
  sampleLivePids,
  statsLine,
  trendOf,
} from '@/shared/obd-core';
import type { AgentContribution, AgentTool, ToolContext, ToolResult } from '@/shared/obd-core';
import recordLiveSkill from './record_live.skill.json';

export const RECORD_MIN_SECONDS = 3;
export const RECORD_MAX_SECONDS = 15;
export const RECORD_DEFAULT_SECONDS = 10;
export const RECORD_MAX_PIDS = 4;

/** Per-PID result `record_live` returns in `data`. */
export interface RecordedSeries {
  min: number;
  avg: number;
  max: number;
  n: number;
  trend: 'rising' | 'falling' | 'steady';
}

async function recordLive(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const requested = parseLivePids(args.pids).slice(0, RECORD_MAX_PIDS);
  const secondsArg =
    typeof args.seconds === 'number' ? Math.floor(args.seconds) : RECORD_DEFAULT_SECONDS;
  const seconds = Math.min(RECORD_MAX_SECONDS, Math.max(RECORD_MIN_SECONDS, secondsArg));

  const sample = await sampleLivePids(ctx, requested, seconds);

  const lines: string[] = [];
  const brief: string[] = [];
  const data: Record<string, RecordedSeries> = {};
  for (const { pid, meta: m, values: vs } of sample.series) {
    const trend = trendOf(vs);
    const avg = vs.reduce((a, b) => a + b, 0) / vs.length;
    data[pid] = { min: Math.min(...vs), avg, max: Math.max(...vs), n: vs.length, trend };
    lines.push(`${statsLine(`${pid} ${m.name}`, m.unit, vs, seconds)}, trend ${trend}`);
    brief.push(`${pid} avg ${oneDecimal(avg)}${m.unit ? ` ${m.unit}` : ''} ${trend}`);
  }
  lines.push(...liveSampleNotes(sample));

  return {
    digest: clampDigest(lines.join('\n')),
    summary: `Recorded ${seconds} s: ${brief.length ? brief.join(', ') : 'no data'}`,
    data,
  };
}

const recordLiveTool: AgentTool = {
  name: 'record_live',
  description:
    'Record up to 4 Mode 01 PIDs for 3-15 s (a poll every 0.5 s): min / avg / max and whether ' +
    'each value is rising, falling or steady over the window.',
  labelKey: 'liveCharts:agent.tool.record_live',
  args: {
    type: 'object',
    properties: {
      pids: {
        type: 'array',
        items: { type: 'string', pattern: '^01[0-9A-F]{2}$' },
        maxItems: RECORD_MAX_PIDS,
        description: 'Mode 01 PIDs, e.g. ["0105","010C"].',
      },
      seconds: {
        type: 'integer',
        minimum: RECORD_MIN_SECONDS,
        maximum: RECORD_MAX_SECONDS,
        description: `Recording length, ${RECORD_MIN_SECONDS}-${RECORD_MAX_SECONDS} s (default ${RECORD_DEFAULT_SECONDS}).`,
      },
    },
    required: ['pids'],
  },
  // A tool declares one cost, so it is the longest call: the full 15 s window.
  costMs: 1000 + RECORD_MAX_SECONDS * 1000,
  available: () => true,
  run: recordLive,
};

export const agentTools: AgentContribution = {
  tools: [recordLiveTool],
  skills: [parseSkillFileOrThrow(recordLiveSkill, 'record_live')],
};
