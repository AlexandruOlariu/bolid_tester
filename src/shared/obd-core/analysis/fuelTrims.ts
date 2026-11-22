/** Pure fuel-trim pattern analysis for the diagnostic agent's fuel-trim procedure. Takes one trim
 *  reading at idle and, optionally, one during a stationary 2500 rpm hold, and classifies the
 *  pattern. Total trim = STFT + LTFT (%), positive = the ECU is adding fuel (lean), negative = it is
 *  removing fuel (rich). A missing trim is never judged: it yields `insufficient`. No device I/O.
 *  `notes` are English and model-facing. See docs/features/ai-agent.md. */

import type { DiagSeverity } from './aiDiagnosis';

export interface TrimReading {
  stftPct: number | null;
  ltftPct: number | null;
  rpm: number | null;
  mafGs?: number | null;
}

export type TrimPattern =
  | 'ok'
  | 'lean'
  | 'rich'
  | 'vacuum_leak'
  | 'lean_all_speeds'
  | 'insufficient';

export interface FuelTrimResult {
  pattern: TrimPattern;
  idleTotalPct: number | null;
  holdTotalPct: number | null;
  severity: DiagSeverity;
  notes: string[];
}

export const TRIM_LIMIT_PCT = 10; // |STFT + LTFT| at or above this is out of range
export const VACUUM_LEAK_DROP_PCT = 5; // lean at idle that improves by at least this at 2500 rpm

const round1 = (x: number): number => Math.round(x * 10) / 10;

function totalTrim(r: TrimReading): number | null {
  if (r.stftPct == null || r.ltftPct == null) return null;
  return round1(r.stftPct + r.ltftPct);
}

function at(r: TrimReading, label: string): string {
  return r.rpm == null ? label : `${label} (${Math.round(r.rpm)} rpm)`;
}

export function assessFuelTrims(idle: TrimReading, hold: TrimReading | null): FuelTrimResult {
  const idleTotalPct = totalTrim(idle);
  const holdTotalPct = hold ? totalTrim(hold) : null;
  const notes: string[] = [];

  if (hold && holdTotalPct == null) {
    notes.push('Fuel trims at the rev hold not available (no data); hold part not judged.');
  }

  if (idleTotalPct == null) {
    notes.push('Fuel trims at idle not available (no data); not enough data for a verdict.');
    return { pattern: 'insufficient', idleTotalPct, holdTotalPct, severity: 'info', notes };
  }

  notes.push(`Total fuel trim ${idleTotalPct}% at ${at(idle, 'idle')}.`);
  if (hold && holdTotalPct != null) {
    notes.push(`Total fuel trim ${holdTotalPct}% at ${at(hold, 'rev hold')}.`);
  }

  const result = (pattern: TrimPattern, severity: DiagSeverity, note: string): FuelTrimResult => ({
    pattern,
    idleTotalPct,
    holdTotalPct,
    severity,
    notes: [...notes, note],
  });

  if (idleTotalPct >= TRIM_LIMIT_PCT) {
    // The drop check comes first: a large improvement at the hold is a vacuum leak even when the
    // hold total is still at or above the limit (idle +30.5% -> hold +12.5%).
    if (holdTotalPct != null && idleTotalPct - holdTotalPct >= VACUUM_LEAK_DROP_PCT) {
      return result(
        'vacuum_leak',
        'warn',
        `Lean at idle that improves by at least ${VACUUM_LEAK_DROP_PCT}% at the rev hold: typical of a vacuum leak (unmetered air matters most at idle).`,
      );
    }
    if (holdTotalPct != null && holdTotalPct >= TRIM_LIMIT_PCT) {
      return result(
        'lean_all_speeds',
        'warn',
        `Lean at idle and at the rev hold (both at or above +${TRIM_LIMIT_PCT}%, improving by less than ${VACUUM_LEAK_DROP_PCT}%): points at the MAF sensor or fuel delivery (pump, filter, injectors) rather than a vacuum leak.`,
      );
    }
    return result(
      'lean',
      'warn',
      `Lean at idle (total trim at or above +${TRIM_LIMIT_PCT}%)${holdTotalPct == null ? '; no rev-hold reading to tell a vacuum leak from a MAF or fuel-delivery fault' : ''}.`,
    );
  }

  if (
    idleTotalPct <= -TRIM_LIMIT_PCT ||
    (holdTotalPct != null && holdTotalPct <= -TRIM_LIMIT_PCT)
  ) {
    return result(
      'rich',
      'warn',
      `Rich (total trim at or below -${TRIM_LIMIT_PCT}%): the ECU is removing fuel; check for leaking injectors, high fuel pressure, a sticking purge valve or a biased sensor.`,
    );
  }

  if (holdTotalPct != null && holdTotalPct >= TRIM_LIMIT_PCT) {
    return result(
      'ok',
      'ok',
      `Idle trims within ±${TRIM_LIMIT_PCT}%; lean only at the rev hold, not judged as a fault on its own.`,
    );
  }
  return result('ok', 'ok', `Fuel trims within ±${TRIM_LIMIT_PCT}%.`);
}
