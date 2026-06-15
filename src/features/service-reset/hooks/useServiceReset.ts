import { useCallback } from 'react';
import { serviceReset, isCan, isKLine } from '@/shared/obd-core';
import { useSessionStore } from '@/shared/state/sessionStore';
import { getVehicleProfile } from '@/shared/vehicles';
import { useVehicleStore } from '@/features/vehicle-select/model/vehicleStore';
import { useServiceResetStore } from '../model/serviceResetStore';

/** Run the profile's service-interval reset (cluster UDS routine/adaptation). CAN-only, gated. */
export function useServiceReset() {
  const session = useSessionStore((s) => s.session);
  const profileId = useVehicleStore((s) => s.selectedProfileId);
  const setRunning = useServiceResetStore((s) => s.setRunning);
  const setLastResult = useServiceResetStore((s) => s.setLastResult);

  const profile = getVehicleProfile(profileId);
  const descriptor = profile.serviceReset;
  const proto = session?.currentProtocol ?? 'UNKNOWN';
  // UDS descriptors need CAN; KWP descriptors need a K-line link.
  const transportOk = descriptor
    ? (descriptor.transport ?? 'uds') === 'kwp'
      ? isKLine(proto)
      : isCan(proto)
    : false;
  const available = !!descriptor && transportOk;

  const run = useCallback(async () => {
    if (!session || !descriptor) {
      setLastResult('Service reset is unavailable for this car / protocol.');
      return false;
    }
    setRunning(true);
    setLastResult(null);
    try {
      await session.setHeader(descriptor.reqHeader);
      if (descriptor.rxFilter) await session.setRxFilter(descriptor.rxFilter);
      const res = await serviceReset((cmd) => session.send(cmd), {
        transport: descriptor.transport,
        session: descriptor.session,
        method: descriptor.method,
        routineId: descriptor.routineId,
        adaptations: descriptor.adaptations,
        security: descriptor.security
          ? { level: descriptor.security.level, seedToKey: (s) => s }
          : undefined,
      });
      setLastResult(res.ok ? 'Service interval reset — confirm on the cluster.' : 'Reset did not complete.');
      return res.ok;
    } catch (e) {
      setLastResult(`Failed: ${(e as Error).message}`);
      return false;
    } finally {
      await session.setHeader(null);
      setRunning(false);
    }
  }, [session, descriptor, setRunning, setLastResult]);

  return { available, descriptor, run };
}
