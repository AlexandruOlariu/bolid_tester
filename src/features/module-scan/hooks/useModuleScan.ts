import { useCallback } from 'react';
import {
  isCan,
  scanTp20,
  buildTp20BusFromProfile,
  Elm327RawCanLink,
  probeTp20Capability,
} from '@/shared/obd-core';
import { useSettingsStore } from '@/shared/state/settingsStore';
import { useSessionStore } from '@/shared/state/sessionStore';
import { logError } from '@/shared/state/errorLogStore';
import { getVehicleProfile } from '@/shared/vehicles';
import { useVehicleStore } from '@/features/vehicle-select/model/vehicleStore';
import { scanModule, clearModule } from '../api/moduleScanService';
import { useModuleScanStore } from '../model/moduleScanStore';

/** Scan every profile-declared module (VCDS-style "auto-scan"): ident + per-module fault codes.
 *  CAN-only; K-line cars keep the engine-only Fault codes screen. */
export function useModuleScan() {
  const session = useSessionStore((s) => s.session);
  const profileId = useVehicleStore((s) => s.selectedProfileId);
  const store = useModuleScanStore();

  const profile = getVehicleProfile(profileId);
  const modules = profile.modules ?? [];
  const proto = session?.currentProtocol ?? 'UNKNOWN';
  const available = !!session && modules.length > 0 && isCan(proto);
  const tp20Modules = modules.filter((m) => m.transport === 'tp20');
  const canScanTp20 = !!session && tp20Modules.length > 0 && isCan(proto);

  const scanAll = useCallback(async () => {
    if (!session || !modules.length) return;
    store.setRunning(true);
    store.setResults([]);
    store.setProgress({ done: 0, total: modules.length });
    try {
      for (let i = 0; i < modules.length; i++) {
        const result = await scanModule(session, modules[i]);
        store.upsertResult(result);
        store.setProgress({ done: i + 1, total: modules.length });
        if (result.state === 'error') {
          logError({
            source: 'module-scan',
            error: result.reason ?? 'scan error',
            severity: 'warning',
            context: { module: modules[i].name, address: modules[i].address },
          });
        }
      }
      store.setLastScanTs(Date.now());
    } finally {
      store.setProgress(null);
      store.setRunning(false);
    }
  }, [session, profileId]);

  const clearOne = useCallback(
    async (address: string) => {
      const m = modules.find((x) => x.address === address);
      if (!session || !m) return;
      store.setRunning(true);
      try {
        const result = await clearModule(session, m);
        store.upsertResult(result);
      } catch (e) {
        logError({ source: 'module-scan', error: e, severity: 'error', context: { address } });
      } finally {
        store.setRunning(false);
      }
    },
    [session, profileId],
  );

  const scanGateway = useCallback(async () => {
    if (!session || !tp20Modules.length) return;
    store.setRunning(true);
    store.setTp20Error(null);
    try {
      // Simulator (mock adapter): drive the tested TP2.0 stack against an in-memory VW bus built
      // from the profile. Real hardware: raw-CAN over the live ELM327. Same scan code either way.
      const usingMock = useSettingsStore.getState().adapterSource === 'mock';
      const wanted = tp20Modules
        .map((m) => m.tp20Address)
        .filter((a): a is number => a !== undefined);
      if (usingMock) {
        const bus = buildTp20BusFromProfile(profile);
        const result = await scanTp20(bus, { wanted, timeoutMs: 400 });
        store.setTp20(result);
        store.setTp20Error(result.gatewayError ?? null);
      } else {
        // Capability probe first: a clone that can't do raw CAN (or a sleeping bus) fails in
        // ~1s here instead of burning a full scan's worth of timeouts.
        const probe = await probeTp20Capability(session.client);
        if (!probe.ok) {
          store.setTp20Error(
            'No raw-CAN traffic seen — this adapter may not support TP2.0 (many clones), or the ' +
              'bus is asleep. Check ignition and try again.',
          );
          return;
        }
        const link = new Elm327RawCanLink(session.client);
        await link.begin();
        try {
          const result = await scanTp20(link, { wanted, timeoutMs: 1500 });
          store.setTp20(result);
          store.setTp20Error(result.gatewayError ?? null);
        } finally {
          await link.end();
        }
      }
    } catch (e) {
      store.setTp20Error(e instanceof Error ? e.message : String(e));
      logError({ source: 'module-scan/tp20', error: e, severity: 'warning' });
    } finally {
      store.setRunning(false);
    }
  }, [session, profileId]);

  return { available, canScanTp20, modules, proto, scanAll, clearOne, scanGateway };
}
