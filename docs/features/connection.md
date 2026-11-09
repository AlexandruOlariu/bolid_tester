# Feature: connection

Scan for, connect to, and initialize the ELM327 BLE adapter.

## UI

- **ConnectionScreen** (`ui/ConnectionScreen.tsx`, the Connect tab at `/`) — top to bottom:
  - a status card (`StatusHero`, local to the screen) showing `Disconnected / Connecting… /
Initializing… / Connected / Error` with an icon and colour per `ConnState`;
  - the first-run card (`FirstRunCard`, below);
  - the session error, if any, and the **connection diagnostics panel** (below) while in `error`;
  - in simulator mode, a panel to connect the simulated car (with **Use a real adapter**);
  - otherwise the `BluetoothPrompt` banner when the radio is not ready, **Scan for adapters**, the
    device list and, on Android, **Connect by address**.
- **DeviceRow** — one scanned device: name (or "(unnamed)"), id and RSSI, a ⭐ when the name matches
  an adapter hint (`ADAPTER_NAME_HINTS` in `shared/transports/ble/manager.ts`: `vlink`,
  `ios-vlink`, `v-link`, `veepeak`, `obdii`, `obd`, `icar`), and a **Connect** button.
- **SimulatorBanner** — the amber strip on every route (below).
- The shared `StatusBadge` (`shared/ui`) renders the same states as a compact badge; the Connect
  screen uses its own larger `StatusHero` instead.

## First run

The Connect tab shows a three-step **first-run card** (`FirstRunCard`, see
[onboarding](./onboarding.md)) in place of the old "Getting started" hint:

1. **Pick your car** — done when `vehicleStore.selectedProfileId !== 'generic'`, or when the user taps
   **Use Auto / Generic** on the card (recorded as the dismissed hint id `first-run-generic-ok`).
2. **Connect the adapter** — done when `sessionStore.status === 'connected'`.
3. **Read fault codes** — done when `dtcStore.lastReadAt !== null` (set by every successful read from
   a live session — opening Faults while disconnected does not count; the DTC store is in-memory, so
   this is about this session).

Each step's chevron routes to `/vehicle`, `/` (Connect) or `/faults`. The card is dismissible
(`first-run`) and dismisses itself the first time all three steps are done, so it never returns after
a restart. The rules are the pure `onboarding/model/firstRun.ts`, unit-tested.

## Simulator banner

Whenever `settingsStore.adapterSource === 'mock'` (or a simulator session — device id `mock` — is
live), `SimulatorBanner` renders a one-line amber strip
— "Simulator mode · emulating _profile_" — with a **Use real adapter** button. It is mounted in
`src/app/_layout.tsx` through the tab navigator's `screenLayout` (inside `RootErrorBoundary`), not
inside `Screen`, so it sits under the header on every route including hidden ones (`/history`,
`/charts`, …) and never under the status bar.
It is announced as an alert ("Simulator mode is on. Readings are not from a real car.").
**Use real adapter** (also offered on the Connect screen's simulator panel as **Use a real adapter**)
calls `connectionService.switchToRealAdapter()` (= `switchAdapterSource('ble')`, which the Settings
segments use too). The switch invalidates any in-flight connect (a simulator connect still
`connecting`/`initializing` tears itself down instead of publishing its session), cancels a pending
auto-reconnect, resets the session store and flips the source, then closes the old session — a
simulator session never survives the switch. Selecting the source that is already active is a
no-op.

## hooks

- `useScan()` — `{ scanning, devices, start, stop }`. `start()` requests the BLE permissions,
  guards on the radio being `PoweredOn` (so a powered-off adapter fails with clear guidance, not a
  raw error), merges already-connected adapters, then scans for 12 s (`SCAN_TIMEOUT_MS`). `devices`
  is sorted likely adapters first, then by RSSI.
- `useConnect()` — `{ status, error, adapterSource, busy, connect(target?), disconnect() }`.
  `connect` calls `connectionService.connect` and, once the session is `connected`, pushes
  `/vehicle`; errors are surfaced through `sessionStore.error`, not thrown.
- `useBluetoothState(enabled?)` — subscribe to the phone's live Bluetooth radio state
  (`onStateChange`): `ready / poweredOff / unauthorized / unsupported / checking`. Pass `false` in
  simulator mode so the `BleManager` is never constructed. Drives `BluetoothPrompt`.

## api (service layer)

- `connectionService` (`api/connectionService.ts`, exported as a namespace from the slice) —
  `connect(target?: ConnectTarget)` builds the `Transport` (`BleTransport` for `{ deviceId }`, or a
  `MockTransport` over the simulated car per Settings), wraps it so all I/O is mirrored to the
  adapter log, constructs the `DiagnosticSession` (which owns the `Elm327Client`), runs
  `session.connect()` (init → probe → identify), then — on CAN, when the active profile declares
  extended PIDs — reads the engine part number once (`session.readPartNumber()`, `22 F187`) into
  `info.partNumber` (failure is logged as `connection/part-number` and never fails the connect; it
  picks the label pack for the Extended PIDs measuring groups, plan 14), and publishes the session
  with `sessionStore.setConnected`. Also `disconnect()`, `switchAdapterSource(source)`,
  `switchToRealAdapter()`, `resetForRestore()` (the same teardown as a source switch — in-flight
  connect invalidated, auto-reconnect cancelled, adapter log cleared — run before a data restore,
  whose restored settings may change the source; plan 18), `FLAP_PAUSED_MESSAGE`, and the
  simulator dev hooks under `__sim`
  (Settings → Developer). Link-loss, auto-reconnect and the flap guard live here too (below).
- Pure helpers, unit-tested: `reconnect.ts` (`runReconnect`), `flapGuard.ts`
  (`pruneDrops`, `shouldAutoReconnect`), `diagnoseFailure.ts` (`diagnoseFailure`,
  `formatDiagnosticsReport`, `formatLogLine`).

## model

- `shared/state/sessionStore.ts` (`useSessionStore`, shared because every feature reads it):
  `status: ConnState` (`disconnected | connecting | initializing | connected | error`),
  `deviceId`, `deviceName`, `info: SessionInfo | null` (protocol, ELM `version`, `voltage`,
  supported PIDs, VIN, calibration id, engine `partNumber?` …), `error`, `session: DiagnosticSession | null`; actions
  `setStatus`, `setError`, `setConnected`, `markDisconnected` (an unexpected drop: clears the session
  but keeps the device so reconnect can be offered) and `reset`.
- `model/scanStore.ts` (`useScanStore`, in-memory): `scanning`, `devices: ScannedDevice[]`
  (`id`, `name`, `rssi`, `isLikelyAdapter`); `setScanning`, `upsert`, `clear`.
- `model/linkStore.ts` (`useLinkStore`, in-memory): `link: BleLinkInfo | null` (set the moment the
  transport reports `connected`, so a failed init still shows it, and again after a successful
  connect; null for the simulator), `stage: ConnectStage | null` (the furthest stage the latest
  attempt reached: `bluetooth` → `transport` → `init` → `probe` → `identify`; the last three come
  from `DiagnosticSession.connect(onStage)`), `attemptStartedAt` (ms) and
  `device: AttemptDevice | null` (`{ id, name }` of the device this attempt targeted; `sessionStore`
  only learns the device on success). Actions: `beginAttempt(stage, device, now?)` (clears `link`,
  records the first stage, the device and the start time), `setStage` and `setLink`. Written by
  `connectionService.connectInternal`; read by the diagnostics panel.

## Behavior

0. Detect the Bluetooth **radio** state. When it isn't `PoweredOn`, the Connect screen shows a
   `BluetoothPrompt` banner and disables scanning: **off** → one-tap "Turn on Bluetooth" on Android
   (`BleManager.enable()`; iOS points to Control Center), **unauthorized** → "Open settings",
   **unsupported** → guidance to use the simulator. The banner clears itself the moment the radio
   comes on (state subscription).
1. Request BLE permissions (Android 12+ scan/connect; iOS usage description).
2. Scan (or, on Android, enter the adapter's address); the user picks a device. There is no
   auto-connect on launch; only auto-reconnect after a drop (below) reuses the last target.
3. `BleTransport` connects, **discovers** services/characteristics, selects the notify + write pair.
4. Run init: `ATZ → ATE0 → ATL0 → ATS0 → ATH0 → ATAT1 → ATSP0`, probe `0100`, read `ATDPN`/`ATRV`.
5. On success → `connected`, `sessionStore.info` holds protocol, version and voltage; `useConnect`
   navigates to `/vehicle`.

## Link status events & loss

- The `Transport` interface exposes `onStatusChange(listener): unsubscribe`. `BleTransport` emits on
  every transition — including the `device.onDisconnected` callback, so an **unsolicited** drop
  (adapter pulled, out of range) is now observable instead of silently timing out every later
  command. `MockTransport` emits the same transitions and adds a test/sim `simulateDisconnect()` to
  exercise the path with no hardware.
- After a successful connect, `connectionService` subscribes to the transport status. On an
  unexpected `disconnected`/`error` while the store is `connected`/`initializing`, it detaches the
  client, best-effort tears down the (dead) transport, and sets `sessionStore` to `disconnected` with
  an actionable error. A **manual** `disconnect()` detaches the watcher first, so it never takes the
  "link lost" path.
- **Failed-connect teardown.** `connect()`'s catch does a best-effort `session.disconnect()` before
  rethrowing, so a probe failure (ignition off) leaves no GATT link, notify monitor, or attached
  client — a retry after failure works without an app restart.

## Auto-reconnect (on by default, with a flap guard)

- Behind the persisted `settingsStore.autoReconnect` toggle (Settings → Auto-reconnect), **on by
  default** since plan 12 (settings v3; an upgraded install keeps its stored value — see
  [settings](./settings.md#model)). On an unexpected link loss it retries the stored device with
  backoff (2 s / 5 s / 10 s, 3 attempts), surfacing progress via `sessionStore` status `connecting`
  - an "attempt _n_ of 3" message. It aborts immediately on a manual disconnect or a new manual
    connect. The backoff control flow is the pure `reconnect.ts` (`runReconnect`), unit-tested with
    injected timers. When all three attempts fail the session ends in `error` (so the diagnostics
    panel stays up) with "Auto-reconnect failed after 3 attempts. … Last error: _cause_" — the last
    attempt's message is kept so the classifier can still name the cause.
- **Flap guard** (`api/flapGuard.ts`, pure): `handleUnexpectedDrop()` pushes `Date.now()` onto a
  module-level `dropsAt`, prunes it to the last `FLAP_WINDOW_MS` (60 s), and only starts
  auto-reconnect while `shouldAutoReconnect(dropsAt, now)` — fewer than `MAX_DROPS_PER_WINDOW` (3)
  drops in the window, counting the one being handled. So the 1st and 2nd drop in a minute
  reconnect; the 3rd leaves the session `disconnected` with "The link dropped 3 times in a minute —
  auto-reconnect paused. Check the adapter is seated and reconnect manually." (`FLAP_PAUSED_MESSAGE`,
  plus a warning in the error log). A manual `connect()` resets `dropsAt`; reconnect attempts do not.

## BLE link: MTU and chunked writes

- `BleTransport.connect()` asks for `requestMTU: 247` **on Android only** (`Platform.OS`); iOS
  negotiates on its own. Either way it then reads the negotiated value from `device.mtu` (23 when the
  stack reports none) and exposes the link as `linkInfo: BleLinkInfo | null` — `mtu`, `payload`
  (`mtu - 3`, floor 20), `service`, `notifyCharacteristic`, `writeCharacteristic`,
  `writeWithoutResponse`; null while not connected.
- `write(bytes)` slices every command into `payload`-sized GATT writes sent strictly in order. A
  16-byte UDS `2E` coding write is 39 bytes, which used to exceed the 20-byte default payload when
  MTU negotiation failed. Without-response writes go back to back (the adapter buffers its UART input
  until the `\r`); with-response writes are paced by awaiting each acknowledgement.
- If a chunk fails after earlier chunks went out, the adapter holds a command fragment that the next
  write would be appended to (a half-sent `2E` + `010C` would run as one malformed `2E`). Before
  rethrowing, `write()` sends a best-effort `LINE_FLUSH` (`X\r`): `X` is no hex digit and no AT
  command, so the ELM327 answers `?` and sends nothing to the car (a bare `\r` would run the
  truncated fragment). The client drains that reply (see the drain section below).

## Adapter sleep / wake

- ELM327 adapters (the Vgate included) auto-sleep when idle; the first byte wakes the chip and the
  command that carried it is lost, which used to surface as a confusing timeout.
- `Elm327Options.wakeAfterIdleMs` (default 20 000 ms, `0` disables): the client tracks `lastIoAt`
  (any byte out or in) and, before a queued command after a longer silence, runs a **wake-up**:
  writes a short command, waits up to `WAKE_TIMEOUT_MS` (600 ms) for a `>` (resolves either way,
  never rejects), clears the buffer, then sends the real command. Monitor mode is exempt. `init()`
  stamps `lastIoAt` after `ATZ`, so a fresh connection wakes at most once (before `ATZ`).
- The wake-up is a **bare `\r`** only when the last command is safe to repeat (`isRepeatSafe`: OBD
  reads, UDS `22`/`19` reads, `3E`, idempotent AT settings/queries) — a real ELM327 **repeats the
  previous command** on a bare CR, and repeating a clear (`04`/`14`), a write (`2E`), a routine
  (`31`), an output test (`2F`), a reset or `ATMA` would be unsafe. Otherwise (and on a fresh
  connection, where the last command is unknown) it wakes with the harmless `ATI`. The client only
  trusts commands the adapter is known to have run: a command that **timed out** or whose **write
  failed** (and an `ATI` wake-up that got no `>`) resets `lastCmd` to unknown, because a sleeping
  adapter may have swallowed it and still remember an older, unsafe one (`04` → swallowed `03` →
  a bare-CR wake would clear the codes again). While CAN
  auto-formatting is off (`ATCAF0`, the TP2.0 raw-CAN link) every hex write is a raw CAN frame — a
  TP2.0 data frame can start with `01`/`22`/… and carry a write — so only AT commands count as
  repeat-safe (`isRepeatSafe(last, rawCan)`; `ATCAF1` and `ATZ`/`ATWS`/`ATD` end the mode).
- A wake-up that times out starts the same **drain** as a timed-out command (below): a bare `\r`
  repeats the last command, which can be a slow `19…`/`22…` read or a K-line request, and its late
  `>` must not resolve the real command.
- `connectionService` passes `wakeAfterIdleMs: 20_000` for BLE and `0` for the simulator, unless the
  scenario models sleep (`sleepAfterIdleMs`), in which case it uses half that gap.

## Drain-until-prompt after a timeout

- `Elm327Client.exec()` clears its buffer on entry, so a reply that arrived after its command timed
  out used to land in the next command's window and resolve the wrong promise.
- Now a timeout also starts a **drain**: the client keeps accumulating, and when the late reply's `>`
  arrives it discards everything through it (never touching `pending`). The next command awaits the
  drain — prompt seen or `DRAIN_GRACE_MS` (300 ms) elapsed, whichever is first — then proceeds. A
  late reply inside the grace period can only ever be discarded, never mis-attributed; the cost is at
  most 300 ms after a timeout. A failed write starts the same drain (a partial write can still draw
  a reply, e.g. the `?` to `LINE_FLUSH`).

## Connection diagnostics panel

- `ui/ConnectionDiagnostics.tsx`, mounted under the error `Panel` on `ConnectionScreen`, renders
  whenever `sessionStore.status === 'error'` (`accessibilityLabel="Connection diagnostics"`): a
  **stage** chip, a title, a plain-English explanation and up to four suggestions; a collapsible
  **Details** (closed by default) shows this attempt's last 20 adapter-log entries (`» tx` / `« rx`,
  a bare-CR wake-up as `(wake-up)`), the `linkStore` values when present (MTU, payload, service,
  write mode), the device name/id of **this attempt** (`linkStore.device` — `sessionStore` only learns
  the device on success and keeps the previous one after a drop) and the furthest stage reached, with
  **Copy details**
  (`Share.share({ message })` — no clipboard dependency) and **Open error log** (`/error-log`).
- The rules are the pure `api/diagnoseFailure.ts` (`diagnoseFailure(input): FailureDiagnosis`),
  first match wins. Stages: `bluetooth | transport | init | probe | identify`.
  1. Real adapter and the radio is off / unauthorized / unsupported → `bluetooth` (the
     `BluetoothPrompt` wording; a still-settling radio is not evidence).
  2. Error `No suitable notify…` → `transport`: not a serial-over-BLE adapter, maybe classic
     Bluetooth (SPP) — not supported yet (plan 27).
  3. Error mentions permission → `bluetooth` (permission needed).
  4. A timeout whose last command was `ATZ` → `init`: "accepted the link but did not answer `ATZ` —
     it is unpowered or asleep".
  5. "vehicle isn't responding" (DiagnosticSession's probe error) → `probe`, ignition guidance —
     unless rule 6 also matches, since a failed bus start-up ends in the same error.
  6. The log tail contains `UNABLE TO CONNECT` or `BUS INIT` → `probe`, K-line guidance. The rx
     entries are joined with whitespace removed first: on BLE each entry is one notification (≤ 20
     bytes at MTU 23), so the message can be split across two.
  7. A timeout whose last command was an OBD request → `identify`.
  8. Anything else → `transport` with the raw error.
- The panel only feeds the classifier entries newer than `linkStore.attemptStartedAt`, so an older
  session's traffic cannot mislead it. `formatDiagnosticsReport` builds the shared text.

## Troubleshooting — adapter visible in Android Bluetooth settings but not in the scan

A BLE peripheral that the OS has already **bonded and connected to** stops advertising, so
`startDeviceScan` can't surface it. This is the usual cause of "it's in Android’s Bluetooth list but
the app never lists it." The connection flow handles it as follows:

- **Already-connected adapters are surfaced directly.** `useScan` also calls
  `BleManager.connectedDevices(OBD_SERVICE_UUIDS)` (common ELM327 services, see `manager.ts`) and
  merges those into the device list before the scan results.
- **Connect by address (Android).** The Connect screen offers a manual MAC entry; on Android
  `connectToDevice(mac)` works even for a device that never appears in a scan. iOS uses opaque
  device UUIDs (not MACs), and per the adapter doc you don't pair a BLE adapter on iOS — you scan.
- **Permission / scan failures are no longer silent.** A denied permission or a scan error sets a
  visible error on the Connect screen and is recorded in the **Error log** (`source: connection/scan`).
- Other user-side checks: turn **Location** on for Android 11 and below (BLE scanning requires it
  there); make sure the unit is a **BLE / "4.0"** adapter (a Bluetooth Classic / SPP "3.0" ELM327
  can't be reached by `react-native-ble-plx` at all); or **"Forget"** the device in Android settings
  so it advertises again.

## Acceptance

- A fresh install opens on **Scan for adapters** with the first-run card and no simulator banner.
- Settings → **Simulator (no car)** shows the amber banner on Connect, Live, Faults, More and hidden
  routes; **Use real adapter** switches back and disconnects a live simulator session.
- Completing pick-car → connect → read faults auto-dismisses the first-run card for good.
- Connects to the simulator in dev with no hardware (Settings → Simulator (no car)).
- With Bluetooth off, the Connect screen prompts to enable it (one-tap on Android) and re-enables
  scanning automatically once the radio is on — never a raw "powered off" scan error.
- Surfaces a clear error on permission denial, no device, or failed init.
- Already-connected/bonded adapters are listed (or reachable by address) even when not advertising.
- Never hard-codes characteristic UUIDs.
- Killing the link mid-session (sim `simulateDisconnect()` or pulling the adapter) flips the UI to
  disconnected within a poll interval with one actionable error entry — no timeout cascade. A failed
  ignition-off connect followed by a successful retry works without restarting the app.
- Simulator connected → Settings → Developer → **Simulate a link drop** reconnects on its own
  without touching the toggle; the third drop in a minute stops with the pause message.
- Settings → Developer → **Fail next connect: no reply to ATZ**, then connect → the diagnostics
  panel opens at stage "Adapter start-up" with the unpowered / asleep suggestion.
- A 16-byte coding write succeeds over a BLE link stuck at MTU 23 (unit test through a BLE fake).
- A late reply after a timeout is never attributed to the next command; an adapter that went to
  sleep is woken before the next command (unit tests against the simulator).
- On-car pending (plan 12, deferred): the Vgate's real sleep delay and whether a bare `\r` wakes it,
  the negotiated MTU on the owner's phones, and one walk-out-of-range reconnect + flap-guard check.
