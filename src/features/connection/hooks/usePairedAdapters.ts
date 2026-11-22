import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import {
  checkClassicBluetoothPermissions,
  requestClassicBluetoothPermissions,
} from '@/shared/transports/ble/permissions';
import type { BondedAdapter } from '@/shared/transports/spp/SppTransport';
import { logError } from '@/shared/state/errorLogStore';
import { listPairedAdapters } from '../api/connectionService';
import { translate } from '@/shared/i18n';

/** Only Android 12+ asks (BLUETOOTH_CONNECT, shown as "Nearby devices"), so the name is right. */
const PERMISSION_DENIED_MSG = () => translate('connection:spp.permissionDenied');

export interface PairedAdaptersState {
  /** Paired devices, likely OBD2 adapters first. */
  devices: BondedAdapter[];
  /** A list request is in flight. */
  loading: boolean;
  /** At least one list request finished (so an empty `devices` means "nothing paired"). */
  loaded: boolean;
  /** Why the last request failed (Bluetooth off, permission, module missing), or null. */
  error: string | null;
  refresh: () => Promise<void>;
}

/** The Classic Bluetooth picker's data (plan 27): the phone's paired devices, read when `enabled`
 *  turns on, on **Refresh**, and whenever the app returns to the foreground — the user pairs the
 *  adapter in Android's Bluetooth settings and comes back. No scanning: SPP adapters are bonded
 *  first. Asks for the Classic Bluetooth permission (CONNECT on Android 12+; nothing to ask on older
 *  Android, where no location permission is involved) before reading the list —
 *  but a foreground re-read only *checks* it: the system permission dialog itself pauses the
 *  activity, so its close fires an 'active' change that must not prompt a second time. A re-read
 *  is also skipped while a request is still in flight. */
export function usePairedAdapters(enabled: boolean): PairedAdaptersState {
  const [devices, setDevices] = useState<BondedAdapter[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  /** Only the newest request may publish its result. */
  const seq = useRef(0);
  /** Requests in flight (a foreground re-read waits for none of them, it is skipped). */
  const inFlight = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /** Read the list; `prompt` false only checks the permission (never shows the system dialog). */
  const load = useCallback(async (prompt: boolean) => {
    const mine = ++seq.current;
    const current = () => mounted.current && mine === seq.current;
    inFlight.current++;
    setLoading(true);
    let next: BondedAdapter[] = [];
    let problem: string | null = null;
    try {
      const allowed = prompt
        ? await requestClassicBluetoothPermissions()
        : await checkClassicBluetoothPermissions();
      if (!allowed) problem = PERMISSION_DENIED_MSG();
      else next = await listPairedAdapters();
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
      logError({ source: 'connection/paired-adapters', error: e, severity: 'warning' });
    } finally {
      inFlight.current--;
    }
    if (!current()) return;
    setDevices(next);
    setError(problem);
    setLoaded(true);
    setLoading(false);
  }, []);

  const refresh = useCallback(() => load(true), [load]);

  useEffect(() => {
    if (!enabled) return;
    void load(true);
    // Back from the system Bluetooth settings (where the adapter was just paired): read again,
    // without prompting, and not while a request (its permission dialog included) is pending.
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active' && inFlight.current === 0) void load(false);
    });
    return () => sub.remove();
  }, [enabled, load]);

  return { devices, loading, loaded, error, refresh };
}
