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

## Acceptance
- Connects to the simulator in dev with no hardware (Settings → mock).
- Surfaces a clear error on permission denial, no device, or failed init.
- Never hard-codes characteristic UUIDs.
