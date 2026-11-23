/** Pure cooling check for the diagnostic agent's cooling procedure. Judges the current coolant
 *  temperature (PID 0105) and, when one exists, the warm-up curve of the most recent recorded trip
 *  that started cold — the user is never asked to wait for a warm-up. Overheat thresholds match
 *  `localHeuristicReport`. A missing value is never judged: no current reading leaves the current
 *  part out, NO DATA coolant samples are skipped, and a trip without coolant has no curve. No device
 *  I/O. `notes` are English and model-facing. See docs/features/ai-diagnose.md. */

import type { Fuel } from '../../vehicles/types';
import type { DiagSeverity } from './aiDiagnosis';
import type { TripSample } from './trip';

export const COLD_START_MAX_C = 40,
  WARM_C = 80,
  THERMOSTAT_OPEN_MAX_C = 75,
  THERMOSTAT_DRIVE_MIN = 15,
  HOT_C = 105,
  OVERHEAT_C = 115,
  SLOW_WARMUP_MIN = { petrol: 20, diesel: 25 } as const;

export interface WarmupCurve {
  /** The first coolant reading of the trip was at or below `COLD_START_MAX_C`. */
  coldStart: boolean;
  startC: number | null;
  /** Minutes from the first coolant reading to `WARM_C` (interpolated between samples); null when
   *  not a cold start or `WARM_C` was never reached. */
  warmupMin: number | null;
  /** Minutes spent with vehicle speed (010D) above 0, from sample timestamps. */
  drivenMin: number;
  maxC: number | null;
}

export type CoolingFindingId =
  | 'ok'
  | 'hot_now'
  | 'overheat_now'
  | 'thermostat_open'
  | 'slow_warmup'
  | 'trip_overheat'
  | 'no_cold_trip'
  | 'warmup_not_judged';

export interface CoolingResult {
  findings: { id: CoolingFindingId; severity: DiagSeverity }[];
  notes: string[];
}

const COOLANT = '0105';
const SPEED = '010D';

const round1 = (x: number): number => Math.round(x * 10) / 10;

function coolantOf(s: TripSample): number | null {
  const v = s.values[COOLANT];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Warm-up curve of a recorded trip; null when no 0105 was logged. */
export function warmupCurve(samples: TripSample[]): WarmupCurve | null {
  const coolant = samples
    .map((s) => ({ t: s.t, c: coolantOf(s) }))
    .filter((p): p is { t: number; c: number } => p.c != null);
  if (coolant.length === 0) return null;

  let drivenMs = 0;
  for (let i = 0; i + 1 < samples.length; i++) {
    const v = samples[i].values[SPEED];
    if (typeof v === 'number' && v > 0) drivenMs += Math.max(0, samples[i + 1].t - samples[i].t);
  }

  const start = coolant[0];
  const coldStart = start.c <= COLD_START_MAX_C;
  let warmupMin: number | null = null;
  if (coldStart) {
    for (let i = 1; i < coolant.length; i++) {
      const cur = coolant[i];
      if (cur.c < WARM_C) continue;
      const prev = coolant[i - 1];
      const frac = cur.c === prev.c ? 1 : (WARM_C - prev.c) / (cur.c - prev.c);
      warmupMin = round1((prev.t + frac * (cur.t - prev.t) - start.t) / 60_000);
      break;
    }
  }

  return {
    coldStart,
    startC: round1(start.c),
    warmupMin,
    drivenMin: round1(drivenMs / 60_000),
    maxC: round1(Math.max(...coolant.map((p) => p.c))),
  };
}

export function assessCooling(
  currentC: number | null,
  curve: WarmupCurve | null,
  fuel: Fuel,
): CoolingResult {
  const findings: CoolingResult['findings'] = [];
  const notes: string[] = [];

  if (currentC == null)
    notes.push('No current coolant reading (0105); the current part is not judged.');
  else {
    notes.push(`Coolant now ${round1(currentC)} °C.`);
    if (currentC >= OVERHEAT_C) findings.push({ id: 'overheat_now', severity: 'critical' });
    else if (currentC >= HOT_C) findings.push({ id: 'hot_now', severity: 'warn' });
  }

  let judged = currentC != null;
  if (!curve || !curve.coldStart) {
    if (currentC != null) {
      findings.push({ id: 'no_cold_trip', severity: 'info' });
      notes.push('No recorded trip started cold; judged on the current reading only.');
    } else notes.push('No recorded trip started cold and no current reading: cooling not judged.');
  } else {
    judged = true;
    const slowMin = fuel === 'diesel' ? SLOW_WARMUP_MIN.diesel : SLOW_WARMUP_MIN.petrol;
    notes.push(
      `Cold-start trip: started at ${curve.startC} °C, max ${curve.maxC} °C, driven ${curve.drivenMin} min, ` +
        (curve.warmupMin == null
          ? `never reached ${WARM_C} °C.`
          : `reached ${WARM_C} °C after ${curve.warmupMin} min (slow above ${slowMin} min).`),
    );
    const thermostatOpen =
      curve.drivenMin >= THERMOSTAT_DRIVE_MIN &&
      curve.maxC != null &&
      curve.maxC < THERMOSTAT_OPEN_MAX_C;
    if (thermostatOpen) findings.push({ id: 'thermostat_open', severity: 'warn' });
    if (curve.warmupMin != null && curve.warmupMin > slowMin)
      findings.push({ id: 'slow_warmup', severity: 'info' });
    if (curve.drivenMin < THERMOSTAT_DRIVE_MIN && curve.warmupMin == null)
      notes.push(
        `Driven under ${THERMOSTAT_DRIVE_MIN} min before warming: too short to judge the thermostat.`,
      );
    // The trip ended before the engine warmed: neither the warm-up nor the thermostat was judged,
    // so this is said instead of falling through to "ok".
    if (curve.warmupMin == null && !thermostatOpen)
      findings.push({ id: 'warmup_not_judged', severity: 'info' });
  }

  if (curve?.maxC != null) {
    if (curve.maxC >= OVERHEAT_C) findings.push({ id: 'trip_overheat', severity: 'critical' });
    else if (curve.maxC >= HOT_C) findings.push({ id: 'trip_overheat', severity: 'warn' });
    if (!curve.coldStart && curve.maxC >= HOT_C)
      notes.push(`The recorded trip reached ${curve.maxC} °C.`);
  }

  if (findings.length === 0 && judged) findings.push({ id: 'ok', severity: 'ok' });
  return { findings, notes };
}
