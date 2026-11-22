/** The history feature's contribution to the AI diagnostic agent (plan 34b): `read_history` (runs
 *  at triage with `{ limit: 5 }`: the **active car's** last AI runs, its fault-code checks with the
 *  codes, a code set that went away between two checks, codes recurring over the listed checks, and
 *  the number of saved module scans), `history_compare` (one PID's max and average over this car's
 *  last 10 trips, oldest first, plus one live read now) and the `history` capability skill.
 *
 *  Like the History timeline (a sanctioned composition point, docs/architecture.md), it reads the
 *  module-scan and trip stores and the trip CSVs; it writes nothing. A record belongs to the active
 *  car when its car id is `getActiveProfile().id` (garage-aware) or its VIN is the active garage
 *  car's learned VIN. Composed by the app layer (`src/app/ai-diagnose.tsx`). See
 *  docs/features/history.md. */

import {
  PID_REGISTRY,
  clampDigest,
  oneDecimal,
  parseSkillFileOrThrow,
  sampleLivePids,
} from '@/shared/obd-core';
import type { AgentContribution, AgentTool, ToolContext, ToolResult } from '@/shared/obd-core';
import { getActiveProfile, getActiveUserVehicle } from '@/shared/state/activeProfile';
import {
  useHistoryStore,
  type AiHistoryEntry,
  type DtcHistoryEntry,
  type HistoryVehicle,
} from '@/shared/state/historyStore';
import { useScanHistoryStore } from '@/features/module-scan/model/scanHistoryStore';
import {
  tripCarKey,
  useTripStore,
  type TripSummary,
} from '@/features/trip-recording/model/tripStore';
import { loadTripSamples } from '@/features/trip-recording/hooks/useTripRecorder';
import historySkill from './history.skill.json';

/** Records `read_history` lists per kind when no limit is given (the triage limit). */
export const DEFAULT_HISTORY_LIMIT = 5;
const MAX_HISTORY_LIMIT = 10;
/** Trips `history_compare` compares. */
export const COMPARE_TRIPS = 10;
/** Longest AI-run summary the digest quotes. */
const SUMMARY_CHARS = 120;

const NO_HISTORY = 'No history for this car yet.';
const NO_TRIPS = 'No trips recorded for this car.';

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** A local `yyyy-mm-dd hh:mm`, the time the user saw the record at. */
function localDateTime(ts: number): string {
  const d = new Date(ts);
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  );
}

/** Whether a record's car is the active car: same id, or the active garage car's learned VIN. */
function activeCarMatcher(): (v: HistoryVehicle) => boolean {
  const id = getActiveProfile().id;
  const vin = getActiveUserVehicle()?.learned?.vin ?? null;
  return (v) => v.id === id || (vin != null && v.vin === vin);
}

/** First line of `s`, at most `max` characters (an ellipsis marks a cut). */
function firstLineClipped(s: string, max: number): string {
  const line = s.split(/\r?\n/)[0].trim();
  return line.length <= max ? line : `${line.slice(0, max - 1)}…`;
}

/** Every code of a check: stored, then pending, then permanent, each once. */
function checkCodes(e: DtcHistoryEntry): string[] {
  return [...new Set([...e.stored, ...e.pending, ...e.permanent].map((d) => d.code))];
}

/** `"P0401, P2002 pending (MIL on)"` / `"no codes"`. */
function checkText(e: DtcHistoryEntry): string {
  const stored = new Set(e.stored.map((d) => d.code));
  const pending = new Set(e.pending.map((d) => d.code));
  const parts = checkCodes(e).map((code) =>
    stored.has(code) ? code : pending.has(code) ? `${code} pending` : `${code} permanent`,
  );
  const mil = e.milOn == null ? '' : e.milOn ? ' (MIL on)' : ' (MIL off)';
  return parts.length ? `${parts.join(', ')}${mil}` : 'no codes';
}

const aiLine = (e: AiHistoryEntry): string =>
  `${localDateTime(e.ts)} ${e.overall}: ${firstLineClipped(e.summary, SUMMARY_CHARS)}`;

/** Clears and recurring codes over `checks` (oldest first). */
function checkPatterns(checks: DtcHistoryEntry[]): string[] {
  const lines: string[] = [];
  for (let i = 1; i < checks.length; i++) {
    if (checkCodes(checks[i - 1]).length > 0 && checkCodes(checks[i]).length === 0)
      lines.push(
        `Codes went away between ${localDateTime(checks[i - 1].ts)} and ` +
          `${localDateTime(checks[i].ts)} (cleared or fixed)`,
      );
  }
  const seen = new Map<string, number>();
  for (const c of checks)
    for (const code of checkCodes(c)) seen.set(code, (seen.get(code) ?? 0) + 1);
  for (const [code, n] of seen) if (n >= 2) lines.push(`Recurring: ${code} (${n} checks)`);
  return lines;
}

function limitOf(raw: unknown): number {
  const n =
    typeof raw === 'number' && Number.isFinite(raw) ? Math.floor(raw) : DEFAULT_HISTORY_LIMIT;
  return Math.min(MAX_HISTORY_LIMIT, Math.max(1, n));
}

async function readHistory(args: Record<string, unknown>): Promise<ToolResult> {
  const limit = limitOf(args.limit);
  const isActive = activeCarMatcher();
  const mine = useHistoryStore
    .getState()
    .entries.filter((e) => isActive(e.vehicle))
    .sort((a, b) => b.ts - a.ts);
  const ai = mine.filter((e): e is AiHistoryEntry => e.kind === 'ai');
  const checks = mine.filter((e): e is DtcHistoryEntry => e.kind === 'dtc');
  const scans = useScanHistoryStore
    .getState()
    .scans.filter((s) => isActive(s.vehicle))
    .sort((a, b) => b.ts - a.ts);
  if (ai.length === 0 && checks.length === 0 && scans.length === 0)
    return { digest: NO_HISTORY, summary: 'History: none' };

  const lines: string[] = [];
  if (ai.length) {
    const shown = ai.slice(0, limit);
    lines.push(`AI runs (${shown.length} of ${ai.length}, newest first):`, ...shown.map(aiLine));
  } else lines.push('AI runs: none');
  if (checks.length) {
    const shown = checks.slice(0, limit);
    lines.push(
      `Fault-code checks (${shown.length} of ${checks.length}, newest first):`,
      ...shown.map((e) => `${localDateTime(e.ts)}: ${checkText(e)}`),
      ...checkPatterns([...shown].reverse()),
    );
  } else lines.push('Fault-code checks: none');
  lines.push(
    scans.length
      ? `Saved module scans: ${scans.length} (newest ${localDateTime(scans[0].ts)})`
      : 'Saved module scans: none',
  );
  return {
    digest: clampDigest(lines.join('\n')),
    summary: `History: ${ai.length} AI runs, ${checks.length} checks, ${scans.length} scans`,
  };
}

/** The active car's trips, newest first. */
function activeCarTrips(): TripSummary[] {
  const carId = getActiveProfile().id;
  return useTripStore
    .getState()
    .trips.filter((t) => tripCarKey(t) === carId)
    .sort((a, b) => b.header.startedAt - a.header.startedAt);
}

/** The average of `pid` over a trip's saved samples, or null when they cannot be read. */
async function tripAverage(t: TripSummary, pid: string): Promise<number | null> {
  try {
    const values = (await loadTripSamples(t.header))
      .map((s) => s.values[pid])
      .filter((v): v is number => v != null && Number.isFinite(v));
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  } catch {
    return null;
  }
}

async function historyCompare(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const pid = String(args.pid ?? '').toUpperCase();
  const desc = PID_REGISTRY[pid];
  const name = desc ? `${pid} ${desc.name}` : pid;
  const unit = desc?.unit ? ` ${desc.unit}` : '';

  const trips = activeCarTrips().slice(0, COMPARE_TRIPS).reverse();
  const lines: string[] = [];
  if (trips.length === 0) lines.push(NO_TRIPS);
  else {
    lines.push(`${name} over this car's last ${trips.length} trips (oldest → newest):`);
    for (const t of trips) {
      if (ctx.signal.aborted) break;
      const max = t.stats.max?.[pid];
      const when = localDateTime(t.header.startedAt);
      if (max == null) {
        lines.push(`${when}: not logged`);
        continue;
      }
      const avg = await tripAverage(t, pid);
      const avgText = avg == null ? 'avg n/a' : `avg ${oneDecimal(avg)}`;
      lines.push(`${when}: max ${oneDecimal(max)} / ${avgText}${unit}`);
    }
  }

  const live = await sampleLivePids(ctx, [pid], 0);
  const now = live.series[0]?.values[0];
  if (live.unsupported.length) lines.push('Now: not supported by this car');
  else if (now == null) lines.push('Now: no answer');
  else lines.push(`Now: ${oneDecimal(now)}${unit}`);

  return {
    digest: clampDigest(lines.join('\n')),
    summary: `${pid}: ${trips.length} trips, now ${now == null ? 'n/a' : `${oneDecimal(now)}${unit}`}`,
  };
}

const readHistoryTool: AgentTool = {
  name: 'read_history',
  description:
    "This car's diagnostic history: last AI runs (overall, summary), fault-code checks with " +
    'their codes, codes that went away (cleared or fixed), recurring codes and saved module scans.',
  labelKey: 'history:agent.tool.read_history',
  args: {
    type: 'object',
    properties: {
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: MAX_HISTORY_LIMIT,
        description: 'AI runs and fault-code checks to list, newest first; default 5.',
      },
    },
  },
  costMs: 0,
  triage: { args: { limit: DEFAULT_HISTORY_LIMIT } },
  available: () => true,
  run: readHistory,
};

const historyCompareTool: AgentTool = {
  name: 'history_compare',
  description:
    "Compare one Mode 01 PID now with this car's last 10 recorded trips: per trip its max and " +
    'average (oldest → newest), then one live read.',
  labelKey: 'history:agent.tool.history_compare',
  args: {
    type: 'object',
    properties: {
      pid: {
        type: 'string',
        pattern: '^[0-9A-Fa-f]{4}$',
        description: 'Mode 01 PID, e.g. "0105".',
      },
    },
    required: ['pid'],
  },
  costMs: 1000,
  available: () => true,
  run: historyCompare,
};

export const agentTools: AgentContribution = {
  tools: [readHistoryTool, historyCompareTool],
  skills: [parseSkillFileOrThrow(historySkill, 'history')],
};
