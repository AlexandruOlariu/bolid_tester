/** The AI diagnostic agent's core read tools (plan 34a): `read_live` (Mode 01 PIDs, once or sampled
 *  for up to 15 s) and `read_dtcs` (the profile's DTC modes, MIL and readiness), plus the
 *  `battery_capture` procedure. Every read goes through the read-only session facade. See
 *  docs/features/ai-diagnose.md. */

import type { Dtc } from '../obd/dtc';
import { toDtc } from '../obd/dtc';
import type { MonitorStatus } from '../obd/readiness';
import type { VehicleProfile } from '../../vehicles/types';
import { clampDigest, oneDecimal, statsLine } from './digest';
import { liveSampleNotes, parseLivePids, sampleLivePids } from './liveSampling';
import { batteryCaptureProcedure } from './procedures/batteryCapture';
import type { ReadOnlySession } from './readOnlySession';
import type { AgentContribution, AgentTool, ToolContext, ToolResult } from './types';

export const READ_LIVE_MAX_SECONDS = 15;
export const READ_LIVE_MAX_PIDS = 8;

/** Adapter time a `read_live` call may take: 1 s plus the sampling window. */
export function readLiveCostMs(seconds: number): number {
  return 1000 + seconds * 1000;
}

/** Per-PID statistics `read_live` returns in `data` (one-shot: min = avg = max, n = 1). */
export interface LiveStats {
  min: number;
  avg: number;
  max: number;
  n: number;
}

export interface DtcSet {
  stored: Dtc[];
  pending: Dtc[];
  permanent: Dtc[];
}

/** The DTC modes the profile lists (03 stored, 07 pending, 0A permanent), described make-aware like
 *  the Faults screen; a mode the profile does not list reads as empty. */
export async function readProfileDtcs(
  session: ReadOnlySession,
  profile: VehicleProfile,
): Promise<DtcSet> {
  const modes = profile.dtcModes;
  const describe = (list: Dtc[]) => list.map((d) => toDtc(d.code, profile.make));
  const stored = describe(modes.includes('03') ? await session.readDtcs('03') : []);
  const pending = describe(modes.includes('07') ? await session.readDtcs('07') : []);
  const permanent = describe(modes.includes('0A') ? await session.readDtcs('0A') : []);
  return { stored, pending, permanent };
}

function stats(values: number[]): LiveStats {
  const n = values.length;
  const avg = values.reduce((a, b) => a + b, 0) / n;
  return { min: Math.min(...values), avg, max: Math.max(...values), n };
}

async function readLive(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const requested = parseLivePids(args.pids);
  const secondsArg = typeof args.seconds === 'number' ? Math.floor(args.seconds) : 0;
  const seconds = Math.min(READ_LIVE_MAX_SECONDS, Math.max(0, secondsArg));

  const sample = await sampleLivePids(ctx, requested, seconds);

  const lines: string[] = [];
  const brief: string[] = [];
  const data: Record<string, LiveStats> = {};
  for (const { pid, meta: m, values: vs } of sample.series) {
    const s = stats(vs);
    data[pid] = s;
    const unit = m.unit ? ` ${m.unit}` : '';
    if (seconds === 0) {
      lines.push(`${pid} ${m.name}: ${oneDecimal(vs[0])}${unit}`);
      brief.push(`${pid} ${oneDecimal(vs[0])}${unit}`);
    } else {
      lines.push(statsLine(`${pid} ${m.name}`, m.unit, vs, seconds));
      brief.push(`${pid} avg ${oneDecimal(s.avg)}${unit}`);
    }
  }
  lines.push(...liveSampleNotes(sample));

  const { unsupported } = sample;
  const head = seconds === 0 ? 'Live' : `Live ${seconds} s`;
  const tail = unsupported.length ? `; not supported ${unsupported.join(', ')}` : '';
  return {
    digest: clampDigest(lines.join('\n')),
    summary: `${head}: ${brief.length ? brief.join(', ') : 'no data'}${tail}`,
    data,
  };
}

function dtcLine(label: string, list: Dtc[], read: boolean): string {
  if (!read) return `${label} DTCs: not read on this car.`;
  if (list.length === 0) return `${label} DTCs: none.`;
  return `${label} DTCs (${list.length}): ${list.map((d) => `${d.code} — ${d.description}`).join('; ')}.`;
}

function readinessLines(r: MonitorStatus | null): string[] {
  if (!r) return ['MIL (check-engine light): unknown.', 'Readiness: not available.'];
  const sup = r.monitors.filter((m) => m.supported);
  const done = sup.filter((m) => m.complete).length;
  const notReady = sup.filter((m) => !m.complete).map((m) => m.name);
  return [
    `MIL (check-engine light): ${r.milOn ? 'ON' : 'off'}; reported DTC count: ${r.dtcCount}.`,
    `Readiness monitors: ${done}/${sup.length} complete.`,
    ...(notReady.length ? [`Monitors not ready: ${notReady.join(', ')}.`] : []),
  ];
}

async function readDtcs(_args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const modes = ctx.profile.dtcModes;
  const dtcs = await readProfileDtcs(ctx.session, ctx.profile);
  const readiness = await ctx.session.readReadiness();
  const mil = readiness ? (readiness.milOn ? 'MIL on' : 'MIL off') : 'MIL unknown';
  return {
    digest: clampDigest(
      [
        dtcLine('Stored', dtcs.stored, modes.includes('03')),
        dtcLine('Pending', dtcs.pending, modes.includes('07')),
        dtcLine('Permanent', dtcs.permanent, modes.includes('0A')),
        ...readinessLines(readiness),
      ].join('\n'),
    ),
    summary:
      `DTCs: ${dtcs.stored.length} stored, ${dtcs.pending.length} pending, ` +
      `${dtcs.permanent.length} permanent; ${mil}`,
    data: dtcs,
  };
}

const readLiveTool: AgentTool = {
  name: 'read_live',
  description:
    'Read live engine values by Mode 01 PID (e.g. 010C rpm, 0105 coolant °C). seconds 0 reads ' +
    'once; 1-15 samples every 0.5 s and gives min / avg / max. Lists PIDs this car does not support.',
  labelKey: 'aiDiagnose:agent.tool.read_live',
  args: {
    type: 'object',
    properties: {
      pids: {
        type: 'array',
        items: { type: 'string', pattern: '^01[0-9A-F]{2}$' },
        maxItems: READ_LIVE_MAX_PIDS,
        description: 'Mode 01 PIDs, e.g. ["010C","0105"].',
      },
      seconds: {
        type: 'integer',
        minimum: 0,
        maximum: READ_LIVE_MAX_SECONDS,
        description: '0 or absent: read once. 1-15: sample for that many seconds.',
      },
    },
    required: ['pids'],
  },
  // A tool declares one cost, so it is the longest call: the full 15 s window.
  costMs: readLiveCostMs(READ_LIVE_MAX_SECONDS),
  available: () => true,
  run: readLive,
};

const readDtcsTool: AgentTool = {
  name: 'read_dtcs',
  description:
    'Read the stored, pending and permanent fault codes with descriptions, the MIL state and the ' +
    'readiness monitors.',
  labelKey: 'aiDiagnose:agent.tool.read_dtcs',
  args: { type: 'object', properties: {} },
  costMs: 3000,
  available: () => true,
  run: readDtcs,
};

/** The core contribution: always registered first. */
export const CORE_AGENT_CONTRIBUTION: AgentContribution = {
  tools: [readLiveTool, readDtcsTool],
  procedures: [batteryCaptureProcedure],
};
