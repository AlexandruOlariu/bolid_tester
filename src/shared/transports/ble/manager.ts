/** Lazily-created singleton BleManager (react-native-ble-plx). Native only. */
import { Platform } from 'react-native';
import { BleManager } from 'react-native-ble-plx';

let manager: BleManager | null = null;

export function getBleManager(): BleManager {
  if (!manager) manager = new BleManager();
  return manager;
}

/** Best-effort: ask the OS to power the Bluetooth radio on. `enable()` is **Android-only** — it
 *  shows the system enable dialog and resolves once BLE reaches PoweredOn. iOS has no public API to
 *  toggle the radio (the user must use Control Center/Settings), so this resolves `false` there.
 *  Returns whether the radio ended up on; callers fall back to manual guidance when `false`. */
export async function enableBluetooth(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  try {
    await getBleManager().enable();
    return true;
  } catch {
    return false;
  }
}

/** Device name hints — shared with the Classic Bluetooth transport, so they live in a pure module
 *  (plan 27); re-exported here for the BLE scan. */
export { ADAPTER_NAME_HINTS, looksLikeAdapter } from '../adapterNames';

/** Common 16-bit GATT services (expanded to their 128-bit base form) advertised by ELM327 BLE
 *  clones. Used to find an adapter that is **already connected at the OS level** — such a peripheral
 *  has stopped advertising, so a fresh `startDeviceScan` can't surface it. */
export const OBD_SERVICE_UUIDS = [
  '0000fff0-0000-1000-8000-00805f9b34fb', // FFF0/FFF1/FFF2 — most common ELM327 BLE
  '0000ffe0-0000-1000-8000-00805f9b34fb', // FFE0/FFE1 — HM-10 style
  '0000ffe5-0000-1000-8000-00805f9b34fb', // FFE5 — some variants
  '000018f0-0000-1000-8000-00805f9b34fb', // 18F0 — some Vgate/Veepeak variants
];
