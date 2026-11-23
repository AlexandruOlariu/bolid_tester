/** Pure MAP-only boost check for the diagnostic agent's boost procedure. Takes the intake manifold
 *  pressure (PID 010B) at idle and, optionally, the highest reading during a stationary rev hold,
 *  and judges both against barometric pressure (PID 0133, or `ASSUMED_BARO_KPA` when the car has no
 *  0133) and the car's expected range (`VehicleProfile.boost`). MAP and baro are standard PIDs, so
 *  an unconfirmed range is said in the notes but never caps a finding. A missing value is never
 *  judged: no idle MAP yields `insufficient`, a missing hold value leaves the hold part out. With
 *  the baro assumed (no 0133), the real baro is lower at altitude, so MAP below the assumed baro is
 *  not judged (`map_below_baro` needs a measured baro) and the hold is judged on its rise over the
 *  idle MAP (a diesel's idle MAP sits close to baro) instead of over the assumed baro. No device
 *  I/O. `notes` are English and model-facing. See docs/features/ai-diagnose.md. */

import type { BoostRange } from '../../vehicles/types';
import type { DiagSeverity } from './aiDiagnosis';

export const ASSUMED_BARO_KPA = 101.3;
export const STUCK_VNT_IDLE_KPA = 30; // spec: "> 30 kPa at idle points to a stuck VNT"
export const MAP_BELOW_BARO_KPA = -10;
export const STUCK_SENSOR_KPA = 2;
/** Rpm rise from idle to the hold that makes an unchanged MAP a stuck sensor. */
const STUCK_SENSOR_RPM_RISE = 1000;

export interface BoostInput {
  idleMapKpa: number | null;
  idleRpm: number | null;
  holdMapKpa: number | null;
  holdMaxRpm: number | null;
  baroKpa: number | null;
}

export type BoostFindingId =
  | 'ok'
  | 'idle_high'
  | 'stuck_vnt'
  | 'map_below_baro'
  | 'no_boost_hold'
  | 'overboost_hold'
  | 'stuck_sensor'
  | 'hold_not_reached'
  | 'insufficient';

export interface BoostResult {
  findings: { id: BoostFindingId; severity: DiagSeverity }[];
  idleDeltaKpa: number | null;
  holdDeltaKpa: number | null;
  baroAssumed: boolean;
  notes: string[];
}

const round1 = (x: number): number => Math.round(x * 10) / 10;

const span = ([lo, hi]: [number, number]): string => `${lo} to ${hi} kPa`;

export function assessBoost(input: BoostInput, range: BoostRange): BoostResult {
  const baroAssumed = input.baroKpa == null;
  const baro = input.baroKpa ?? ASSUMED_BARO_KPA;
  const idleDeltaKpa = input.idleMapKpa == null ? null : round1(input.idleMapKpa - baro);
  // Baro assumed: the hold is judged on its rise over the idle MAP, not on the assumed baro.
  const holdDeltaKpa =
    input.holdMapKpa == null
      ? null
      : baroAssumed
        ? input.idleMapKpa == null
          ? null
          : round1(input.holdMapKpa - input.idleMapKpa)
        : round1(input.holdMapKpa - baro);
  const findings: BoostResult['findings'] = [];
  const notes: string[] = [];

  notes.push(
    baroAssumed
      ? `No barometric pressure PID (0133): baro assumed ${ASSUMED_BARO_KPA} kPa.`
      : `Barometric pressure ${baro} kPa.`,
  );
  if (!range.confirmed) {
    notes.push('Boost expected range not yet confirmed on this car (initial values).');
  }

  if (input.idleMapKpa == null || idleDeltaKpa == null) {
    notes.push('MAP at idle not available (no data); not enough data for a verdict.');
    return {
      findings: [{ id: 'insufficient', severity: 'info' }],
      idleDeltaKpa,
      holdDeltaKpa,
      baroAssumed,
      notes,
    };
  }

  // Idle part.
  const idleAt = input.idleRpm == null ? 'idle' : `idle (${Math.round(input.idleRpm)} rpm)`;
  notes.push(
    `MAP ${input.idleMapKpa} kPa at ${idleAt}: ${idleDeltaKpa} kPa over baro (expected ${span(range.idleDeltaKpa)}).`,
  );
  if (idleDeltaKpa < MAP_BELOW_BARO_KPA && baroAssumed) {
    notes.push(
      `MAP more than ${-MAP_BELOW_BARO_KPA} kPa below the assumed baro at idle: baro is unknown (it is lower at altitude), so this is not judged.`,
    );
  } else if (idleDeltaKpa < MAP_BELOW_BARO_KPA) {
    findings.push({ id: 'map_below_baro', severity: 'warn' });
    notes.push(
      `MAP more than ${-MAP_BELOW_BARO_KPA} kPa below baro at idle: implausible for a diesel; suspect the MAP sensor or its wiring.`,
    );
  } else if (idleDeltaKpa > STUCK_VNT_IDLE_KPA) {
    findings.push({ id: 'stuck_vnt', severity: 'warn' });
    notes.push(
      `More than ${STUCK_VNT_IDLE_KPA} kPa of boost at idle: points to a stuck (closed) VNT / variable vanes.`,
    );
  } else if (idleDeltaKpa > range.idleDeltaKpa[1]) {
    findings.push({ id: 'idle_high', severity: 'info' });
    notes.push('Idle boost above the expected range, but not high enough to suggest a stuck VNT.');
  }

  // Hold part.
  const holdAttempted = input.holdMapKpa != null || input.holdMaxRpm != null;
  if (!holdAttempted) {
    notes.push('No rev-hold reading; idle part only.');
  } else if (input.holdMaxRpm != null && input.holdMaxRpm < range.minHoldRpm) {
    findings.push({ id: 'hold_not_reached', severity: 'info' });
    notes.push(
      `Boost: rev hold not reached (max ${Math.round(input.holdMaxRpm)} rpm); needs ${range.minHoldRpm} rpm, hold part not judged.`,
    );
  } else if (input.holdMapKpa == null || holdDeltaKpa == null) {
    notes.push('MAP at the rev hold not available (no data); hold part not judged.');
  } else if (input.holdMaxRpm == null) {
    notes.push('Rpm at the rev hold not available (no data); hold part not judged.');
  } else {
    notes.push(
      baroAssumed
        ? `MAP ${input.holdMapKpa} kPa at the rev hold (max ${Math.round(input.holdMaxRpm)} rpm): ${holdDeltaKpa} kPa over the idle MAP, judged as over baro since baro is unknown (expected ${span(range.holdDeltaKpa)}).`
        : `MAP ${input.holdMapKpa} kPa at the rev hold (max ${Math.round(input.holdMaxRpm)} rpm): ${holdDeltaKpa} kPa over baro (expected ${span(range.holdDeltaKpa)}).`,
    );
    const rpmRise = input.idleRpm == null ? null : input.holdMaxRpm - input.idleRpm;
    if (
      rpmRise != null &&
      rpmRise >= STUCK_SENSOR_RPM_RISE &&
      Math.abs(input.holdMapKpa - input.idleMapKpa) < STUCK_SENSOR_KPA
    ) {
      findings.push({ id: 'stuck_sensor', severity: 'warn' });
      notes.push(
        `MAP changed by less than ${STUCK_SENSOR_KPA} kPa while rpm rose by ${Math.round(rpmRise)}: the MAP reading looks stuck; check the sensor before judging boost.`,
      );
    } else if (holdDeltaKpa < range.holdDeltaKpa[0]) {
      findings.push({ id: 'no_boost_hold', severity: 'warn' });
      notes.push(
        'Boost at the rev hold below the expected range: look for a boost leak, a sticking VNT / vane actuator or a vacuum supply fault.',
      );
    } else if (holdDeltaKpa > range.holdDeltaKpa[1]) {
      findings.push({ id: 'overboost_hold', severity: 'warn' });
      notes.push(
        'Boost at the rev hold above the expected range: overboost; suspect a sticking VNT or its control (N75 valve).',
      );
    }
  }

  if (findings.length === 0) findings.push({ id: 'ok', severity: 'ok' });
  return { findings, idleDeltaKpa, holdDeltaKpa, baroAssumed, notes };
}
