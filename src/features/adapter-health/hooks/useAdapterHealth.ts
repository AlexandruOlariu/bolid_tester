import { useCallback, useEffect, useRef, useState } from 'react';
import { PROTOCOL_LABELS } from '@/shared/obd-core';
import { useSessionStore } from '@/shared/state/sessionStore';
import { logError } from '@/shared/state/errorLogStore';
import { fileStamp, saveTextFile } from '@/shared/lib/saveFile';
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

  /** Save the report as a text file: the OS share sheet on native, a browser download on web
   *  (`saveTextFile`, plan 28). */
  const share = useCallback(async () => {
    if (!report) return;
    setSharing(true);
    try {
      await saveTextFile(
        `adapter-health-${fileStamp(report.ranAt)}.txt`,
        formatAdapterReport(report),
        'text/plain',
        { dialogTitle: 'Adapter health' },
      );
    } catch (e) {
      logError({ source: 'adapter-health/share', error: e });
    } finally {
      if (mounted.current) setSharing(false);
    }
  }, [report]);

  return { connected: status === 'connected', running, phase, report, run, share, sharing };
}
