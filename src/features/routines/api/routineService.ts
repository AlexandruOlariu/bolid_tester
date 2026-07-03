/** Guided-routine service: live interlock checks, start/stop with module addressing, keep-alive
 *  and live-value polling. Core UDS primitives live in obd-core/uds/guidedRoutine (unit-tested).
 *  SAFETY: see docs/features/routines.md — unlock + explicit confirm gated upstream. */

import {
  DiagnosticSession,
  startGuidedRoutine,
  stopGuidedRoutine,
  testerPresent,
} from '@/shared/obd-core';
import type { GuidedRoutine, ExtendedPid } from '@/shared/vehicles';

export interface InterlockCheck {
  ok: boolean;
  failures: string[];
}

/** True when the routine declares at least one live interlock. */
export function hasInterlocks(routine: GuidedRoutine): boolean {
  const il = routine.interlocks;
  return !!il && (!!il.requireEngineOff || !!il.requireIdle || il.maxSpeedKmh !== undefined);
}

/** Check the routine's interlocks from live data (standard Mode 01 — works on every car).
 *  FAIL CLOSED: a rule whose live value cannot be read blocks the routine — an unreadable RPM
 *  must never let an "engine off only" output test run. */
export async function checkInterlocks(
  session: DiagnosticSession,
  routine: GuidedRoutine,
): Promise<InterlockCheck> {
  const failures: string[] = [];
  const il = routine.interlocks;
  const needRpm = !!il.requireEngineOff || !!il.requireIdle;
  const needSpeed = il.maxSpeedKmh !== undefined;
  const rpm = needRpm ? ((await session.readValue('010C'))?.value ?? null) : null;
  const speed = needSpeed ? ((await session.readValue('010D'))?.value ?? null) : null;

  if (il.requireEngineOff) {
    if (rpm === null) failures.push('Cannot verify the engine is off — RPM is unreadable.');
    else if (rpm > 0) failures.push(`Engine must be OFF (ignition on) — currently ${Math.round(rpm)} rpm.`);
  }
  if (il.requireIdle) {
    if (rpm === null || rpm < 400) failures.push('Engine must be RUNNING at idle.');
    else if (rpm > 1200) failures.push(`Engine must idle — currently ${Math.round(rpm)} rpm.`);
  }
  if (il.maxSpeedKmh !== undefined) {
    if (speed === null) failures.push('Cannot verify the vehicle is stationary — speed is unreadable.');
    else if (speed > il.maxSpeedKmh) {
      failures.push(`Vehicle must be stationary — currently ${Math.round(speed)} km/h.`);
    }
  }
  return { ok: failures.length === 0, failures };
}

/** Re-check interlocks WHILE a routine runs. The adapter is addressed at the routine's module;
 *  Mode 01 lives at the functional address — switch there and back around the reads. Callers run
 *  this from the same periodic tick as the keep-alive (the client's command queue serializes the
 *  switch, so no foreign frame lands mid-request). */
export async function checkInterlocksDuringRun(
  session: DiagnosticSession,
  routine: GuidedRoutine,
): Promise<InterlockCheck> {
  await session.resetAddressing();
  try {
    return await checkInterlocks(session, routine);
  } finally {
    await session.setHeader(routine.reqHeader);
    await session.setRxFilter(routine.rxFilter);
  }
}

export async function startRoutine(session: DiagnosticSession, routine: GuidedRoutine): Promise<void> {
  await session.setHeader(routine.reqHeader);
  await session.setRxFilter(routine.rxFilter);
  await startGuidedRoutine((cmd) => session.send(cmd), {
    service: routine.service,
    id: routine.id,
    controlData: routine.controlData,
    session: routine.session,
  });
}

/** Stop + always restore default addressing (header AND rx filter), even when the stop fails. */
export async function stopRoutine(session: DiagnosticSession, routine: GuidedRoutine): Promise<void> {
  try {
    await stopGuidedRoutine((cmd) => session.send(cmd), {
      service: routine.service,
      id: routine.id,
    });
  } finally {
    await session.resetAddressing();
  }
}

export async function keepAlive(session: DiagnosticSession): Promise<void> {
  await testerPresent((cmd) => session.send(cmd));
}

/** Read the routine's live DIDs (profile extendedPids), decoded. */
export async function readLiveValues(
  session: DiagnosticSession,
  routine: GuidedRoutine,
  extendedPids: ExtendedPid[],
): Promise<{ name: string; value: number; unit: string }[]> {
  const out: { name: string; value: number; unit: string }[] = [];
  for (const did of routine.liveDids ?? []) {
    const pid = extendedPids.find((e) => e.did === did);
    if (!pid) continue;
    try {
      const raw = await session.readExtended(did);
      if (raw) out.push({ name: pid.name, value: pid.decode(raw), unit: pid.unit });
    } catch {
      // live values are best-effort while a routine runs
    }
  }
  return out;
}
