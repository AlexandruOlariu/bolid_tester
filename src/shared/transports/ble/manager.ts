/** Lazily-created singleton BleManager (react-native-ble-plx). Native only. */
import { BleManager } from 'react-native-ble-plx';

let manager: BleManager | null = null;

export function getBleManager(): BleManager {
  if (!manager) manager = new BleManager();
  return manager;
}

/** Device name hints commonly advertised by ELM327 BLE clones (incl. the Vgate iCar Pro). */
export const ADAPTER_NAME_HINTS = ['vlink', 'ios-vlink', 'v-link', 'veepeak', 'obdii', 'obd', 'icar'];

export function looksLikeAdapter(name?: string | null): boolean {
  if (!name) return false;
  const n = name.toLowerCase();
  return ADAPTER_NAME_HINTS.some((h) => n.includes(h));
}
