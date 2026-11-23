/** Pure misfire check for the diagnostic agent's misfire procedure. Reads the per-cylinder misfire
 *  counts reported by the Mode 06 misfire monitors (MID A2–A5 = cylinders 1–4) and tells a single
 *  bad cylinder apart from misfires spread across the engine. Counts come from the misfire-cycle
 *  test (TID 0x0C), else the EWMA test (TID 0x0B). A cylinder without a count result is left out,
 *  never judged as zero. No device I/O. See docs/features/ai-diagnose.md. */

import type { Mode06Result } from '../obd/mode06';
import type { DiagSeverity } from './aiDiagnosis';

/** Misfire monitor MIDs for cylinders 1–4 (all built-in cars are 4-cylinder). */
export const MISFIRE_MIDS = ['A2', 'A3', 'A4', 'A5'] as const;
export const MISFIRE_TID_CYCLE = 0x0c,
  MISFIRE_TID_EWMA = 0x0b,
  MISFIRE_MIN_COUNT = 5;

/** Total count across cylinders at or above which spread misfires are reported as random. */
const MISFIRE_RANDOM_TOTAL = 10;
/** A cylinder is singled out when its count is at least this multiple of the next highest. */
const MISFIRE_CYLINDER_RATIO = 2;

/** MID number → cylinder number (0xA2 → 1 … 0xA5 → 4). */
const CYLINDER_BY_MID = new Map(
  MISFIRE_MIDS.map((mid) => [parseInt(mid, 16), parseInt(mid, 16) - 0xa1]),
);

export type MisfireFindingId = 'none' | 'cylinder' | 'random' | 'no_data';

export interface MisfireAssessment {
  id: MisfireFindingId;
  severity: DiagSeverity;
  /** The singled-out cylinder (1-based), only for `cylinder`. */
  cylinder?: number;
  /** Misfire count per cylinder (1-based) that reported a count test. */
  counts: Record<number, number>;
}

/** Count for each cylinder from its preferred test: TID 0x0C when present, else TID 0x0B. */
function countsByCylinder(results: Mode06Result[]): Record<number, number> {
  const cycle = new Map<number, number>();
  const ewma = new Map<number, number>();
  for (const r of results) {
    const cylinder = CYLINDER_BY_MID.get(r.mid);
    if (cylinder === undefined) continue;
    const into = r.tid === MISFIRE_TID_CYCLE ? cycle : r.tid === MISFIRE_TID_EWMA ? ewma : null;
    if (into) into.set(cylinder, Math.max(into.get(cylinder) ?? 0, r.value));
  }
  const counts: Record<number, number> = {};
  for (const cylinder of CYLINDER_BY_MID.values()) {
    const count = cycle.get(cylinder) ?? ewma.get(cylinder);
    if (count !== undefined) counts[cylinder] = count;
  }
  return counts;
}

export function assessMisfire(results: Mode06Result[]): MisfireAssessment {
  const counts = countsByCylinder(results);
  const ranked = Object.entries(counts)
    .map(([cylinder, count]) => ({ cylinder: Number(cylinder), count }))
    .sort((a, b) => b.count - a.count);
  if (ranked.length === 0) return { id: 'no_data', severity: 'info', counts };

  const top = ranked[0];
  const next = ranked[1]?.count ?? 0;
  if (top.count >= MISFIRE_MIN_COUNT && top.count >= MISFIRE_CYLINDER_RATIO * next) {
    return { id: 'cylinder', severity: 'warn', cylinder: top.cylinder, counts };
  }
  const total = ranked.reduce((sum, r) => sum + r.count, 0);
  if (total >= MISFIRE_RANDOM_TOTAL) return { id: 'random', severity: 'warn', counts };
  return { id: 'none', severity: 'ok', counts };
}
