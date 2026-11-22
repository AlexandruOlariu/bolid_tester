# Feature: vehicle-info

Show vehicle and adapter identity.

## UI

- **VehicleInfoScreen** (`ui/VehicleInfoScreen.tsx`), title "Vehicle info".
- Not connected (or no session info yet) → "Not connected."
- Connected → one card of rows: **VIN** (Mode 09 PID 02), **Calibration ID** (Mode 09 PID 04),
  **Protocol** (the negotiated OBD2 protocol's label), **Adapter** (the device name), **ELM
  version** (`ATI`), **Voltage** (`ATRV`, one decimal, V) and **Supported PIDs** (the count). Below
  it, the list of supported Mode 01 PIDs the ECU reported.
- Buttons **Extended PIDs (experimental)** → `/extended` and **Decode VIN** → `/vin-decode`.
- **Full vehicle report** → `/report` ([report](./report.md), plan 15) — shown connected and also
  under "Not connected.", because the report builds from stored data offline.

## hooks

- `useVehicleInfo()` (`hooks/useVehicleInfo.ts`) — returns `{ info, deviceName, protocolLabel }`
  from the shared `sessionStore`; `protocolLabel` is `PROTOCOL_LABELS[info.protocol]` (`—` with no
  info).

## api (service layer)

None in this slice. Everything is read once, at connect time, by `DiagnosticSession.connect()` in
`src/shared/obd-core/session`: `ATRV` voltage, `ATI` version, the `0100`/`0120`/`0140`/`0160`
supported-PID bitmaps (`discoverSupportedPids`), `readVin()` (`0902`, the multi-frame VIN
reassembled) and `readCalibrationId()` (`0904`). The result is a `SessionInfo`.

## model

No store of its own. It reads `info: SessionInfo | null` (`protocol`, `voltage`, `version`,
`supportedPids`, `vin`, `calibrationId`) and `deviceName` from `sessionStore`
(`src/shared/state/sessionStore.ts`), which `connectionService` fills on connect.

## Behavior

- VIN may be **unsupported** on older K-line ECUs (Passat/older Punto) — the row shows "not
  available" rather than an error. The same applies to the calibration ID.
- The supported-PID list is the ground truth live-data uses to filter the dashboard
  (`session.effectivePids`, see [live-data](./live-data.md)).

## Acceptance

- Decodes the simulator VIN to 17 ASCII characters for CAN cars (the simulated Golf shows
  `WVWZZZ1KZ9W903398`).
- Shows "not available" when the (simulated) ECU doesn't answer `0902`.

## Tests

`ui/VehicleInfoScreen.test.tsx`: "Not connected." without a session; against the simulated Golf,
the VIN, protocol label, supported-PID count and adapter name are shown and **Decode VIN** pushes
`/vin-decode`.
