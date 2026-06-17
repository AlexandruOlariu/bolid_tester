import { useCallback, useEffect, useRef, useState } from 'react';
import { analyzeBattery, VSample } from '@/shared/obd-core';
import { useSessionStore } from '@/shared/state/sessionStore';
import { logError } from '@/shared/state/errorLogStore';
import { useBatteryStore } from '../model/batteryStore';

const SAMPLE_MS = 200;
const CAPTURE_MS = 6000;

/** Capture a short voltage series (`ATRV`) and analyze it. The user is prompted to optionally
 *  start the engine during the window so the cranking dip is captured. */
export function useBatteryHealth() {
  const session = useSessionStore((s) => s.session);
  const status = useSessionStore((s) => s.status);
  const setSamples = useBatteryStore((s) => s.setSamples);
  const setReport = useBatteryStore((s) => s.setReport);
  const setCapturing = useBatteryStore((s) => s.setCapturing);
  const capturing = useBatteryStore((s) => s.capturing);
  const report = useBatteryStore((s) => s.report);
  const [liveV, setLiveV] = useState<number | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const capture = useCallback(async () => {
    if (!session) return;
    setCapturing(true);
    setReport(null);
    const samples: VSample[] = [];
    const start = Date.now();
    try {
      while (mounted.current && Date.now() - start < CAPTURE_MS) {
        const v = await session.client.voltage();
        if (v != null) {
          samples.push({ t: Date.now(), v });
          if (mounted.current) setLiveV(v);
        }
        await new Promise((r) => setTimeout(r, SAMPLE_MS));
      }
      if (mounted.current) {
        setSamples(samples);
        setReport(analyzeBattery(samples));
      }
    } catch (e) {
      logError({ source: 'battery-health', error: e, severity: 'warning', context: { samples: samples.length } });
    } finally {
      setCapturing(false);
    }
  }, [session, setCapturing, setReport, setSamples]);

  return { connected: status === 'connected', capturing, report, liveV, capture };
}
