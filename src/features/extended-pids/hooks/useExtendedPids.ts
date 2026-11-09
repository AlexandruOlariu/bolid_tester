import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useIsFocused } from 'expo-router';
import { useSessionStore } from '@/shared/state/sessionStore';
import { logError } from '@/shared/state/errorLogStore';
import { type ExtendedPid } from '@/shared/vehicles';
import { isCan } from '@/shared/obd-core/obd/protocols';
import { extendedKey } from '@/shared/obd-core/obd/liveKeys';
import type { LiveValue } from '@/shared/obd-core/session/DiagnosticSession';
import { useActiveProfile } from '@/shared/state/activeProfile';
import { useLiveDataStore } from '@/shared/state/liveDataStore';

// Unique poll-registration id per hook instance (same scheme as live-data's useLiveData).
let nextRegId = 0;

export interface ExtendedReading {
  did: string;
  name: string;
  unit: string;
  experimental: boolean;
  raw: number[] | null;
  value: number | null;
}

/** Reads the active profile's experimental Mode 22 PIDs. Only meaningful on CAN.
 *
 *  Two paths: `refresh()` is the one-shot read of every DID (raw frames shown), and — while the
 *  screen is FOCUSED on a supported link — the profile's DID keys (`22:<DID>`) are registered with
 *  the app-wide poll loop, so `live` updates every sweep without a manual refresh (plan 14). The
 *  registration is released on blur: hidden Tabs routes stay mounted, and sequential Mode 22 reads
 *  of every declared DID would otherwise slow Mode 01 refresh app-wide for the rest of the session.
 *  It talks to the shared live store directly (no feature → feature import). */
export function useExtendedPids() {
  const session = useSessionStore((s) => s.session);
  const info = useSessionStore((s) => s.info);
  const profile = useActiveProfile();
  const pids: ExtendedPid[] = useMemo(() => profile.extendedPids ?? [], [profile]);
  const supported = Boolean(profile.extendedPids?.length) && !!info && isCan(info.protocol);

  // Register every declared DID with the poll loop while focused (nothing when unsupported, so a
  // K-line / DID-less car never asks for Mode 22).
  const focused = useIsFocused();
  const acquire = useLiveDataStore((s) => s.acquire);
  const values = useLiveDataStore((s) => s.values);
  const idRef = useRef(`extended-pids-${nextRegId++}`);
  const keyList = supported ? pids.map((p) => extendedKey(p.did)).join(',') : '';
  useEffect(() => {
    if (!session || !focused || keyList.length === 0) return;
    return acquire(idRef.current, keyList.split(','));
  }, [session, focused, keyList, acquire]);
  const live = useMemo(() => {
    const out: Record<string, LiveValue> = {};
    for (const p of pids) {
      const v = values[extendedKey(p.did)];
      if (v) out[p.did] = v;
    }
    return out;
  }, [pids, values]);

  const [readings, setReadings] = useState<ExtendedReading[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!session || !profile.extendedPids) return;
    setLoading(true);
    try {
      const out: ExtendedReading[] = [];
      for (const e of profile.extendedPids) {
        const raw = await session.readExtended(e.did);
        out.push({
          did: e.did,
          name: e.name,
          unit: e.unit,
          experimental: e.experimental,
          raw,
          value: raw ? e.decode(raw) : null,
        });
      }
      setReadings(out);
    } catch (e) {
      logError({ source: 'extended-pids', error: e, severity: 'warning' });
    } finally {
      setLoading(false);
    }
  }, [session, profile]);

  return { supported, pids, readings, live, loading, refresh };
}
