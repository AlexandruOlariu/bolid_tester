import { useCallback, useEffect, useRef, useState } from 'react';
import { PROTOCOL_LABELS } from '@/shared/obd-core';
import { useSessionStore } from '@/shared/state/sessionStore';
import { logError } from '@/shared/state/errorLogStore';
import { gradeAdapter } from '../api/gradeAdapter';
import { formatAdapterReport } from '../api/adapterReport';
import { useAdapterHealthStore, AdapterHealthReport } from '../model/adapterHealthStore';

/** How many timed `0100` round trips make up the latency burst. */
const BURST = 10;

/** Run the adapter health check against the live session: identity (`ATI`/`ATRV`/`ATDPN`) then a
 *  timed `0100` burst, graded by the pure `gradeAdapter`. No polling loop involvement — these are
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
    const client = session.client;
    try {
      setPhase('Reading firmware (ATI)…');
      const version = await client.version().catch(() => '');

      setPhase('Reading voltage (ATRV)…');
      const voltage = await client.voltage().catch(() => null);

      setPhase('Detecting protocol (ATDPN)…');
      const protocolId = await client.protocolNumber().catch(() => 'UNKNOWN' as const);
      const protocol = PROTOCOL_LABELS[protocolId] ?? 'Unknown';

      const latenciesMs: number[] = [];
      let attempts = 0;
      for (let i = 0; i < BURST; i++) {
        if (!mounted.current) break;
        setPhase(`Timing 0100 (${i + 1}/${BURST})…`);
        attempts++;
        const t0 = Date.now();
        try {
          await client.command('0100');
          latenciesMs.push(Date.now() - t0);
        } catch {
          // A timed-out / errored command doesn't contribute a latency but still counts as an attempt.
        }
      }

      const result = gradeAdapter({ version, voltage, protocol, latenciesMs });
      const next: AdapterHealthReport = {
        version,
        voltage,
        protocol,
        latenciesMs,
        attempts,
        result,
        ranAt: Date.now(),
      };
      if (mounted.current) setReport(next);
    } catch (e) {
      logError({ source: 'adapter-health', error: e, severity: 'warning' });
    } finally {
      if (mounted.current) {
        setRunning(false);
        setPhase(null);
      }
    }
  }, [session, running, setRunning, setReport, setPhase]);

  /** Write the report to a text file and open the OS share sheet. Dependency-tolerant: a no-op when
   *  expo-file-system / expo-sharing are absent (tests, web) — same idiom as the DTC export. */
  const share = useCallback(async () => {
    if (!report) return;
    setSharing(true);
    try {
      const FileSystem = await import('expo-file-system' as string);
      const Sharing = await import('expo-sharing' as string);
      const dir = (FileSystem as { documentDirectory?: string }).documentDirectory ?? '';
      if (!dir) return;
      const stamp = new Date(report.ranAt).toISOString().replace(/[:.]/g, '-');
      const uri = `${dir}adapter-health-${stamp}.txt`;
      await FileSystem.writeAsStringAsync(uri, formatAdapterReport(report));
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'text/plain', dialogTitle: 'Adapter health' });
      }
    } catch (e) {
      logError({ source: 'adapter-health/share', error: e });
    } finally {
      if (mounted.current) setSharing(false);
    }
  }, [report]);

  return { connected: status === 'connected', running, phase, report, run, share, sharing };
}
