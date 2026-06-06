# Feature: settings

Developer and runtime settings.

## UI
- **SettingsScreen**:
  - **Adapter source** toggle: **Real (BLE)** vs **Simulator (mock)** — and, in simulator mode, a
    picker for which car to emulate (generic / Golf / Punto / Passat) and optional injected DTCs.
  - **Live log** of adapter I/O (sent commands ↔ raw responses), with copy/share/export.
  - Units (metric default), poll interval, theme (system/light/dark).

## hooks
- `useAdapterSource()` — read/set mock-vs-real + simulated car.
- `useAdapterLog()` — subscribe to the rolling I/O log.

## api (service layer)
- Writes the adapter-source choice that `connectionService` reads when building the `Transport`.

## model
- `settingsStore` (Zustand, persisted): `adapterSource`, `simulatedVehicleId`, `injectedDtcs`,
  `units`, `pollIntervalMs`, `theme`.

## Behavior
- Switching to **Simulator** lets the entire app run with no car — used for development, demos, and as
  the backbone of the automated tests.
- The I/O log is the first place to look when debugging a real car.

## Acceptance
- App is fully usable end-to-end in simulator mode.
- Log shows every command/response pair.
