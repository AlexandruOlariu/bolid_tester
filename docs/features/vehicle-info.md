# Feature: vehicle-info

Show vehicle and adapter identity.

## UI
- **VehicleInfoScreen** — VIN (Mode 09 PID 02), negotiated OBD2 protocol, adapter/ELM version
  (`ATI`), battery voltage (`ATRV`), and the list of supported PIDs reported by the ECU.

## hooks
- `useVin()` — request and assemble the VIN.
- `useAdapterInfo()` — protocol, ELM version, voltage from the connection store.
- `useSupportedPids()` — the decoded supported-PID bitmap.

## api (service layer)
- `vehicleInfoService` — issues `0902` and reassembles the multi-frame VIN; reads `ATI`/`ATRV`;
  decodes supported-PID bitmaps (`0100/0120/0140/0160`).

## model
- Reads from `connectionStore` + a small `infoStore` for VIN and supported-PID set.

## Behavior
- VIN may be **unsupported** on older K-line ECUs (Passat/older Punto) — show "not available" rather
  than an error.
- Supported-PID list is the ground truth used by live-data to filter the dashboard.

## Acceptance
- Decodes the simulator VIN to 17 ASCII characters for CAN cars.
- Gracefully reports "VIN not available" when the (simulated) ECU doesn't answer `0902`.
