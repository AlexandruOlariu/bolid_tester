/** GATT services used by ELM327 BLE adapters: the common 16-bit ones (expanded to their 128-bit
 *  base form) plus vendor 128-bit ones. Pure (no React Native, no ble-plx), so both Bluetooth LE
 *  transports share it: the native scan uses it to find an adapter that is **already connected at
 *  the OS level** (such a peripheral has stopped advertising, so a fresh `startDeviceScan` can't
 *  surface it), and Web Bluetooth must list every service it will open as `optionalServices` in the
 *  chooser request — Chrome hides any service not named there, so on the web the "first service
 *  with notify + write" search only ever sees these (plan 28). Native discovery is not limited by
 *  this list. A listed service the adapter lacks is harmless. */
export const OBD_SERVICE_UUIDS = [
  '0000fff0-0000-1000-8000-00805f9b34fb', // FFF0/FFF1/FFF2 — most common ELM327 BLE
  '0000ffe0-0000-1000-8000-00805f9b34fb', // FFE0/FFE1 — HM-10 style
  '0000ffe5-0000-1000-8000-00805f9b34fb', // FFE5 — some variants
  '000018f0-0000-1000-8000-00805f9b34fb', // 18F0 — some Vgate/Veepeak variants
  // Vendor 128-bit service widely reported for the Vgate iCar Pro BLE 4.0 (the owner's adapter,
  // docs/PLAN.md) — not yet confirmed on the real unit (plan 28 "Deferred until an on-car session").
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
];
