import { useEffect, useRef } from 'react';
import { useSessionStore } from '@/shared/state/sessionStore';
import { getVehicleProfile } from '@/shared/vehicles';
import { useVehicleStore } from '@/features/vehicle-select/model/vehicleStore';
import { useLiveDataStore } from '../model/liveDataStore';

// Unique subscriber id per hook instance so two mounted screens don't clobber each other's
// registration (and releasing one never releases the other).
let nextRegId = 0;

/** Subscribe a screen to live data. The app-wide poll loop lives in EngineHost; this hook only
 *  (a) registers the screen's PID interest so those PIDs get polled while it is mounted, and
 *  (b) reads the latest values/polling flag from the shared store. Mounting it in several screens
 *  no longer spawns several loops — the union is polled once per interval by EngineHost.
 *
 *  Pass `pids` to register an explicit set (e.g. the Dashboard's customized/visible items) instead of
 *  the whole effective PID set — the poll loop then reads only what the screen actually shows. Omit it
 *  to register the effective PID set (the default for every other screen). */
export function useLiveData(pids?: string[]) {
  const session = useSessionStore((s) => s.session);
  const selectedId = useVehicleStore((s) => s.selectedProfileId);
  const values = useLiveDataStore((s) => s.values);
  const polling = useLiveDataStore((s) => s.polling);
  const acquire = useLiveDataStore((s) => s.acquire);
  const idRef = useRef<string>(`live-data-${nextRegId++}`);
  // Stable dependency for an explicit PID set so the effect only re-registers when it truly changes.
  const pidKey = pids ? pids.join(',') : null;

  useEffect(() => {
    if (!session) return;
    let wanted: string[];
    if (pidKey !== null) {
      wanted = pidKey.length > 0 ? pidKey.split(',') : [];
    } else {
      const profile = getVehicleProfile(selectedId);
      wanted = session.effectivePids(profile.id === 'generic' ? undefined : profile.supportedPids);
    }
    return acquire(idRef.current, wanted);
  }, [session, selectedId, acquire, pidKey]);

  return { values, polling };
}
