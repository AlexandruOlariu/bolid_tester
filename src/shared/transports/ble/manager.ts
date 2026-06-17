/** Lazily-created singleton BleManager (react-native-ble-plx). Native only. */
import { BleManager } from 'react-native-ble-plx';

let manager: BleManager | null = null;

export function getBleManager(): BleManager {
  if (!manager) manager = new BleManager();
  return manager;
}

/** Device name hints commonly advertised by ELM327 BLE clones (incl. the Vgate iCar Pro). */
export const ADAPTER_NAME_HINTS = ['vlink', 'ios-vlink', 'v-link', 'veepeak', 'obdii', 'obd', 'icar'];

/** Common 16-bit GATT services (expanded to their 128-bit base form) advertised by ELM327 BLE
 *  clones. Used to find an adapter that is **already connected at the OS level** — such a peripheral
 *  has stopped advertising, so a fresh `startDeviceScan` can't surface it. */
export const OBD_SERVICE_UUIDS = [
  '0000fff0-0000-1000-8000-00805f9b34fb', // FFF0/FFF1/FFF2 — most common ELM327 BLE
  '0000ffe0-0000-1000-8000-00805f9b34fb', // FFE0/FFE1 — HM-10 style
  '0000ffe5-0000-1000-8000-00805f9b34fb', // FFE5 — some variants
  '000018f0-0000-1000-8000-00805f9b34fb', // 18F0 — some Vgate/Veepeak variants
];

export function looksLikeAdapter(name?: string | null): boolean {
  if (!name) return false;
  const n = name.toLowerCase();
  return ADAPTER_NAME_HINTS.some((h) => n.includes(h));
}
