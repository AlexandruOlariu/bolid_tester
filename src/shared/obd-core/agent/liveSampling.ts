/** Shared Mode 01 sampling for the AI agent's live tools (`read_live` in coreTools, `record_live` in
 *  live-charts): PID argument parsing, the supported / unsupported split, one poll per tick of the
 *  window through the read-only facade, and the trailing "no answer / not supported" digest lines.
 *  See docs/features/ai-diagnose.md. */

import type { LiveValue } from '../session/DiagnosticSession';
import type { ToolContext } from './types';

/** Gap between two polls when a live tool samples over a window. */
export const LIVE_SAMPLE_MS = 500;

/** The values one PID answered with during a sample, in poll order, and its first reading. */
export interface LiveSeries {
  pid: string;
  meta: LiveValue;
  values: number[];
}

export interface LiveSample {
  /** Requested PIDs the car supports, in request order (these were polled). */
  pids: string[];
  /** Requested PIDs the car does not support (never polled). */
  unsupported: string[];
  /** Polled PIDs that never answered. */
  silent: string[];
  /** Polled PIDs that answered at least once, in request order. */
  series: LiveSeries[];
}

/** A tool's `pids` argument as unique upper-case strings in request order; anything else is dropped. */
export function parseLivePids(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : [];
  return [
    ...new Set(list.filter((p): p is string => typeof p === 'string').map((p) => p.toUpperCase())),
  ];
}

/** Polls the supported subset of `requested` once (`seconds` 0) or once per `sampleMs` tick over
 *  `seconds`; a slow poll skips the ticks it overran, and an abort stops the window early. */
export async function sampleLivePids(
  ctx: ToolContext,
  requested: string[],
  seconds: number,
  sampleMs = LIVE_SAMPLE_MS,
): Promise<LiveSample> {
  const supported = new Set(ctx.session.effectivePids());
  const pids = requested.filter((p) => supported.has(p));
  const unsupported = requested.filter((p) => !supported.has(p));

  const values = new Map<string, number[]>(pids.map((p) => [p, []]));
  const meta = new Map<string, LiveValue>();
  const record = (polled: Record<string, LiveValue>) => {
    for (const pid of pids) {
      const v = polled[pid];
      if (!v) continue;
      values.get(pid)?.push(v.value);
      if (!meta.has(pid)) meta.set(pid, v);
    }
  };

  if (pids.length > 0) {
    if (seconds <= 0) {
      record(await ctx.session.pollOnce(pids));
    } else {
      const start = ctx.now();
      const end = start + seconds * 1000;
      for (let tick = start; tick < end && !ctx.signal.aborted; tick += sampleMs) {
        const wait = tick - ctx.now();
        if (wait > 0) await ctx.sleep(wait);
        if (ctx.now() >= end || ctx.signal.aborted) break;
        record(await ctx.session.pollOnce(pids));
      }
    }
  }

  const series: LiveSeries[] = [];
  const silent: string[] = [];
  for (const pid of pids) {
    const vs = values.get(pid) ?? [];
    const m = meta.get(pid);
    if (!m || vs.length === 0) silent.push(pid);
    else series.push({ pid, meta: m, values: vs });
  }
  return { pids, unsupported, silent, series };
}

/** The digest lines that follow the per-PID lines: PIDs that never answered and PIDs the car does
 *  not support, or `No PIDs requested.` when nothing was asked for. */
export function liveSampleNotes(sample: LiveSample): string[] {
  const notes: string[] = [];
  if (sample.silent.length) notes.push(`No answer from the car: ${sample.silent.join(', ')}.`);
  if (sample.unsupported.length) {
    notes.push(`Not supported on this car: ${sample.unsupported.join(', ')}.`);
  }
  if (sample.pids.length === 0 && sample.unsupported.length === 0) notes.push('No PIDs requested.');
  return notes;
}
