# Feature: settings

Developer and runtime settings.

## UI
- **SettingsScreen**:
  - **Adapter source** toggle: **Real (BLE)** vs **Simulator (mock)** — and, in simulator mode, a
    picker for which car to emulate (generic / Golf / Punto / Passat) and optional injected DTCs.
  - **Live log** of adapter I/O (sent commands ↔ raw responses), with clear + export-as-fixture.
  - Units (metric default), poll interval, theme (system/light/dark).

## hooks
- `useAdapterSource()` — read/set mock-vs-real + simulated car.
- `useAdapterLogStore((s) => s.entries)` — subscribe to the throttled I/O-log snapshot.

## api (service layer)
- Writes the adapter-source choice that `connectionService` reads when building the `Transport`.

## adapter I/O log (`shared/state/adapterLog.ts`)
- The raw tx/rx traffic is a **module-level ring buffer** (fixed 300 entries, O(1) append), **not**
  a zustand array. `connectionService.withLog` mirrors every tx command and rx chunk into it; a
  separate **throttled publish (~4 Hz, trailing flush)** snapshots the buffer into a tiny zustand
  store (`useAdapterLogStore`) that the UI subscribes to. This kills the per-chunk array copies +
  re-renders the old design did during a CAN sniff (finding F5).
- While the ELM client is in **monitor mode** (`ATMA` sniff), rx mirroring is **paused** — the
  sniffer feature has its own line listener on that firehose, so logging it here would
  double-handle hundreds of frames/sec. tx commands are still logged.
- The log is **never persisted** (it never was) and is intentionally not part of `settingsStore`.

## model
- `settingsStore` (Zustand, **persisted**): `adapterSource`, `simulatedVehicleId`, `injectedDtcs`,
  `units`, `pollIntervalMs`, `autoReconnect`, `theme`, and the `ai` config (server URL, model,
  structured-output mode, timeout, key). It no longer holds the adapter I/O log (see above).
- The selected real-car profile (`vehicleStore.selectedProfileId`) is persisted too.
- Persistence uses zustand's `persist` middleware over a small `StateStorage` backed by
  **expo-file-system** (`shared/state/persistStorage.ts`) — JSON files in the app document
  directory. No extra native dependency; best-effort (a filesystem error just means no persistence).

## Behavior
- Switching to **Simulator** lets the entire app run with no car — used for development, demos, and as
  the backbone of the automated tests.
- The I/O log is the first place to look when debugging a real car.

## Acceptance
- App is fully usable end-to-end in simulator mode.
- Log shows every command/response pair.
