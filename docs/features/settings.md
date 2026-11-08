# Feature: settings

Developer and runtime settings.

## UI

- **SettingsScreen**:
  - **Adapter source** toggle — default **Real adapter (Bluetooth)**; **Simulator (no car)** is an
    explicit opt-in and, while it is on, an amber **simulator banner** stays visible on every screen
    (see [connection](./connection.md#simulator-banner)). The segments call
    `connectionService.switchAdapterSource()`, so switching disconnects any session built for the
    other source (a simulator session never survives under the real adapter, or vice versa). In
    simulator mode a picker chooses which car to emulate (generic / Golf / Punto / Passat).
  - **Injected DTCs** (simulator only) — **None** (default), **P0299**, **P0299+P0401**, or
    **Custom…**, which reveals a text field taking comma-separated codes. Each code must be a letter
    `P`/`C`/`B`/`U`, a first digit `0`–`3`, then three hex digits (`/^[PCBU][0-3][0-9A-F]{3}$/i` —
    the first digit is only 2 bits on the wire, so `P4135` would read back as `P0135` and is
    rejected); codes are uppercased, invalid ones ignored, duplicates dropped (`parseDtcList` in
    `settingsStore.ts`). The injected set is read
    when the simulator connects, so reconnect to apply a change.
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
- Persisted as `bolid.settings` at **version 2**. Defaults: `adapterSource: 'ble'`,
  `simulatedVehicleId: 'golf-plus-2009-20tdi'`, `injectedDtcs: []`.
- **Migration v1 → v2** (`migrateSettings`, pure and unit-tested): a v1 blob keeps its explicit
  `adapterSource` and `injectedDtcs` — a tester who chose the simulator is never flipped under them —
  and only _missing_ fields get the new defaults (`'ble'`, `[]`). From v2 on it is the identity. The
  existing `merge` still deep-merges `ai` over the defaults.
- **Known limitation:** v1's `partialize` always wrote `adapterSource` and `injectedDtcs`, so every
  real v1 file carries them — including installs that never chose anything and just persisted the
  old defaults (`'mock'`, `['P0299']`). The migration cannot tell those apart from a deliberate
  choice, so every upgraded install stays in simulator mode with the P0299 fault until the user
  switches (the simulator banner makes that visible). The default-fill path only covers hand-edited or
  partial blobs. Only fresh installs get the production defaults.
- The selected real-car profile (`vehicleStore.selectedProfileId`) is persisted too.
- Persistence uses zustand's `persist` middleware over a small `StateStorage` backed by
  **expo-file-system** (`shared/state/persistStorage.ts`) — JSON files in the app document
  directory. No extra native dependency; best-effort (a filesystem error just means no persistence).

## Behavior

- A fresh install starts on the **real adapter** with no injected fault. Switching to **Simulator**
  lets the entire app run with no car — used for development, demos, and as the backbone of the
  automated tests — and is always flagged by the simulator banner.
- The I/O log is the first place to look when debugging a real car.

## Acceptance

- A fresh install (or cleared app data) shows **Real adapter (Bluetooth)** selected and no injected
  DTC; a persisted v1 file with `adapterSource: 'mock'` still opens in simulator mode.
- With the simulator and **Injected DTCs: None**, Faults shows no codes; **Custom…** `P0135` shows
  `P0135`.
- App is fully usable end-to-end in simulator mode.
- Log shows every command/response pair.
