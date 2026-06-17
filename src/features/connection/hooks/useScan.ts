import { useCallback, useEffect } from 'react';
import { getBleManager, looksLikeAdapter, OBD_SERVICE_UUIDS } from '@/shared/transports/ble/manager';
import { requestBlePermissions } from '@/shared/transports/ble/permissions';
import { useSessionStore } from '@/shared/state/sessionStore';
import { logError } from '@/shared/state/errorLogStore';
import { useScanStore } from '../model/scanStore';

const SCAN_TIMEOUT_MS = 12000;

const PERMISSION_DENIED_MSG =
  'Bluetooth permission denied. Allow “Nearby devices” (Android 12+) or Location (Android 11 and ' +
  'below) for Bolid Tester in system settings, turn Bluetooth on, then scan again.';

/** Drive a BLE scan, filling the scan store. Sorts likely adapters first by RSSI. */
export function useScan() {
  const { scanning, devices, setScanning, upsert, clear } = useScanStore();

  const stop = useCallback(() => {
    getBleManager().stopDeviceScan();
    setScanning(false);
  }, [setScanning]);

  const start = useCallback(async () => {
    if (!(await requestBlePermissions())) {
      setScanning(false);
      useSessionStore.getState().setError(PERMISSION_DENIED_MSG);
      logError({ source: 'connection/scan', error: PERMISSION_DENIED_MSG, severity: 'warning' });
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
    setTimeout(stop, SCAN_TIMEOUT_MS);
  }, [clear, setScanning, upsert, stop]);

  useEffect(() => () => stop(), [stop]);

  const sorted = [...devices].sort((a, b) => {
    if (a.isLikelyAdapter !== b.isLikelyAdapter) return a.isLikelyAdapter ? -1 : 1;
    return (b.rssi ?? -999) - (a.rssi ?? -999);
  });

  return { scanning, devices: sorted, start, stop };
}
