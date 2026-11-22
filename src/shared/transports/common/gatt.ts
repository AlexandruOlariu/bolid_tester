/** GATT facts shared by both Bluetooth LE transports — `BleTransport` (react-native-ble-plx) and
 *  `WebBluetoothTransport` (the browser, plan 28). Pure: no React Native import, so the web transport
 *  and its Node tests never load the native stack. */

/** The BLE default ATT MTU (used when the stack does not report a negotiated value, and always on
 *  the web, which has no MTU API). */
export const DEFAULT_ATT_MTU = 23;
/** ATT header bytes per write (opcode + handle); the usable payload is `mtu - 3`. */
const ATT_HEADER_BYTES = 3;
/** Never chunk below the BLE 4.0 minimum payload. */
export const MIN_PAYLOAD = 20;
/** Sent after a chunked write fails partway: `X` is not a hex digit nor part of any AT command, so
 *  the ELM327 answers the buffered fragment + `X` with `?` instead of running it. */
export const LINE_FLUSH = Uint8Array.from([0x58, 0x0d]); // 'X\r'

/** Usable payload for a negotiated MTU (`mtu - 3`, never below 20). */
export function payloadForMtu(mtu: number): number {
  return Math.max(MIN_PAYLOAD, mtu - ATT_HEADER_BYTES);
}

/** What the live link negotiated — shown by the Connect screen's diagnostics panel. */
export interface BleLinkInfo {
  /** Negotiated ATT MTU (`device.mtu`), or 23 when unknown (always 23 on the web). */
  mtu: number;
  /** Usable bytes per GATT write: `mtu - 3`, floor 20. */
  payload: number;
  service: string;
  notifyCharacteristic: string;
  writeCharacteristic: string;
  writeWithoutResponse: boolean;
}
