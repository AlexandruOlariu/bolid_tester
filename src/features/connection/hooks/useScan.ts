import { useCallback, useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { State } from 'react-native-ble-plx';
import {
  getBleManager,
  looksLikeAdapter,
  OBD_SERVICE_UUIDS,
} from '@/shared/transports/ble/manager';
import { requestBlePermissions } from '@/shared/transports/ble/permissions';
import { useSessionStore } from '@/shared/state/sessionStore';
import { logError } from '@/shared/state/errorLogStore';
import { useScanStore } from '../model/scanStore';
import { translate } from '@/shared/i18n';

const SCAN_TIMEOUT_MS = 12000;

const PERMISSION_DENIED_MSG = () => translate('connection:scan.permissionDenied');

/** iOS has no runtime permission request: a denied Bluetooth prompt shows up as ble-plx
 *  `State.Unauthorized`, fixed only in the Settings app (plan 09). */
const IOS_PERMISSION_DENIED_MSG = () => translate('connection:scan.permissionDeniedIos');

const BLUETOOTH_OFF_MSG = () => translate('connection:scan.off');

const BLUETOOTH_SETTLING_MSG = () => translate('connection:scan.settling');

/** Why a scan cannot start in this radio state, or null when it can. A denied permission is not
 *  reported as "Bluetooth is off" (on iOS that is the only way a denial surfaces). Exported for
 *  tests. */
export function scanBlockedMessage(state: State, os: string): string | null {
  switch (state) {
    case State.PoweredOn:
      return null;
    case State.Unauthorized:
      return os === 'ios' ? IOS_PERMISSION_DENIED_MSG() : PERMISSION_DENIED_MSG();
    case State.Unknown:
    case State.Resetting:
      return BLUETOOTH_SETTLING_MSG();
    default:
      return BLUETOOTH_OFF_MSG();
  }
}

/** Drive a BLE scan, filling the scan store. Sorts likely adapters first by RSSI. */
export function useScan() {
  const { scanning, devices, setScanning, upsert, clear } = useScanStore();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Set once this hook has used the BLE stack. Until then there is no scan to stop, and `stop()`
  // (also run on unmount) must not construct a BleManager: the simulator and Wi-Fi sources never
  // touch Bluetooth, and on iOS creating the manager can raise the Bluetooth permission prompt.
  const bleUsedRef = useRef(false);

  const stop = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (bleUsedRef.current) getBleManager().stopDeviceScan();
    setScanning(false);
  }, [setScanning]);

  const start = useCallback(async () => {
    bleUsedRef.current = true;
    if (!(await requestBlePermissions())) {
      setScanning(false);
      useSessionStore.getState().setError(PERMISSION_DENIED_MSG());
      logError({ source: 'connection/scan', error: PERMISSION_DENIED_MSG(), severity: 'warning' });
      return;
    }
    // The radio can turn off between the button check and here — fail with clear guidance instead of
    // a raw "BluetoothLE is powered off" scan error.
    const blocked = scanBlockedMessage(await getBleManager().state(), Platform.OS);
    if (blocked) {
      setScanning(false);
      useSessionStore.getState().setError(blocked);
      logError({ source: 'connection/scan', error: blocked, severity: 'warning' });
      return;
    }
    useSessionStore.getState().setError(null);
    clear();
    setScanning(true);

    // An adapter that's already bonded + connected at the OS level (e.g. paired in Android settings
    // and auto-connected) no longer advertises, so the scan below can't see it. Surface those first.
    try {
      const connected = await getBleManager().connectedDevices(OBD_SERVICE_UUIDS);
      for (const d of connected) {
        upsert({
          id: d.id,
          name: d.name ?? d.localName ?? null,
          rssi: d.rssi ?? null,
          isLikelyAdapter: true,
        });
      }
    } catch (e) {
      logError({ source: 'connection/scan', error: e, severity: 'warning' });
    }

    getBleManager().startDeviceScan(null, { allowDuplicates: false }, (error, device) => {
      if (error) {
        logError({ source: 'connection/scan', error });
        return;
      }
      if (!device) return;
      upsert({
        id: device.id,
        name: device.name ?? device.localName ?? null,
        rssi: device.rssi ?? null,
        isLikelyAdapter: looksLikeAdapter(device.name ?? device.localName),
      });
    });
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(stop, SCAN_TIMEOUT_MS);
  }, [clear, setScanning, upsert, stop]);

  useEffect(() => () => stop(), [stop]);

  const sorted = [...devices].sort((a, b) => {
    if (a.isLikelyAdapter !== b.isLikelyAdapter) return a.isLikelyAdapter ? -1 : 1;
    return (b.rssi ?? -999) - (a.rssi ?? -999);
  });

  return { scanning, devices: sorted, start, stop };
}
