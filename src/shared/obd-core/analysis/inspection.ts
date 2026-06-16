/** Pure "used-car inspection" assessment. Given a one-shot diagnostic snapshot (readiness monitors,
 *  DTCs by kind, freeze frame, VIN validity, distance since codes cleared) it produces a verdict with
 *  per-check detail. All standard OBD2 — no manufacturer access. See docs/features/used-car-inspection.md.
 *
 *  The headline check is the "recently-cleared" heuristic: a seller can clear fault codes right before
 *  a viewing, but that also resets the emissions readiness monitors, which then take a full drive cycle
 *  to re-complete. Many not-ready monitors + no stored codes + a tiny distance-since-clear is a classic
 *  tell that codes were wiped to hide a fault. */

import type { MonitorStatus } from '../obd/readiness';
import type { Dtc } from '../obd/dtc';

export interface InspectionInput {
  vinValid: boolean | null;
  readiness: MonitorStatus | null;
  stored: Dtc[];
  pending: Dtc[];
  permanent: Dtc[];
  freezeFramePresent?: boolean | null;
  /** Mode 01 PID 31 — distance travelled since DTCs were cleared (km), if available. */
  distanceSinceClearKm?: number | null;
}

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'info';

export interface InspectionCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
}

export type Verdict = 'pass' | 'caution' | 'fail';

export interface InspectionReport {
  verdict: Verdict;
  score: number; // 0–100
  checks: InspectionCheck[];
}

const PENALTY: Record<CheckStatus, number> = { pass: 0, info: 0, warn: 12, fail: 30 };

function notReadyCount(r: MonitorStatus): { notReady: number; supported: number } {
  const supported = r.monitors.filter((m) => m.supported);
  return { notReady: supported.filter((m) => !m.complete).length, supported: supported.length };
}

/** Assess a used-car snapshot. */
export function assessInspection(i: InspectionInput): InspectionReport {
  const checks: InspectionCheck[] = [];

  // Malfunction indicator lamp.
  if (i.readiness) {
    checks.push(
      i.readiness.milOn
        ? { id: 'mil', label: 'Check-engine light', status: 'fail', detail: 'MIL is ON — an emissions fault is currently stored.' }
        : { id: 'mil', label: 'Check-engine light', status: 'pass', detail: 'MIL is off.' },
    );
  } else {
    checks.push({ id: 'mil', label: 'Check-engine light', status: 'info', detail: 'Readiness not read.' });
  }

  // Stored / confirmed DTCs.
  checks.push(
    i.stored.length > 0
      ? { id: 'stored', label: 'Stored fault codes', status: 'fail', detail: `${i.stored.length} stored: ${i.stored.map((d) => d.code).join(', ')}` }
      : { id: 'stored', label: 'Stored fault codes', status: 'pass', detail: 'None stored.' },
  );

  // Permanent DTCs — cannot be cleared by a tool/battery pull; a real, current emissions fault.
  if (i.permanent.length > 0) {
    checks.push({ id: 'permanent', label: 'Permanent codes', status: 'fail', detail: `${i.permanent.length} permanent (uncleared): ${i.permanent.map((d) => d.code).join(', ')}` });
  }

  // Pending DTCs — maturing/intermittent.
  if (i.pending.length > 0) {
    checks.push({ id: 'pending', label: 'Pending codes', status: 'warn', detail: `${i.pending.length} pending (intermittent): ${i.pending.map((d) => d.code).join(', ')}` });
  }

  // Readiness + the "recently cleared" heuristic. The strong warning requires POSITIVE evidence — a
  // short distance since codes were cleared (PID 31). Many not-ready monitors on their own are NOT
  // proof of tampering (a recent battery disconnect does the same), so without that evidence we only
  // surface a neutral "not ready" note rather than implying a fault was hidden.
  if (i.readiness) {
    const { notReady, supported } = notReadyCount(i.readiness);
    const shortDistance = i.distanceSinceClearKm != null && i.distanceSinceClearKm <= 80;
    if (notReady >= 3 && i.stored.length === 0 && shortDistance) {
      checks.push({
        id: 'recently-cleared',
        label: 'Possible recent code clear',
        status: 'warn',
        detail: `${notReady}/${supported} monitors not ready and only ${Math.round(
          i.distanceSinceClearKm as number,
        )} km since codes were cleared — codes may have been cleared shortly before viewing. Re-check after a drive cycle.`,
      });
    } else {
      checks.push({
        id: 'readiness',
        label: 'Emissions readiness',
        status: notReady === 0 ? 'pass' : 'info',
        detail:
          notReady === 0
            ? 'All supported monitors complete.'
            : `${notReady}/${supported} monitors not yet complete — could be a recent battery disconnect or cleared codes; re-check after a drive cycle.`,
      });
    }
  }

  // Freeze frame indicates a fault was captured at some point.
  if (i.freezeFramePresent) {
    checks.push({ id: 'freeze', label: 'Freeze frame', status: 'info', detail: 'A freeze frame is present — a fault was recorded at some point.' });
  }

  // VIN read.
  if (i.vinValid === false) {
    checks.push({ id: 'vin', label: 'VIN', status: 'info', detail: 'VIN not reported by the ECU (common on older cars).' });
  }

  const score = Math.max(0, 100 - checks.reduce((s, c) => s + PENALTY[c.status], 0));
  const verdict: Verdict = checks.some((c) => c.status === 'fail')
    ? 'fail'
    : checks.some((c) => c.status === 'warn')
      ? 'caution'
      : 'pass';

  return { verdict, score, checks };
}
