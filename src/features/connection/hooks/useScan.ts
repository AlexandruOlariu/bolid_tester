import { useCallback, useEffect } from 'react';
import { getBleManager, looksLikeAdapter } from '@/shared/transports/ble/manager';
import { requestBlePermissions } from '@/shared/transports/ble/permissions';
import { useScanStore } from '../model/scanStore';

const SCAN_TIMEOUT_MS = 12000;

/** Drive a BLE scan, filling the scan store. Sorts likely adapters first by RSSI. */
export function useScan() {
  const { scanning, devices, setScanning, upsert, clear } = useScanStore();

  const stop = useCallback(() => {
    getBleManager().stopDeviceScan();
    setScanning(false);
  }, [setScanning]);

  const start = useCallback(async () => {
    if (!(await requestBlePermissions())) return;
    clear();
    setScanning(true);
    getBleManager().startDeviceScan(null, { allowDuplicates: false }, (error, device) => {
      if (error || !device) return;
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
