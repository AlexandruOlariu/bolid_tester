# Feature: settings

Developer and runtime settings.

## UI

- **SettingsScreen**:
  - **Adapter source** toggle — default **Real adapter (Bluetooth)**; **Simulator (no car)** is an
    explicit opt-in and, while it is on, an amber **simulator banner** stays visible on every screen
    (see [connection](./connection.md#simulator-banner)). The segments call
    `connectionService.switchAdapterSource()`, so switching disconnects any session built for the
    other source (a simulator session never survives under the real adapter, or vice versa) and
    clears the adapter log, so the log never mixes or carries over traffic from the other source. In
    simulator mode a picker chooses which car to emulate (generic / Golf / Punto / Passat).
  - **Injected DTCs** (simulator only) — **None** (default), **P0299**, **P0299+P0401**, or
    **Custom…**, which reveals a text field taking comma-separated codes. Each code must be a letter
    `P`/`C`/`B`/`U`, a first digit `0`–`3`, then three hex digits (`/^[PCBU][0-3][0-9A-F]{3}$/i` —
    the first digit is only 2 bits on the wire, so `P4135` would read back as `P0135` and is
    rejected); codes are uppercased, invalid ones ignored, duplicates dropped (`parseDtcList` in
    `settingsStore.ts`). The injected set is read
    when the simulator connects, so reconnect to apply a change.
  - **Developer (simulator)** (simulator only) — two test controls for the link-robustness paths
    (plan 12): **Simulate a link drop** (enabled while connected; calls
    `connectionService.__sim.simulateDrop()` → `MockTransport.simulateDisconnect()`, so
    auto-reconnect and the flap guard can be watched with no car) and **Fail next connect: no reply
    to ATZ** (`__sim.failNextConnect()`: the next simulator connect's `MockTransport` gets
    `dropResponses(1, { includeAt: true })`, so `ATZ` times out and the Connect screen's
    diagnostics panel opens at stage "Adapter start-up").
  - **Auto-reconnect** On / Off — copy: "On by default; pauses after 3 drops in a minute", then the
    backoff (2 s, 5 s, 10 s — up to 3 attempts) and that a manual disconnect / connect cancels it.
    See [connection](./connection.md#auto-reconnect-on-by-default-with-a-flap-guard).
  - **Adapter log** — live log of adapter I/O (sent commands ↔ raw responses) with **Clear**, a
    **Flow name** field (default `session`) and **Export as replay fixture** (plan 02). The export
    (`model/replayExport.ts` → `api/replayFixtureFile.ts`, through `expo-file-system/legacy`, which
    `hooks/useLogFixtureExport.ts` wraps) writes
    `bolid-replay-<vehicleId>-<flow>-<stamp>.json` and opens the share sheet: a `ReplayFixture`
    with `pairs`, `sequences` and `meta` — `source` (`car` on the real adapter, `simulator` in
    simulator mode — read at export time, which is safe because a source switch clears the log and
    a superseded link logs nothing more, so a simulator session can never pass for validation),
    `vehicleId` (the selected
    profile, or the simulated car), `flow`, `adapter` and `protocol` from the live session, and
    `appVersion` (`APP_VERSION`). On success the copy reads "Saved <file>. Clear the log before
    recording the next flow."; on failure it points at the error log, which always has a
    `settings/replay-export` entry for it. **Clear** puts the default hint back, and the "log is
    full" warning (next) replaces a saved message as soon as the log wraps further. The log keeps only the last
    300 lines: once it has wrapped (`useAdapterLogStore`'s `dropped` > 0), the hint reads "The log
    is full: the oldest N lines were dropped, so the export starts mid-session. Clear the log and
    record a shorter flow.", the saved message says the same, and the fixture records
    `meta.droppedEntries: N`. The file goes into
    `src/shared/obd-core/transport/fixtures/<vehicleId>/` — see
    [simulator.md → Replay fixtures](../simulator.md#replay-fixtures).
  - Units (metric default), poll interval, theme (system/light/dark).
  - **About** (plan 08) — "Bolid Tester <version>" (`APP_NAME` / `APP_VERSION` from
    `shared/lib/appInfo.ts`, read from `app.json`; the version is also the OTA runtime version), a
    note that OTA updates only reach the same version and are checked only from **More → Check for
    updates**, and a **Privacy policy** button that expands the policy in place ("Last updated
    <date>", then each section). The text lives in `model/privacyPolicy.ts` and is published as
    [docs/privacy-policy.md](../privacy-policy.md); `privacyPolicy.test.ts` fails when a heading or
    paragraph differs between the two. See [release.md](../release.md).

## hooks

- `useAdapterSource()` — read/set mock-vs-real + simulated car.
- `useAdapterLogStore((s) => s.entries)` — subscribe to the throttled I/O-log snapshot.

## api (service layer)

- Writes the adapter-source choice that `connectionService` reads when building the `Transport`.

## adapter I/O log (`shared/state/adapterLog.ts`)

- The raw tx/rx traffic is a **module-level ring buffer** (fixed 300 entries, O(1) append), **not**
  a zustand array. It counts the entries it overwrites (`dropped`, reset by **Clear**) and publishes
  the count with the snapshot, so the replay-fixture export can warn that it starts mid-session. `connectionService.withLog` mirrors every tx command and rx chunk into it; a
  separate **throttled publish (~4 Hz, trailing flush)** snapshots the buffer into a tiny zustand
  store (`useAdapterLogStore`) that the UI subscribes to. This kills the per-chunk array copies +
  re-renders the old design did during a CAN sniff (finding F5).
- While the ELM client is in **monitor mode** (`ATMA` sniff), rx mirroring is **paused** — the
  sniffer feature has its own line listener on that firehose, so logging it here would
  double-handle hundreds of frames/sec. tx commands are still logged.
- Text normalisation is obd-core's `logTxText` / `logRxText` (`transport/recordingTransport.ts`,
  shared with `RecordingTransport`): tx loses its line ending; an rx chunk loses the `>` prompt but
  **keeps its line breaks (each as one CR)** and is not trimmed, so an exported fixture still tells several
  ECUs' answers and ISO-TP segment lines apart (plan 02). The log views collapse whitespace when
  they display a line.
- The log is **never persisted** (it never was) and is intentionally not part of `settingsStore`.

## model

- `settingsStore` (Zustand, **persisted**): `adapterSource`, `simulatedVehicleId`, `injectedDtcs`,
  `units`, `pollIntervalMs`, `autoReconnect`, `theme`, and the `ai` config (server URL, model,
  structured-output mode, timeout, key). It no longer holds the adapter I/O log (see above).
- Persisted as `bolid.settings` at **version 3**. Defaults: `adapterSource: 'ble'`,
  `simulatedVehicleId: 'golf-plus-2009-20tdi'`, `injectedDtcs: []`, `autoReconnect: true`.
- **Migrations** (`migrateSettings`, pure and unit-tested; each step only fills _missing_ fields, so
  an explicit stored choice always survives):
  - **v1 → v2** (plan 01): a v1 blob keeps its explicit `adapterSource` and `injectedDtcs` — a tester
    who chose the simulator is never flipped under them — and only missing fields get the new
    defaults (`'ble'`, `[]`).
  - **v2 → v3** (plan 12): `autoReconnect: p.autoReconnect ?? true`. A stored value (including an
    explicit `false`) is kept; a blob without the field, and every fresh install, gets `true`.
    Because v2's `partialize` always wrote `autoReconnect`, upgraded installs keep whatever they had
    (the old default was `false`) — only fresh installs and partial blobs get it on.
  - From v3 on it is the identity. The existing `merge` still deep-merges `ai` over the defaults.
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
- **About** shows the app version from `app.json`; **Privacy policy** expands every section of
  `docs/privacy-policy.md` and collapses again.
- Log shows every command/response pair.
