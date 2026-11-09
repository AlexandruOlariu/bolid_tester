/** Device-name hints shared by every Bluetooth transport (BLE scan results and the Classic
 *  Bluetooth bonded list, plan 27). Pure — no native imports — so the SPP transport and its tests
 *  can use it without loading `react-native-ble-plx`. */

/** Names commonly advertised by ELM327 clones, BLE and classic alike (incl. the Vgate iCar Pro and
 *  the "OBDII" / "OBD2" / "ELM327" SPP adapters). Matched case-insensitively as substrings. */
export const ADAPTER_NAME_HINTS = [
  'vlink',
  'ios-vlink',
  'v-link',
  'veepeak',
  'obdii',
  'obd',
  'icar',
  'elm327',
];

/** Whether a device name looks like an OBD2 adapter (the list puts these first, with a star). */
export function looksLikeAdapter(name?: string | null): boolean {
  if (!name) return false;
  const n = name.toLowerCase();
  return ADAPTER_NAME_HINTS.some((h) => n.includes(h));
}
