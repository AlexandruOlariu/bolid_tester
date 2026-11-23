import { useCallback, useEffect } from 'react';
import {
  isCan,
  isCan11,
  groupCandidatesByPair,
  scanTp20,
  buildTp20BusFromProfile,
  Elm327RawCanLink,
  probeTp20Capability,
  testerPresentBurst,
  functionalHeader,
  discoverUdsModules,
  discoveryCandidates,
  type DiscoveredModule,
  PROTOCOL_LABELS,
  type DiagnosticSession,
  type ProtocolId,
} from '@/shared/obd-core';
import { useSettingsStore } from '@/shared/state/settingsStore';
import { useSessionStore } from '@/shared/state/sessionStore';
import { logError } from '@/shared/state/errorLogStore';
import { useGarageStore } from '@/shared/state/garageStore';
import { diagModuleKey, isUserVehicleId, mergeModules, vehicleLabel } from '@/shared/vehicles';
import { useActiveProfile } from '@/features/vehicle-select/api/activeProfile';
import { scanModule, clearModule } from '../api/moduleScanService';
import { discoveredToModule } from '../api/discovery';
import { useModuleScanStore } from '../model/moduleScanStore';
import { useScanHistoryStore, buildSavedScan } from '../model/scanHistoryStore';
import { translate } from '@/shared/i18n';

/** Best-effort bus wake before a scan (roadmap 6b.10): a short functional TesterPresent (0x3E00)
 *  burst to nudge a parked VW bus awake so the first physically-addressed request doesn't time out.
 *  Fully swallowed — a sleeping bus, a clone that NAKs, or a header error must NEVER fail the scan
 *  that follows; bounded to ~1 s (3 frames × 150 ms + I/O). */
async function busWake(session: DiagnosticSession, proto: ProtocolId): Promise<void> {
  const fh = functionalHeader(proto);
  if (!fh) return;
  // Inside `exclusive`, like every block that re-addresses the adapter.
  await session.exclusive(async () => {
    try {
      await session.setHeader(fh);
      await testerPresentBurst((cmd) => session.send(cmd), { count: 3, gapMs: 150 });
    } catch {
      // best-effort — swallow everything.
    } finally {
      try {
        await session.resetAddressing();
      } catch {
        // ignore — the per-module loop re-addresses anyway.
      }
    }
  });
}

/** Why the TP2.0 gateway scan is unavailable over a link that cannot stream monitor mode. */
export const TP20_MONITOR_UNAVAILABLE =
  'The TP2.0 scan reads the bus in raw-CAN monitor mode, which a Classic Bluetooth adapter link ' +
  'cannot stream. Use a Bluetooth LE or Wi-Fi adapter for pre-UDS modules.';

/** Scan every profile-declared module (VCDS-style "auto-scan"): ident + per-module fault codes.
 *  CAN-only; K-line cars keep the engine-only Fault codes screen. */
export function useModuleScan() {
  const session = useSessionStore((s) => s.session);
  const profile = useActiveProfile();
  const store = useModuleScanStore();

  const modules = profile.modules ?? [];
  const proto = session?.currentProtocol ?? 'UNKNOWN';
  const available = !!session && modules.length > 0 && isCan(proto);
  const tp20Modules = modules.filter((m) => m.transport === 'tp20');
  const canScanTp20 = !!session && tp20Modules.length > 0 && isCan(proto);
  /** A real adapter runs TP2.0 over raw-CAN monitor mode (`ATMA`), which a Classic Bluetooth (SPP)
   *  link cannot stream (plan 27): the screen explains that instead of offering the scan. The
   *  simulator's in-memory bus needs no monitor. */
  const adapterSource = useSettingsStore((s) => s.adapterSource);
  const tp20MonitorUnavailable = !!session && adapterSource !== 'mock' && !session.canMonitor;
  /** Discovery needs only an 11-bit CAN link — it is how a car with no module list gets one. Not
   *  29-bit CAN / J1939: every candidate is an 11-bit id pair, and there is no functional header
   *  to restore `ATSH` to afterwards, so standard reads would break until reconnect. */
  const canDiscover = !!session && isCan11(proto);
  /** A garage car keeps discovered modules; a registry profile gets a literal to paste instead. */
  const isGarageCar = isUserVehicleId(profile.id);
  /** A discovery from another car (garage switch) or another connection is stale: never shown,
   *  never added to this car's module list, and dropped from the store. */
  const owner = store.discoveryOwner;
  const discoveryStale =
    !!store.discovery && (!owner || owner.profileId !== profile.id || owner.session !== session);
  const discovery = discoveryStale ? null : store.discovery;
  useEffect(() => {
    if (discoveryStale) useModuleScanStore.getState().setDiscovery(null);
  }, [discoveryStale]);

  const scanAll = useCallback(async () => {
    if (!session || !modules.length || useModuleScanStore.getState().running) return;
    store.setRunning(true);
    store.setResults([]);
    store.setProgress({ done: 0, total: modules.length });
    try {
      // Wake a possibly-asleep bus first (best-effort; never fails the scan).
      await busWake(session, proto);
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
      // Auto-save the completed scan (vehicle-keyed, incl. VIN when known) so it can be diffed
      // against a later scan, re-shared, or searched — the same history idiom historyStore uses.
      try {
        const st = useModuleScanStore.getState();
        const info = useSessionStore.getState().info;
        useScanHistoryStore.getState().saveScan(
          buildSavedScan({
            vehicle: { id: profile.id, label: vehicleLabel(profile), vin: info?.vin ?? null },
            protocol: PROTOCOL_LABELS[proto] ?? proto,
            results: st.results,
            tp20: st.tp20,
          }),
        );
      } catch (e) {
        logError({ source: 'module-scan/save', error: e, severity: 'warning' });
      }
    } finally {
      store.setProgress(null);
      store.setRunning(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- store methods are stable zustand actions; modules/proto derive from the listed session+profile (the memoised active profile, so editing a garage car re-creates this)
  }, [session, profile]);

  const clearOne = useCallback(
    /** `key` is `diagModuleKey(module)` — the address alone is ambiguous across transports. */
    async (key: string) => {
      const m = modules.find((x) => diagModuleKey(x) === key);
      if (!session || !m) return;
      store.setRunning(true);
      try {
        const result = await clearModule(session, m);
        store.upsertResult(result);
      } catch (e) {
        logError({ source: 'module-scan', error: e, severity: 'error', context: { module: key } });
      } finally {
        store.setRunning(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- store methods are stable zustand actions; modules derive from the listed session+profile (memoised active profile)
    [session, profile],
  );

  const scanGateway = useCallback(async () => {
    if (!session || !tp20Modules.length || useModuleScanStore.getState().running) return;
    // Simulator (mock adapter): drive the tested TP2.0 stack against an in-memory VW bus built
    // from the profile. Real hardware: raw-CAN over the live ELM327. Same scan code either way.
    const usingMock = useSettingsStore.getState().adapterSource === 'mock';
    // Raw CAN needs monitor mode; refuse before the adapter is reconfigured (SPP, plan 27).
    if (!usingMock && !session.canMonitor) {
      store.setTp20Error(TP20_MONITOR_UNAVAILABLE);
      return;
    }
    store.setRunning(true);
    store.setTp20Error(null);
    try {
      const wanted = tp20Modules
        .map((m) => m.tp20Address)
        .filter((a): a is number => a !== undefined);
      if (usingMock) {
        const bus = buildTp20BusFromProfile(profile);
        const result = await scanTp20(bus, { wanted, timeoutMs: 400 });
        store.setTp20(result);
        store.setTp20Error(result.gatewayError ?? null);
      } else {
        // Raw CAN reconfigures the adapter (monitor mode, its own ATSH / ATCRA per frame): the
        // whole probe + scan holds the session (`exclusive`), so no other addressed block (an AI
        // agent run's module reads, the live poll sweep) talks to the adapter meanwhile.
        await session.exclusive(async () => {
          // Capability probe first: a clone that can't do raw CAN (or a sleeping bus) fails in
          // ~1s here instead of burning a full scan's worth of timeouts.
          const probe = await probeTp20Capability(session.client);
          if (!probe.ok) {
            store.setTp20Error(translate('moduleScan:tp20.noTraffic'));
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
        });
      }
    } catch (e) {
      store.setTp20Error(e instanceof Error ? e.message : String(e));
      logError({ source: 'module-scan/tp20', error: e, severity: 'warning' });
    } finally {
      store.setRunning(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- store methods are stable zustand actions; tp20Modules derive from the listed session+profile (memoised active profile)
  }, [session, profile]);

  /** **Discover modules** (plan 25): probe the known VAG UDS id pairs (plus the profile's own) with
   *  `22 F187`, reading the ident of every module that answers. Read-only; addressing restored
   *  after each candidate. */
  const discover = useCallback(async () => {
    // `running` is read from the store, not the render: a double tap before the button re-renders
    // disabled must not start a second, overlapping discovery.
    if (!session || !isCan11(session.currentProtocol) || useModuleScanStore.getState().running)
      return;
    const candidates = discoveryCandidates(modules);
    store.setRunning(true);
    store.setDiscovery(null);
    // One probe per distinct id pair (08 / 46 share one), so that is the progress total.
    store.setDiscoveryProgress({ done: 0, total: groupCandidatesByPair(candidates).length });
    try {
      await busWake(session, proto);
      const found = await discoverUdsModules(session, candidates, {
        onProgress: (done, total) => store.setDiscoveryProgress({ done, total }),
      });
      store.setDiscovery(found, { profileId: profile.id, session });
      for (const f of found.filter((x) => x.state === 'error')) {
        logError({
          source: 'module-scan/discover',
          error: f.reason ?? 'discovery error',
          severity: 'warning',
          context: { address: f.candidate.address, header: f.candidate.reqHeader },
        });
      }
    } catch (e) {
      logError({ source: 'module-scan/discover', error: e, severity: 'warning' });
    } finally {
      store.setDiscoveryProgress(null);
      store.setRunning(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- store methods are stable zustand actions; modules/proto derive from the listed session+profile (memoised active profile)
  }, [session, profile]);

  /** Add a discovered module to the active garage car's module list (merged over its base). */
  const addDiscovered = useCallback(
    (d: DiscoveredModule) => {
      if (!isUserVehicleId(profile.id)) return;
      // Only a discovery made on this car and connection may write to its module list.
      const o = useModuleScanStore.getState().discoveryOwner;
      if (!o || o.profileId !== profile.id || o.session !== session) return;
      const garage = useGarageStore.getState();
      const car = garage.vehicles.find((v) => v.id === profile.id);
      if (!car) return;
      garage.update(car.id, { modules: mergeModules(car.modules ?? [], [discoveredToModule(d)]) });
    },
    [profile, session],
  );

  return {
    available,
    canScanTp20,
    tp20MonitorUnavailable,
    canDiscover,
    isGarageCar,
    discovery,
    modules,
    proto,
    scanAll,
    clearOne,
    scanGateway,
    discover,
    addDiscovered,
  };
}
