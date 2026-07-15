import { useCallback, useEffect, useRef, useState } from 'react';
import { useSessionStore } from '@/shared/state/sessionStore';
import { logError } from '@/shared/state/errorLogStore';
import type { ExtendedPid } from '@/shared/vehicles';
import {
  resetMeasuringLog,
  appendMeasuringRow,
  getMeasuringLog,
  buildMeasuringLogCsv,
} from '../api/measuringLog';

/** How often the log samples the selected DIDs. Extended (Mode 22) reads are sequential and slower
 *  than Mode 01, so a 1 s sweep is a safe, VCDS-like cadence that won't overrun the ELM queue. */
const SAMPLE_INTERVAL_MS = 1000;

export interface MeasuringLog {
  recording: boolean;
  /** Completed sample sweeps (one per interval). */
  sampleCount: number;
  startedAt: number | null;
  /** Latest decoded value per DID this session — a tiny map (one entry per selected DID) kept in
   *  state for a live readout, while the full row history stays in the module-level buffer. */
  latest: Record<string, number | null>;
  /** Writing/sharing the CSV on stop. */
  busy: boolean;
  start: (entries: ExtendedPid[]) => void;
  /** Stop, build the CSV and open the OS share sheet. Returns the file URI, or null if unavailable. */
  stop: () => Promise<string | null>;
}

/** Owns the measuring-block recording lifecycle: a self-scheduling sweep that reads the selected
 *  extended DIDs, buffers {t, did, name, value, unit} rows at module scope, and on stop writes a CSV
 *  and shares it. Recording ends on stop, on unmount, or when the session drops. */
export function useMeasuringLog(): MeasuringLog {
  const session = useSessionStore((s) => s.session);
  const [recording, setRecording] = useState(false);
  const [sampleCount, setSampleCount] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [latest, setLatest] = useState<Record<string, number | null>>({});
  const [busy, setBusy] = useState(false);

  const cancelledRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const entriesRef = useRef<ExtendedPid[]>([]);

  const stopLoop = useCallback(() => {
    cancelledRef.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const start = useCallback(
    (entries: ExtendedPid[]) => {
      if (recording || entries.length === 0) return;
      resetMeasuringLog();
      setSampleCount(0);
      setLatest({});
      setStartedAt(Date.now());
      setRecording(true);
      entriesRef.current = entries;
      cancelledRef.current = false;

      const sweep = async () => {
        if (cancelledRef.current) return;
        const sess = useSessionStore.getState().session;
        if (sess) {
          const values: Record<string, number | null> = {};
          for (const e of entriesRef.current) {
            try {
              const raw = await sess.readExtended(e.did);
              const value = raw ? e.decode(raw) : null;
              values[e.did] = value;
              appendMeasuringRow({ t: Date.now(), did: e.did, name: e.name, value, unit: e.unit });
            } catch (err) {
              logError({ source: 'extended-pids/log', error: err, severity: 'warning' });
            }
          }
          if (!cancelledRef.current) {
            setLatest((prev) => ({ ...prev, ...values }));
            setSampleCount((n) => n + 1);
          }
        }
        if (!cancelledRef.current) timerRef.current = setTimeout(sweep, SAMPLE_INTERVAL_MS);
      };
      void sweep();
    },
    [recording],
  );

  const stop = useCallback(async (): Promise<string | null> => {
    stopLoop();
    setRecording(false);
    const rows = getMeasuringLog();
    if (rows.length === 0) return null;
    setBusy(true);
    try {
      const csv = buildMeasuringLogCsv(rows);
      const FileSystem = await import('expo-file-system' as string);
      const Sharing = await import('expo-sharing' as string);
      const dir = (FileSystem as { documentDirectory?: string }).documentDirectory ?? '';
      if (!dir) return null;
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const uri = `${dir}measuring-log-${stamp}.csv`;
      await FileSystem.writeAsStringAsync(uri, csv);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'text/csv', dialogTitle: 'Export measuring log' });
      }
      return uri;
    } catch (e) {
      logError({ source: 'extended-pids/log-export', error: e });
      return null;
    } finally {
      setBusy(false);
    }
  }, [stopLoop]);

  // End recording if the session drops (disconnect) — the buffer is kept so a stop can still export.
  useEffect(() => {
    if (!session && recording) {
      stopLoop();
      setRecording(false);
    }
  }, [session, recording, stopLoop]);

  // Stop the sweep if the screen unmounts mid-log.
  useEffect(() => () => stopLoop(), [stopLoop]);

  return { recording, sampleCount, startedAt, latest, busy, start, stop };
}
