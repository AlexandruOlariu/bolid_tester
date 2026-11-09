/** Lazily-created singleton BleManager (react-native-ble-plx). Native only. */
import { Platform } from 'react-native';
import { BleManager } from 'react-native-ble-plx';

let manager: BleManager | null = null;

/** Thrown by {@link getBleManager} in a browser: the web build talks to the adapter through
 *  `WebBluetoothTransport` instead (plan 28). */
export const BLE_PLX_WEB_UNAVAILABLE =
  'Bluetooth LE via react-native-ble-plx is not available on web';

export function getBleManager(): BleManager {
  if (Platform.OS === 'web') throw new Error(BLE_PLX_WEB_UNAVAILABLE);
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

/** The ELM327 BLE service UUIDs live in a pure module (plan 28) so the Web Bluetooth transport does
 *  not load `react-native-ble-plx`; re-exported here for the native scan. */
export { OBD_SERVICE_UUIDS } from '../common/obdServiceUuids';
