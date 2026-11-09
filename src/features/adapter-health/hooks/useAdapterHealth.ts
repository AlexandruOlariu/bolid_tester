import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { useSessionStore } from '@/shared/state/sessionStore';
import { useLinkStore } from '@/shared/state/linkStore';
import { getActiveProfile } from '@/shared/state/activeProfile';
import { curatedProfileId } from '@/shared/vehicles';
import { logError } from '@/shared/state/errorLogStore';
import { APP_VERSION } from '@/shared/lib/appInfo';
import { fileStamp, saveTextFile } from '@/shared/lib/saveFile';
import { DEFAULT_BURST, runHealthCheck } from '../api/runHealthCheck';
import { formatAdapterReport } from '../api/adapterReport';
import {
  buildAdapterReportJson,
  reportFileName,
  reportLinkFor,
  type AdapterReportJsonContext,
} from '../api/adapterReportJson';
import { useAdapterHealthStore, AdapterHealthReport } from '../model/adapterHealthStore';

/** What a shared report is saved as: the pasteable text, or the schema-v1 JSON for the
 *  compatibility matrix (plan 29). */
export type AdapterShareFormat = 'txt' | 'json';

/** The app / link context of the JSON report, read from the shared stores when a run starts (and
 *  stored on the report, so sharing later never mixes in a different adapter): the latest
 *  attempt's link kind (`reportLinkFor`; the simulator → `mock`), the negotiated BLE link, the
 *  adapter name and the active (registry) profile id. */
export function adapterReportContext(): AdapterReportJsonContext {
  const platform = Platform.OS === 'android' || Platform.OS === 'ios' ? Platform.OS : 'web';
  const { kind, link } = useLinkStore.getState();
  const version = Platform.Version == null ? '' : String(Platform.Version);
  return {
    appVersion: APP_VERSION,
    platform,
    os: version || undefined,
    deviceName: useSessionStore.getState().deviceName,
    link: reportLinkFor(kind, platform),
    // A garage car reports its registry base profile, never its local random `user:` id.
    profileId: curatedProfileId(getActiveProfile()),
    linkInfo: link
      ? { service: link.service, writeWithoutResponse: link.writeWithoutResponse, mtu: link.mtu }
      : null,
  };
}

/** Run the adapter health check against the live session (`runHealthCheck`): identity
 *  (`ATI`/`ATRV`/`ATDPN`) then a timed `0100` burst, graded by the pure `gradeAdapter`. No polling loop involvement — these are
 *  one-off queued commands, serialized by the ELM client behind whatever the EngineHost is doing. */
export function useAdapterHealth() {
  const session = useSessionStore((s) => s.session);
  const status = useSessionStore((s) => s.status);
  const running = useAdapterHealthStore((s) => s.running);
  const phase = useAdapterHealthStore((s) => s.phase);
  const report = useAdapterHealthStore((s) => s.report);
  const setRunning = useAdapterHealthStore((s) => s.setRunning);
  const setPhase = useAdapterHealthStore((s) => s.setPhase);
  const setReport = useAdapterHealthStore((s) => s.setReport);

  const mounted = useRef(true);
  const [sharing, setSharing] = useState(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(async () => {
    if (!session || running) return;
    setRunning(true);
    setReport(null);
    // Captured now, on the session the run executes on — not at share time.
    const context = adapterReportContext();
    try {
      const result = await runHealthCheck(session.client, {
        burst: DEFAULT_BURST,
        onPhase: setPhase,
        shouldStop: () => !mounted.current,
      });
      const next: AdapterHealthReport = { ...result, context };
      // An unmount cut the burst short (`shouldStop`), so its grade would be misleading — drop it.
      if (mounted.current) setReport(next);
    } catch (e) {
      logError({ source: 'adapter-health', error: e, severity: 'warning' });
    } finally {
      // Always: the store is module-level and outlives this screen. Gating on `mounted` left it
      // stuck at running=true after an unmount mid-run, so a remounted screen could never run again.
      setRunning(false);
      setPhase(null);
    }
  }, [session, running, setRunning, setReport, setPhase]);

  /** Save the report as a text file, or as the matrix JSON (`<slug>__<date>.json`, the name it is
   *  committed under): the OS share sheet on native, a browser download on web (`saveTextFile`). */
  const share = useCallback(
    async (format: AdapterShareFormat = 'txt') => {
      if (!report) return;
      setSharing(true);
      try {
        if (format === 'json') {
          const json = buildAdapterReportJson(report, report.context);
          await saveTextFile(
            reportFileName(json),
            `${JSON.stringify(json, null, 2)}\n`,
            'application/json',
            { dialogTitle: 'Adapter health report (JSON)' },
          );
        } else {
          await saveTextFile(
            `adapter-health-${fileStamp(report.ranAt)}.txt`,
            formatAdapterReport(report),
            'text/plain',
            { dialogTitle: 'Adapter health' },
          );
        }
      } catch (e) {
        logError({ source: 'adapter-health/share', error: e });
      } finally {
        if (mounted.current) setSharing(false);
      }
    },
    [report],
  );

  return { connected: status === 'connected', running, phase, report, run, share, sharing };
}
