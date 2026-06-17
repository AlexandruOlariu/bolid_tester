# Feature: connection

Scan for, connect to, and initialize the ELM327 BLE adapter.

## UI
- **ScanScreen** — list of nearby BLE devices (name + RSSI), with name hints highlighted
  (`Vlink`, `IOS-Vlink`, `VEEPEAK`, `OBDII`). "Connect" per row. A connect/init progress state.
- **StatusBadge** — shared component showing `disconnected / connecting / initializing / connected /
  error` and the negotiated protocol once known.

## hooks
- `useScan()` — start/stop scanning, returns discovered devices.
- `useConnect()` — connect to a chosen device, run the ELM327 init, expose progress/errors.
- `useAdapterStatus()` — read connection status + protocol from the store.

## api (service layer)
- `connectionService` — builds the `Transport` (BLE or Mock per Settings), constructs the
  `Elm327Client`, runs the init sequence, then hands a ready `DiagnosticSession` to the app.

## model
- `connectionStore` (Zustand): `status`, `deviceId`, `deviceName`, `protocol`, `adapterVersion`,
  `voltage`, `error`.

## Behavior
1. Request BLE permissions (Android 12+ scan/connect; iOS usage description).
2. Scan; user picks a device (or auto-connect to the last used).
3. `BleTransport` connects, **discovers** services/characteristics, selects the notify + write pair.
4. Run init: `ATZ → ATE0 → ATL0 → ATS0 → ATH0 → ATAT1 → ATSP0`, probe `0100`, read `ATDPN`/`ATRV`.
5. On success → `connected`, store protocol + voltage; navigate onward.

## Troubleshooting — adapter visible in Android Bluetooth settings but not in the scan
A BLE peripheral that the OS has already **bonded and connected to** stops advertising, so
`startDeviceScan` can't surface it. This is the usual cause of "it's in Android’s Bluetooth list but
the app never lists it." The connection flow handles it as follows:
- **Already-connected adapters are surfaced directly.** `useScan` also calls
  `BleManager.connectedDevices(OBD_SERVICE_UUIDS)` (common ELM327 services, see `manager.ts`) and
  merges those into the device list before the scan results.
- **Connect by address (Android).** The scan screen offers a manual MAC entry; on Android
  `connectToDevice(mac)` works even for a device that never appears in a scan. iOS uses opaque
  device UUIDs (not MACs), and per the adapter doc you don't pair a BLE adapter on iOS — you scan.
- **Permission / scan failures are no longer silent.** A denied permission or a scan error sets a
  visible error on the Connect screen and is recorded in the **Error log** (`source: connection/scan`).
- Other user-side checks: turn **Location** on for Android 11 and below (BLE scanning requires it
  there); make sure the unit is a **BLE / "4.0"** adapter (a Bluetooth Classic / SPP "3.0" ELM327
  can't be reached by `react-native-ble-plx` at all); or **"Forget"** the device in Android settings
  so it advertises again.

## Acceptance
- Connects to the simulator in dev with no hardware (Settings → mock).
- Surfaces a clear error on permission denial, no device, or failed init.
- Already-connected/bonded adapters are listed (or reachable by address) even when not advertising.
- Never hard-codes characteristic UUIDs.
