import { useCallback } from 'react';
import { serviceReset, isCan, isKLine } from '@/shared/obd-core';
import { useSessionStore } from '@/shared/state/sessionStore';
import { logInfo, logError } from '@/shared/state/eventLog';
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
    logInfo(
      'service-reset',
      `start: ${descriptor.method} on ${descriptor.module} (${descriptor.transport ?? 'uds'}, ` +
        `header ${descriptor.reqHeader})`,
    );
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
      if (res.ok) logInfo('service-reset', 'ok: module accepted the reset');
      else logError('service-reset', 'reset did not complete');
      setLastResult(res.ok ? 'Service interval reset — confirm on the cluster.' : 'Reset did not complete.');
      return res.ok;
    } catch (e) {
      const msg = (e as Error).message;
      logError('service-reset', `failed: ${msg}`);
      // On a K-line car the target is the instrument cluster, which a generic ELM327 cannot reach
      // over the engine diagnostic channel — the cluster never answers ("No response"). Explain this
      // honestly and point to the manual procedure instead of a bare failure.
      const clusterUnreachable =
        (descriptor.transport ?? 'uds') === 'kwp' && /no response|timeout|no data/i.test(msg);
      setLastResult(
        clusterUnreachable
          ? 'The instrument cluster did not respond. A generic ELM327 can only reach the engine ' +
              'ECU on this car, so it cannot perform this reset over OBD. Use the manual dash-stalk ' +
              'procedure below instead.'
          : `Failed: ${msg}`,
      );
      return false;
    } finally {
      await session.setHeader(null);
      setRunning(false);
    }
  }, [session, descriptor, setRunning, setLastResult]);

  return { available, descriptor, run };
}
