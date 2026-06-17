import { useEffect, useRef } from 'react';
import {
  computeAccelRun,
  computeDragRun,
  computeBrakeRun,
  SpeedSample,
} from '@/shared/obd-core';
import { useSessionStore } from '@/shared/state/sessionStore';
import { logError } from '@/shared/state/errorLogStore';
import { usePerformanceStore } from '../model/performanceStore';

const SPEED_PID = '010D';

/** High-rate speed sampling with launch detection; computes metrics when the run ends. */
export function usePerformanceTest() {
  const session = useSessionStore((s) => s.session);
  const state = usePerformanceStore((s) => s.state);
  const type = usePerformanceStore((s) => s.type);
  const targetKmh = usePerformanceStore((s) => s.targetKmh);
  const setState = usePerformanceStore((s) => s.setState);
  const addRun = usePerformanceStore((s) => s.addRun);
  const samplesRef = useRef<SpeedSample[]>([]);

  useEffect(() => {
    if (state !== 'armed' && state !== 'running') return;
    if (!session) return;
    let cancelled = false;
    samplesRef.current = [];
    let launched = state === 'running';
    let loggedError = false;

    const loop = async () => {
      if (cancelled) return;
      try {
        const v = await session.readValue(SPEED_PID);
        const speed = v?.value ?? 0;
        const now = Date.now();
        if (!launched && speed > 0) {
          launched = true;
          setState('running');
        }
        if (launched) samplesRef.current.push({ t: now, speed });
      } catch (e) {
        if (!loggedError) {
          loggedError = true;
          logError({ source: 'performance-tests', error: e, severity: 'warning' });
        }
      }
      if (!cancelled) setTimeout(loop, 100);
    };
    loop();
    return () => {
      cancelled = true;
    };
  }, [state, session, setState]);

  const stop = () => {
    const samples = samplesRef.current;
    const run = {
      id: `${Date.now()}`,
      type,
      at: Date.now(),
      samples,
      accel: type === 'accel' ? computeAccelRun(samples, targetKmh) : undefined,
      drag: type === 'drag' ? computeDragRun(samples) : undefined,
      brake: type === 'brake' ? computeBrakeRun(samples, targetKmh, 0) : undefined,
    };
    addRun(run);
    setState('done');
  };

  return { stop };
}
