import { useEffect } from 'react';
import { useSessionStore } from '@/shared/state/sessionStore';
import { useSettingsStore } from '@/shared/state/settingsStore';
import { logError } from '@/shared/state/errorLogStore';
import { getVehicleProfile } from '@/shared/vehicles';
import { useVehicleStore } from '@/features/vehicle-select/model/vehicleStore';
import { useLiveDataStore } from '../model/liveDataStore';

// Dedupe repeated poll-loop errors so a persistent fault doesn't flood the capped error log.
let lastPollErrorMsg: string | null = null;

/** Round-robin poll the effective PID set into the live-data store while mounted. */
export function useLiveData() {
  const session = useSessionStore((s) => s.session);
  const selectedId = useVehicleStore((s) => s.selectedProfileId);
  const intervalMs = useSettingsStore((s) => s.pollIntervalMs);
  const values = useLiveDataStore((s) => s.values);
  const polling = useLiveDataStore((s) => s.polling);
  const setValues = useLiveDataStore((s) => s.setValues);
  const setPolling = useLiveDataStore((s) => s.setPolling);

  useEffect(() => {
    if (!session) return;
    const profile = getVehicleProfile(selectedId);
    const pids = session.effectivePids(profile.id === 'generic' ? undefined : profile.supportedPids);
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    setPolling(true);
    lastPollErrorMsg = null;

    const loop = async () => {
      if (cancelled) return;
      try {
        const snap = await session.pollOnce(pids);
        if (!cancelled) setValues(snap);
        lastPollErrorMsg = null;
      } catch (e) {
        // Transient read errors keep the loop going, but log the first of each distinct kind so a
        // persistent polling fault is visible in the error log without flooding it every interval.
        const msg = e instanceof Error ? e.message : String(e);
        if (msg !== lastPollErrorMsg) {
          lastPollErrorMsg = msg;
          logError({ source: 'live-data', error: e, severity: 'warning' });
        }
      }
      if (!cancelled) timer = setTimeout(loop, intervalMs);
    };
    loop();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      setPolling(false);
    };
  }, [session, selectedId, intervalMs, setValues, setPolling]);

  return { values, polling };
}
