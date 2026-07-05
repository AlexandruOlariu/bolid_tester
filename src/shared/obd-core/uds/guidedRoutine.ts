/** Guided routines: UDS output tests (0x2F InputOutputControlByIdentifier) and basic settings
 *  (0x31 RoutineControl) with start/stop/results primitives. Pure over UdsSend; the feature layer
 *  adds interlocks, keep-alive and live values. SAFETY: gated upstream like coding — see
 *  docs/features/routines.md. */

import {
  UdsSend,
  UdsError,
  checkNegative,
  enterSession,
  hexBytes as hex,
  routineControl,
  securityAccess,
} from '../coding/udsCoding';

/** 0x2F <did> 0x03 <data> — shortTermAdjustment: force an output to the given state. */
export async function startOutputControl(
  send: UdsSend,
  did: string,
  controlData: number[] = [],
): Promise<void> {
  checkNegative(0x2f, await send('2F' + did + '03' + hex(controlData)));
}

/** 0x2F <did> 0x00 — returnControlToECU: release the output. */
export async function stopOutputControl(send: UdsSend, did: string): Promise<void> {
  checkNegative(0x2f, await send('2F' + did + '00'));
}

export interface GuidedRoutineDescriptor {
  service: '2F' | '31';
  /** RoutineControl id (31) or IO control DID (2F), 4 hex chars. */
  id: string;
  controlData?: number[];
  /** Diagnostic session to enter first (default 0x03 extended). */
  session?: number;
  /** SecurityAccess to perform after the session, before the routine. Only run when a `seedToKey`
   *  algorithm is supplied — the `level` alone (as a profile may declare) is not enough to unlock,
   *  so without the algorithm the routine is attempted unlocked and the ECU decides (NRC 0x33 if it
   *  needed access). See docs/features/routines.md. */
  security?: { level: number; seedToKey?: (seed: number[]) => number[] };
}

/** Enter the diagnostic session, optionally unlock (SecurityAccess), then start the routine /
 *  output control. */
export async function startGuidedRoutine(
  send: UdsSend,
  d: GuidedRoutineDescriptor,
): Promise<void> {
  await enterSession(send, d.session ?? 0x03);
  if (d.security?.seedToKey) {
    await securityAccess(send, d.security.level, d.security.seedToKey);
  }
  if (d.service === '31') await routineControl(send, 0x01, d.id, d.controlData ?? []);
  else await startOutputControl(send, d.id, d.controlData ?? []);
}

/** Stop tolerantly — a stop after the module already finished must not surface as an error. */
export async function stopGuidedRoutine(send: UdsSend, d: GuidedRoutineDescriptor): Promise<void> {
  try {
    if (d.service === '31') await routineControl(send, 0x02, d.id);
    else await stopOutputControl(send, d.id);
  } catch {
    // best-effort stop
  }
}

/** 0x31 0x03 requestRoutineResults (31-routines only). Returns raw result bytes after the echo. */
export async function guidedRoutineResults(
  send: UdsSend,
  d: GuidedRoutineDescriptor,
): Promise<number[]> {
  if (d.service !== '31') throw new UdsError('Results are only defined for RoutineControl routines');
  const res = await routineControl(send, 0x03, d.id);
  return res.slice(2 + d.id.length / 2);
}
