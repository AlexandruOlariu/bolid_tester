import { useEffect } from 'react';
import { useSessionStore } from '@/shared/state/sessionStore';
import { useSettingsStore } from '@/shared/state/settingsStore';
import { getVehicleProfile } from '@/shared/vehicles';
import { useVehicleStore } from '@/features/vehicle-select/model/vehicleStore';
import { useLiveDataStore } from '../model/liveDataStore';

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

    const loop = async () => {
      if (cancelled) return;
      try {
        const snap = await session.pollOnce(pids);
        if (!cancelled) setValues(snap);
      } catch {
        // transient read errors are ignored; the loop keeps going
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
