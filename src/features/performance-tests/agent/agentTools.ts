/** The performance-tests feature's contribution to the AI diagnostic agent (plan 34b): the
 *  `read_performance_history` tool (this app session's 0–100 km/h, drag and braking runs for the
 *  active car, newest first; the runs live in memory only and are never saved) and the
 *  `performance_history` capability skill. It never starts a run: the car is stationary during a
 *  diagnosis. Composed by the app layer (`src/app/ai-diagnose.tsx`). See
 *  docs/features/performance-tests.md. */

import { clampDigest, oneDecimal, parseSkillFileOrThrow } from '@/shared/obd-core';
import type { AgentContribution, AgentTool, ToolResult } from '@/shared/obd-core';
import { getActiveProfile } from '@/shared/state/activeProfile';
import { usePerformanceStore, type PerfRun } from '../model/performanceStore';
import performanceHistorySkill from './performance_history.skill.json';

const SESSION_ONLY = 'Runs from this app session only (they are not saved).';

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** A local `yyyy-mm-dd hh:mm`, the time the user saw the run at. */
function localDateTime(ts: number): string {
  const d = new Date(ts);
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  );
}

const secs = (ms: number): string => `${(ms / 1000).toFixed(2)} s`;

/** One run's result line, or null for a run without its result. */
function runLine(r: PerfRun): string | null {
  const when = localDateTime(r.at);
  if (r.type === 'accel' && r.accel) {
    const a = r.accel;
    const tail = `max ${Math.round(a.maxKmh)} km/h, ${oneDecimal(a.sampleRateHz)} Hz`;
    if (a.timeMs == null) return `${when} 0–${a.targetKmh} km/h: not reached, ${tail}`;
    const splits = a.splits
      .filter((s) => s.timeMs != null)
      .map((s) => `${s.fromKmh}–${s.toKmh} ${secs(s.timeMs as number)}`);
    const split = splits.length ? ` (${splits.join(', ')})` : '';
    return `${when} 0–${a.targetKmh} km/h: ${secs(a.timeMs)}${split}, ${tail}`;
  }
  if (r.type === 'drag' && r.drag) {
    const d = r.drag;
    const mark = (name: string, m: { timeMs: number; trapKmh: number } | null) =>
      m ? `${name} ${secs(m.timeMs)} at ${Math.round(m.trapKmh)} km/h` : `${name} not reached`;
    const sixty = d.sixtyFtMs == null ? '60 ft not reached' : `60 ft ${secs(d.sixtyFtMs)}`;
    return `${when} drag: ${sixty}, ${mark('1/8 mile', d.eighthMile)}, ${mark('1/4 mile', d.quarterMile)}`;
  }
  if (r.type === 'brake' && r.brake) {
    const b = r.brake;
    const head = `${when} braking ${b.fromKmh}–${b.toKmh} km/h`;
    if (b.timeMs == null) return `${head}: not measured`;
    const dist = b.distanceM == null ? '' : ` over ${oneDecimal(b.distanceM)} m`;
    return `${head}: ${secs(b.timeMs)}${dist}`;
  }
  return null;
}

async function readPerformanceHistory(): Promise<ToolResult> {
  const carId = getActiveProfile().id;
  const lines = usePerformanceStore
    .getState()
    .history.filter((r) => r.vehicleId === carId)
    .sort((a, b) => b.at - a.at)
    .map(runLine)
    .filter((l): l is string => l !== null);
  if (lines.length === 0) {
    return {
      digest: `${SESSION_ONLY}\nNo performance runs for this car yet.`,
      summary: 'Performance runs: none',
    };
  }
  return {
    digest: clampDigest([SESSION_ONLY, ...lines].join('\n'), undefined, { countMore: true }),
    summary: `Performance runs: ${lines.length}`,
  };
}

const readPerformanceHistoryTool: AgentTool = {
  name: 'read_performance_history',
  description:
    "This app session's 0-100 km/h times (s), drag (60 ft, 1/8, 1/4 mile) and braking (s, m) " +
    'runs for this car, with dates. Runs are not saved between app sessions.',
  labelKey: 'performanceTests:agent.tool.read_performance_history',
  args: { type: 'object', properties: {} },
  costMs: 0,
  available: () => true,
  run: () => readPerformanceHistory(),
};

export const agentTools: AgentContribution = {
  tools: [readPerformanceHistoryTool],
  skills: [parseSkillFileOrThrow(performanceHistorySkill, 'performance_history')],
};
