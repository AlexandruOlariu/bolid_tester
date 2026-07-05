/** Guided-routine service: live interlock checks, start/stop with module addressing, keep-alive
 *  and live-value polling. Core UDS primitives live in obd-core/uds/guidedRoutine (unit-tested).
 *  SAFETY: see docs/features/routines.md — unlock + explicit confirm gated upstream. */

import {
  DiagnosticSession,
  startGuidedRoutine,
  stopGuidedRoutine,
  testerPresent,
  UdsError,
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
    security: routine.security,
  });
}

/** Turn a start failure into guidance the user can act on. Guided-routine IDs and any security
 *  requirement are per-ECU and, for the shipped profiles, unverified — so a negative response most
 *  often means "wrong ID for this car" or "this module wants security access", not a bug. Map the
 *  common ISO 14229 NRCs to that framing; fall back to the raw message otherwise. */
export function describeRoutineFailure(err: unknown, routine: GuidedRoutine): string {
  if (err instanceof UdsError && err.nrc !== undefined) {
    switch (err.nrc) {
      case 0x33: // securityAccessDenied
        return (
          `The ${routine.module} refused this ${routine.kind === 'outputTest' ? 'output test' : 'basic setting'} ` +
          'without security access (NRC 0x33). VAG basic settings usually need the ECU unlocked ' +
          '(UDS 0x27 seed/key), and this app does not carry the seed→key algorithm for your ECU. ' +
          'The routine cannot run until that algorithm is supplied for this profile.'
        );
      case 0x35: // invalidKey
        return 'Security unlock was rejected (NRC 0x35 invalid key) — the seed→key algorithm is wrong for this ECU.';
      case 0x36: // exceedNumberOfAttempts
        return 'Too many failed security-unlock attempts (NRC 0x36) — the module is locked out. Cycle the ignition and wait before retrying.';
      case 0x37: // requiredTimeDelayNotExpired
        return 'The module is enforcing a security lockout delay (NRC 0x37). Wait a moment and retry.';
      case 0x11: // serviceNotSupported
      case 0x12: // subFunctionNotSupported
      case 0x31: // requestOutOfRange
      case 0x7e: // subFunctionNotSupportedInActiveSession
      case 0x7f: // serviceNotSupportedInActiveSession
        return (
          `The ${routine.module} does not recognise this routine (id ${routine.id}, NRC 0x${err.nrc.toString(16)}). ` +
          'This routine ID is unverified for your exact car — it needs confirming from a VCDS "Basic Settings" ' +
          'session or a UDS capture on the real ECU before it will run.'
        );
      case 0x22: // conditionsNotCorrect
        return (
          `The ${routine.module} rejected the routine because conditions are not correct (NRC 0x22). ` +
          'The engine usually must be warm and at a steady idle with no active faults. Clear stored faults, ' +
          'let it reach operating temperature, and retry.'
        );
      case 0x24: // requestSequenceError
        return (
          `The ${routine.module} rejected the routine as out of sequence (NRC 0x24) — a required step ` +
          'is missing before it, most often a security-access unlock or a specific diagnostic ' +
          'session. The exact start sequence for this routine is unverified for your car and needs ' +
          'confirming from a VCDS session or a UDS capture.'
        );
      default:
        return err.message;
    }
  }
  return err instanceof Error ? err.message : String(err);
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
