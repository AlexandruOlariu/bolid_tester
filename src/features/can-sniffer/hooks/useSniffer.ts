import { useCallback, useEffect, useRef } from 'react';
import { CanFrameAggregator } from '@/shared/obd-core';
import { useSessionStore } from '@/shared/state/sessionStore';
import { logError } from '@/shared/state/errorLogStore';
import { useSnifferStore } from '../model/snifferStore';

const SNAPSHOT_MS = 500;

/** Raw bus monitor (ELM327 ATMA): stream frames, aggregate per CAN id. While sniffing, the
 *  adapter channel belongs to the monitor — all other polling pauses. */
export function useSniffer() {
  const session = useSessionStore((s) => s.session);
  const status = useSessionStore((s) => s.status);
  const store = useSnifferStore();
  const agg = useRef(new CanFrameAggregator());
  const total = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const available = !!session && status === 'connected';

  const stop = useCallback(async () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    try {
      await session?.stopSniffer();
    } catch (e) {
      logError({ source: 'can-sniffer', error: e, severity: 'warning' });
    }
    store.setStats(agg.current.snapshot(), total.current);
    store.setRunning(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- store methods are stable zustand actions; session is the only reactive input
  }, [session]);

  const start = useCallback(async () => {
    if (!session) return;
    agg.current.clear();
    total.current = 0;
    store.reset();
    store.setRunning(true);
    try {
      await session.startSniffer((line) => {
        if (agg.current.add(line)) total.current += 1;
      });
      timer.current = setInterval(() => {
        store.setStats(agg.current.snapshot(), total.current);
      }, SNAPSHOT_MS);
    } catch (e) {
      logError({ source: 'can-sniffer', error: e });
      store.setRunning(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- store methods are stable zustand actions; session is the only reactive input
  }, [session]);

  // Never leave the adapter in monitor mode when the screen goes away.
  useEffect(() => {
    return () => {
      if (timer.current) clearInterval(timer.current);
      if (session?.sniffing) void session.stopSniffer();
    };
  }, [session]);

  return { available, start, stop };
}
