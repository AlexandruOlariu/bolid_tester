/** Guided-routine service: live interlock checks, start/stop with module addressing, keep-alive
 *  and live-value polling. Core UDS primitives live in obd-core/uds/guidedRoutine (unit-tested).
 *  SAFETY: see docs/features/routines.md — unlock + explicit confirm gated upstream. */

import {
  DiagnosticSession,
  describeUnlockFailure,
  startGuidedRoutine,
  stopGuidedRoutine,
  testerPresent,
  UdsError,
} from '@/shared/obd-core';
import type { GuidedRoutine, ExtendedPid } from '@/shared/vehicles';
import { translate } from '@/shared/i18n';

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
    if (rpm === null) failures.push(translate('routines:interlock.rpmUnreadable'));
    else if (rpm > 0)
      failures.push(translate('routines:interlock.engineOff', { rpm: Math.round(rpm) }));
  }
  if (il.requireIdle) {
    if (rpm === null || rpm < 400) failures.push(translate('routines:interlock.engineRunning'));
    else if (rpm > 1200)
      failures.push(translate('routines:interlock.engineIdle', { rpm: Math.round(rpm) }));
  }
  if (il.maxSpeedKmh !== undefined) {
    if (speed === null) failures.push(translate('routines:interlock.speedUnreadable'));
    else if (speed > il.maxSpeedKmh) {
      failures.push(translate('routines:interlock.stationary', { speed: Math.round(speed) }));
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

export interface StartRoutineOptions {
  /** SecurityAccess routine from an installed plugin (plan 23) for a routine with `security`. */
  seedToKey?: (seed: number[]) => number[];
}

/** Address the module and start the routine. With `security` and a resolved plugin routine the
 *  module is unlocked first (`27`); with `security` and none the routine is still attempted
 *  unlocked — routines are read-ish and the module decides (NRC 0x33 if it needed access, which
 *  `describeRoutineFailure` explains). */
export async function startRoutine(
  session: DiagnosticSession,
  routine: GuidedRoutine,
  opts: StartRoutineOptions = {},
): Promise<void> {
  await session.setHeader(routine.reqHeader);
  await session.setRxFilter(routine.rxFilter);
  const seedToKey = opts.seedToKey ?? routine.security?.seedToKey;
  await startGuidedRoutine((cmd) => session.send(cmd), {
    service: routine.service,
    id: routine.id,
    controlData: routine.controlData,
    session: routine.session,
    security: routine.security
      ? { level: routine.security.level, ...(seedToKey ? { seedToKey } : {}) }
      : undefined,
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
        return translate('routines:failure.nrc33', {
          module: routine.module,
          kind: translate(
            routine.kind === 'outputTest'
              ? 'routines:kind.outputTest'
              : 'routines:kind.basicSetting',
          ),
        });
      case 0x35: // invalidKey
        return translate('routines:failure.nrc35');
      case 0x36: // exceedNumberOfAttempts
      case 0x37: // requiredTimeDelayNotExpired
        return describeUnlockFailure(err) ?? err.message;
      case 0x11: // serviceNotSupported
      case 0x12: // subFunctionNotSupported
      case 0x31: // requestOutOfRange
      case 0x7e: // subFunctionNotSupportedInActiveSession
      case 0x7f: // serviceNotSupportedInActiveSession
        return translate('routines:failure.unknownId', {
          module: routine.module,
          id: routine.id,
          nrc: err.nrc.toString(16),
        });
      case 0x22: // conditionsNotCorrect
        return translate('routines:failure.nrc22', { module: routine.module });
      case 0x24: // requestSequenceError
        return translate('routines:failure.nrc24', { module: routine.module });
      default:
        return err.message;
    }
  }
  return err instanceof Error ? err.message : String(err);
}

/** Stop + always restore default addressing (header AND rx filter), even when the stop fails. */
export async function stopRoutine(
  session: DiagnosticSession,
  routine: GuidedRoutine,
): Promise<void> {
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
