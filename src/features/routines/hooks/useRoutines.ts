import { useCallback, useEffect, useRef } from 'react';
import { isCan } from '@/shared/obd-core';
import { useSessionStore } from '@/shared/state/sessionStore';
import { logError } from '@/shared/state/errorLogStore';
import { getVehicleProfile } from '@/shared/vehicles';
import type { GuidedRoutine } from '@/shared/vehicles';
import { useVehicleStore } from '@/features/vehicle-select/model/vehicleStore';
import {
  checkInterlocks,
  checkInterlocksDuringRun,
  describeRoutineFailure,
  hasInterlocks,
  startRoutine,
  stopRoutine,
  keepAlive,
  readLiveValues,
} from '../api/routineService';
import { useRoutinesStore } from '../model/routinesStore';

/** One periodic tick drives keep-alive, live values AND the interlock re-check, in that order —
 *  a single interval keeps the sequencing deterministic (no keep-alive racing an address switch). */
const TICK_MS = 1500;

/** Guided routines (output tests / basic settings): interlocks → start → tick (keep-alive + live
 *  values + interlock re-check, auto-stop on violation) → stop. One routine at a time; stop always
 *  restores default addressing. */
export function useRoutines() {
  const session = useSessionStore((s) => s.session);
  const profileId = useVehicleStore((s) => s.selectedProfileId);
  const store = useRoutinesStore();
  const timers = useRef<{ tick?: ReturnType<typeof setInterval> }>({});
  const ticking = useRef(false);

  const profile = getVehicleProfile(profileId);
  const routines = profile.routines ?? [];
  const available = !!session && routines.length > 0 && isCan(session?.currentProtocol ?? 'UNKNOWN');

  const clearTimers = () => {
    if (timers.current.tick) clearInterval(timers.current.tick);
    timers.current = {};
    ticking.current = false;
  };

  const stop = useCallback(
    async (routine: GuidedRoutine, finalPhase: 'done' | 'error' = 'done', message?: string) => {
      clearTimers();
      if (session) await stopRoutine(session, routine);
      store.setActive(null, finalPhase);
      store.setLiveValues([]);
      if (message) store.setMessage(message);
    },
    [session],
  );

  const start = useCallback(
    async (routine: GuidedRoutine) => {
      if (!session) return;
      if (!store.unlocked) {
        store.setMessage('Locked — enable the routines unlock first.');
        return;
      }
      store.setMessage(null);
      store.setActive(routine.id, 'checking');
      store.setInterlockFailures([]);
      try {
        const check = await checkInterlocks(session, routine);
        if (!check.ok) {
          store.setInterlockFailures(check.failures);
          store.setActive(null, 'blocked');
          return;
        }
        await startRoutine(session, routine);
        store.setActive(routine.id, 'running');
        store.setMessage(
          routine.service === '2F'
            ? 'Output under test — stop to return control to the ECU.'
            : 'Routine started.',
        );
        timers.current.tick = setInterval(async () => {
          if (ticking.current) return; // previous tick still on the wire (slow BLE) — skip
          ticking.current = true;
          try {
            await keepAlive(session).catch(() => undefined);
            const values = await readLiveValues(session, routine, profile.extendedPids ?? []);
            store.setLiveValues(values);
            // SAFETY: interlocks hold for the routine's whole life, not just its start — someone
            // starting the engine or moving off mid-test must stop it.
            if (hasInterlocks(routine)) {
              const check = await checkInterlocksDuringRun(session, routine);
              if (!check.ok) {
                store.setInterlockFailures(check.failures);
                await stop(routine, 'error', `Stopped — interlock violated: ${check.failures[0]}`);
              }
            }
          } catch {
            // transient read errors are tolerated; the next tick retries
          } finally {
            ticking.current = false;
          }
        }, TICK_MS);
      } catch (e) {
        logError({ source: 'routines', error: e, context: { routine: routine.name, id: routine.id } });
        await stop(routine, 'error', describeRoutineFailure(e, routine));
      }
    },
    [session, store.unlocked, profileId, stop],
  );

  // Safety: never leave a routine running when the screen unmounts.
  useEffect(() => {
    return () => {
      const active = useRoutinesStore.getState().activeId;
      if (active && session) {
        const routine = routines.find((r) => r.id === active);
        if (routine) void stopRoutine(session, routine);
      }
      clearTimers();
    };
  }, [session, profileId]);

  return { available, routines, start, stop };
}
