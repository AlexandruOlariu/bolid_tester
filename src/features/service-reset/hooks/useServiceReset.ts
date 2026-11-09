import { useCallback } from 'react';
import {
  serviceReset,
  describeUnlockFailure,
  isCan,
  isKLine,
  isModuleUnreachableError,
} from '@/shared/obd-core';
import { useSessionStore } from '@/shared/state/sessionStore';
import { logError } from '@/shared/state/errorLogStore';
import { activeSeedKeyVehicleKeys, decideSecurity, resolveSeedKey } from '@/shared/security';
import { useActiveProfile } from '@/features/vehicle-select/api/activeProfile';
import { useServiceResetStore } from '../model/serviceResetStore';

/** Run the profile's service-interval reset (cluster UDS routine/adaptation). CAN-only, gated. */
export function useServiceReset() {
  const session = useSessionStore((s) => s.session);
  const profile = useActiveProfile();
  const setRunning = useServiceResetStore((s) => s.setRunning);
  const setLastResult = useServiceResetStore((s) => s.setLastResult);

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
    // SecurityAccess (plan 23): a `seedToKey` on the descriptor (tests / fakes only — no registry
    // profile sets one), else an installed plugin for the module; otherwise refuse before any bus
    // traffic. The screen leads with the manual procedure, which needs no unlock.
    const security = descriptor.security;
    const decision = decideSecurity(
      security,
      security
        ? security.seedToKey
          ? { entry: null, seedToKey: security.seedToKey }
          : await resolveSeedKey({
              reqHeader: descriptor.reqHeader,
              level: security.level,
              vehicleKeys: activeSeedKeyVehicleKeys(),
            })
        : null,
    );
    if (decision.kind === 'refuse') {
      const manual = descriptor.manualProcedure?.length
        ? ' Use the manual procedure below instead.'
        : '';
      setLastResult(decision.message + manual);
      return false;
    }
    setRunning(true);
    setLastResult(null);
    const transport = descriptor.transport ?? 'uds';
    try {
      await session.setHeader(descriptor.reqHeader);
      if (descriptor.rxFilter) await session.setRxFilter(descriptor.rxFilter);
      const res = await serviceReset((cmd) => session.send(cmd), {
        transport: descriptor.transport,
        session: descriptor.session,
        method: descriptor.method,
        routineId: descriptor.routineId,
        adaptations: descriptor.adaptations,
        security: decision.kind === 'unlock' ? decision.security : undefined,
      });
      if (!res.ok) {
        logError({
          source: 'service-reset',
          error: 'Reset did not complete (no positive response from module)',
          severity: 'warning',
          context: { transport, module: descriptor.module, method: descriptor.method },
        });
      }
      setLastResult(
        res.ok ? 'Service interval reset — confirm on the cluster.' : 'Reset did not complete.',
      );
      return res.ok;
    } catch (e) {
      const msg = (e as Error).message;
      // The target module never answered (No response / NO DATA / timeout / UNABLE TO CONNECT /
      // BUS INIT ERROR). On any transport this usually means the adapter cannot reach the module
      // (e.g. a KWP1281 cluster over a generic ELM327) — explain honestly instead of a bare failure.
      const moduleUnreachable = isModuleUnreachableError(msg);
      logError({
        source: 'service-reset',
        error: e,
        severity: moduleUnreachable ? 'warning' : 'error',
        context: { transport, module: descriptor.module, moduleUnreachable },
      });
      const manualHint = descriptor.manualProcedure?.length
        ? ' Use the manual procedure below instead.'
        : '';
      setLastResult(
        moduleUnreachable
          ? `${descriptor.module} did not respond (${msg}). ` +
              (descriptor.obdUnreachable ??
                'The adapter could not reach this module over the current link.') +
              manualHint
          : (describeUnlockFailure(e) ?? `Failed: ${msg}`),
      );
      return false;
    } finally {
      await session.resetAddressing();
      setRunning(false);
    }
  }, [session, descriptor, setRunning, setLastResult]);

  return { available, descriptor, run };
}
