# Feature: connection

Scan for, connect to, and initialize the ELM327 adapter — Bluetooth LE, Wi-Fi over TCP (plan 26),
Classic Bluetooth (SPP) on Android (plan 27), or Bluetooth LE through **Web Bluetooth** in the
browser build (plan 28, [web](../web.md)).

## UI

- **ConnectionScreen** (`ui/ConnectionScreen.tsx`, the Connect tab at `/`) — top to bottom:
  - a status card (`StatusHero`, local to the screen) showing `Disconnected / Connecting… /
Initializing… / Connected / Error` with an icon and colour per `ConnState`;
  - the first-run card (`FirstRunCard`, below);
  - the session error, if any, and the **connection diagnostics panel** (below) while in `error`;
  - in simulator mode, a panel to connect the simulated car (with **Use a real adapter**);
  - with the **Wi-Fi** source (`testID="connect-wifi"`), a panel — "Join the adapter's Wi-Fi network
    first (usually `WiFi_OBDII`, no password). On Android, if the phone warns the network has no
    internet, choose _Stay connected_." — the adapter address from Settings
    (`connect-wifi-endpoint`), **Connect over Wi-Fi** and **Use a Bluetooth adapter**; no scan and no
    `BleManager` (see [Wi-Fi adapters](#wi-fi-adapters-tcp-plan-26));
  - with the **Classic Bluetooth** source (Android only, `testID="connect-spp"`, `ui/SppConnect.tsx`),
    the **Paired adapters** list (the phone's bonded devices, likely adapters first, each a
    `DeviceRow`), the note that the bus sniffer is not available over classic Bluetooth, an empty
    state (`connect-spp-empty`) — "Pair the adapter first: Android Settings → Bluetooth → pair
    `OBDII` (PIN 1234 or 0000), then come back." — **Open Bluetooth settings**
    (`Linking.sendIntent('android.settings.BLUETOOTH_SETTINGS')`, falling back to
    `Linking.openSettings()`), **Refresh**, a list error (`connect-spp-error`: Bluetooth off,
    permission denied, module missing) and **Use a Bluetooth LE adapter**; no scan and no
    `BleManager` (see [Classic Bluetooth](#classic-bluetooth-spp-android--plan-27));
  - with the Bluetooth source **in the browser** (`Platform.OS === 'web'`,
    `ui/WebBluetoothConnect.tsx`, `testID="connect-web-bluetooth"`): no scan list and no address
    entry — a short how-to, the note "Works in Chrome and Edge on a computer or an Android phone,
    over HTTPS. Not in Safari, Firefox or on an iPhone." (`web-bt-note`), one **Choose adapter &
    connect** button (`web-bt-choose`) and **No adapter? Try the simulator**. A browser without Web
    Bluetooth shows the blocking panel "Bluetooth adapters are not supported in this browser"
    (`web-bt-unsupported`) with **Use the simulator** (see [Web Bluetooth](#web-bluetooth-browser--plan-28));
  - otherwise (Bluetooth) the `BluetoothPrompt` banner when the radio is not ready, **Scan for
    adapters**, the device list, on Android **Connect by address**, a small **Using a Wi-Fi
    adapter instead?** link that switches the source to Wi-Fi and, on Android only, **Using a
    classic Bluetooth (3.0) adapter instead?**.
  - The subtitle follows the source ("Pair with your OBD2 Bluetooth adapter" / "Connect to your
    Wi-Fi OBD2 adapter" / "Connect to your paired classic Bluetooth adapter").
  - When a stored Classic Bluetooth source was replaced on iOS (below), a one-time notice
    (`adapter-source-notice`, `settingsStore.adapterSourceNotice`) with **OK**.
- **DeviceRow** — one scanned (or paired) device: name (or "(unnamed)"), id and RSSI (none for a
  paired device), a ⭐ when the name matches an adapter hint (`ADAPTER_NAME_HINTS` in the pure
  `shared/transports/adapterNames.ts`, re-exported by `ble/manager.ts`: `vlink`, `ios-vlink`,
  `v-link`, `veepeak`, `obdii`, `obd`, `icar`, `elm327`), and a **Connect** button labelled
  "Connect to _name_" for screen readers.
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
  (`onStateChange`): `ready / poweredOff / unauthorized / unsupported / checking`. The Connect
  screen passes `adapterSource === 'ble'`, so neither the simulator, Wi-Fi nor Classic Bluetooth ever
  constructs the `BleManager`. Drives `BluetoothPrompt`.
- `usePairedAdapters(enabled)` — `{ devices, loading, loaded, error, refresh }` for the Classic
  Bluetooth picker: requests the Classic Bluetooth permission
  (`requestClassicBluetoothPermissions`: `BLUETOOTH_CONNECT` — "Nearby devices" — on API 31+;
  nothing on older Android, where the install-time `BLUETOOTH` / `BLUETOOTH_ADMIN` cover the bonded
  list and RFCOMM, so the BLE location prompt never appears), then
  `connectionService.listPairedAdapters()`; reads again on **Refresh** and whenever the app returns
  to the foreground (back from pairing in Android settings). The foreground re-read only **checks**
  the permission (`checkClassicBluetoothPermissions`, no system dialog) and is skipped while a request is in flight: the permission dialog itself pauses
  the activity, and its close must not prompt a second time. Failures are shown as `error` and
  logged (`connection/paired-adapters`, warning).

## api (service layer)

- `connectionService` (`api/connectionService.ts`, exported as a namespace from the slice) —
  `connect(target?: ConnectTarget)` builds the `Transport` (`BleTransport` for `{ deviceId }`, a
  `TcpTransport` to `settings.wifi` for the Wi-Fi source, an `SppTransport` to the paired
  `{ deviceId }` for the Classic Bluetooth source, or a `MockTransport` over the simulated car per
  Settings), wraps it so all I/O is mirrored to the adapter log (the wrapper forwards the
  transport's `capabilities`), constructs the `DiagnosticSession` (which owns the `Elm327Client`), runs
  `session.connect()` (init → probe → identify), then — on CAN, when the active profile declares
  extended PIDs — reads the engine part number once (`session.readPartNumber()`, `22 F187`) into
  `info.partNumber` (failure is logged as `connection/part-number` and never fails the connect; it
  picks the label pack for the Extended PIDs measuring groups, plan 14), and publishes the session
  with `sessionStore.setConnected`. Also `disconnect()`, `switchAdapterSource(source)`,
  `switchToRealAdapter()`, `resetForRestore()` (the same teardown as a source switch — in-flight
  connect invalidated, auto-reconnect cancelled, adapter log cleared — run before a data restore,
  whose restored settings may change the source; plan 18), `FLAP_PAUSED_MESSAGE`,
  `setTcpSocketFactory(factory?)` (test seam: Wi-Fi sockets from a fake instead of
  `react-native-tcp-socket`), `listPairedAdapters()` (the Classic Bluetooth picker's list),
  `setSppModuleLoader(loader?)` (test seam: a fake `react-native-bluetooth-classic`),
  `chooseWebAdapterAndConnect()` / `pickWebBluetoothAdapter()` / `isWebBluetoothSupported()` and
  `setWebBluetooth(bt?)` (the browser build and its test seam, plan 28), and the
  simulator dev hooks under `__sim`
  (Settings → Developer & simulator). Link-loss, auto-reconnect and the flap guard live here too (below).
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
- `model/linkStore.ts` (`useLinkStore`, in-memory): `kind: 'ble' | 'wifi' | 'spp' | null` (the latest
  attempt's link kind; null for the simulator), `link: BleLinkInfo | null` (set the moment the
  transport reports `connected`, so a failed init still shows it, and again after a successful
  connect; null for the simulator), `stage: ConnectStage | null` (the furthest stage the latest
  attempt reached: `bluetooth` → `transport` → `init` → `probe` → `identify`; the last three come
  from `DiagnosticSession.connect(onStage)`), `attemptStartedAt` (ms) and
  `device: AttemptDevice | null` (`{ id, name }` of the device this attempt targeted; `sessionStore`
  only learns the device on success; for Wi-Fi `{ id: '192.168.0.10:35000', name: 'Wi-Fi ELM327' }`;
  for Classic Bluetooth the paired MAC and its name, or "Classic Bluetooth adapter").
  Actions: `beginAttempt(stage, device, kind?, now?)` (clears `link`, records the first stage, the
  device, the link kind and the start time), `setStage` and `setLink`. Written by
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
- **No command outlives its session** (plan W2). `DiagnosticSession.disconnect()` closes the ELM327
  client (`Elm327Client.close()`): the command in flight and every queued one reject at once with
  `Elm327ClosedError` ("ELM327 link closed"), its timeout timer is cleared, a drain or monitor mode
  ends, and later commands are refused before they write (`connect()` on the same session reopens
  it). A screen's reads cut off by a disconnect therefore fail immediately instead of timing out
  seconds later; the live-data poll loop does not log that error (the session is simply gone).
  `MockTransport.write` rejects while disconnected, like `BleTransport`.
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

## Wi-Fi adapters (TCP, plan 26)

Wi-Fi ELM327 adapters (the `WiFi_OBDII` class) run their own access point and listen on a fixed TCP
address — almost always **`192.168.0.10:35000`**. They need no Bluetooth permission and work on iOS
without MFi.

- **Transport.** `shared/transports/tcp/TcpTransport.ts` implements `Transport` over an injected
  `TcpSocketFactory`; the app's `defaultSocketFactory` uses
  [`react-native-tcp-socket`](https://github.com/Rapsssito/react-native-tcp-socket) 6.x
  (`createConnection({ host, port, connectTimeout }, onConnect)`, autolinked — no config plugin),
  loaded through a variable specifier so Jest and web never resolve it (a build without the module
  fails the connect with "Wi-Fi adapters need the TCP socket module…"). Nagle is turned off on
  connect (`setNoDelay(true)`): every ELM327 command is a few bytes waiting for its reply.
- **Status.** `connecting` → `connected` on the socket's `connect`; a socket `error` / `close` before
  that, or no connect within **5 s** (`DEFAULT_CONNECT_TIMEOUT_MS`), → `error` with a message naming
  the address (`Could not reach the Wi-Fi adapter at …: <socket error>`, `No answer from the Wi-Fi
adapter at … within 5 s (ETIMEDOUT)`). After connecting, an unsolicited `close` → `disconnected`
  and an unsolicited `error` → `error`, so the link-loss handling and auto-reconnect below treat a
  Wi-Fi drop exactly like a BLE one. A manual `disconnect()` destroys the socket and emits only
  `disconnected`; a `disconnect()` during a connect cancels it (`TcpConnectCancelledError`). String
  `data` chunks are converted with `stringToBytes`, Buffers are copied into plain `Uint8Array`s.
- **Endpoint.** `shared/transports/tcp/endpoint.ts` (pure): `parseEndpoint('host:port')` (IPv4 or
  host name, port 1–65535, else null), `formatEndpoint`, `isValidEndpoint`,
  `DEFAULT_WIFI_ENDPOINT`. Edited in Settings → Developer & simulator → Adapter source → **Wi-Fi
  adapter** ([settings](./settings.md)).
- **Connect.** `connectInternal` builds `new TcpTransport(settings.wifi)` — no permission request,
  `wakeAfterIdleMs` as for BLE (real adapters sleep), the attempt device
  `{ id: '<host>:<port>', name: 'Wi-Fi ELM327' }`, adapter-log origin
  `{ source: 'car', deviceId: '<host>:<port>' }`. `lastTarget` stays undefined: auto-reconnect
  re-reads the endpoint from settings.
- **Android.** A Wi-Fi network without internet makes Android warn ("This network has no internet
  access") and may move traffic back to mobile data; the user chooses **Stay connected**. If the
  connect still fails, turning mobile data off helps (diagnostics suggestion).
- **iOS.** iOS 14+ asks for **Local Network** access the first time the app opens a socket on the
  LAN; the prompt text is `ios.infoPlist.NSLocalNetworkUsageDescription` in `app.json` ("Bolid
  Tester connects to a Wi-Fi OBD2 adapter on your local network."). A denied permission shows up as
  an unreachable host; the diagnostics point to Settings → Privacy & Security → Local Network.
- **Tests.** `TcpTransport.test.ts` (fake socket: every status transition, timeout, conversion,
  teardown, the default factory against a virtual module), `endpoint.test.ts`,
  `TcpTransport.session.integration.test.ts` (`DiagnosticSession` over `TcpTransport` whose fake
  socket plays the simulated Golf through `bridgeToMock`, see [simulator](../simulator.md)), the
  Wi-Fi cases in `connectionService.test.ts`, `diagnoseFailure.test.ts` and
  `ConnectionScreen.test.tsx`.
- **Out of scope:** discovering the adapter address automatically (mDNS / UDP broadcast), Wi-Fi
  networks with a password (classic Bluetooth: next section). Verifying a real Wi-Fi adapter on
  Android and iOS is on-car pending (plan 26 § Deferred).

## Classic Bluetooth (SPP, Android — plan 27)

The cheap "Bluetooth 3.0" ELM327 adapters use the Serial Port Profile over classic Bluetooth
(RFCOMM), which `react-native-ble-plx` cannot reach at all. On Android they connect through an
`SppTransport` behind the same `Transport` interface.

- **Library.** [`react-native-bluetooth-classic`](https://github.com/kenjdavidson/react-native-bluetooth-classic)
  `1.73.0-rc.17` (pinned — the package has shipped only release candidates for years; autolinked,
  no config plugin; its Android manifest adds `BLUETOOTH` / `BLUETOOTH_ADMIN` up to API 30 and
  `BLUETOOTH_CONNECT` / `BLUETOOTH_SCAN` from 31, which `app.json` already declares). Loaded by
  `defaultSppModule` through a variable specifier, so Jest and web never resolve it; a build without
  it fails with "Classic Bluetooth is not available in this build…".
- **Transport.** `shared/transports/spp/SppTransport.ts` over an injected `SppModuleLike`:
  `connectToDevice(address, { delimiter: '>', charset: 'ascii' })`, writes as ASCII strings
  (`device.write`), `onDataReceived` per message. The library
  delivers data **per delimiter, delimiter stripped**; the ELM327 ends every reply with its prompt
  `>`, so the transport re-appends `>` to each message before the ELM client sees it.
- **Status.** `connecting` → `connected`; a socket failure → `error` with `Could not open the
Classic Bluetooth adapter <MAC>: <library error>` (typically "read failed, socket might closed or
  timeout"). A **drop** → `disconnected` once, so link loss and auto-reconnect treat it like a BLE
  drop; `lastTarget` keeps the MAC, so auto-reconnect replays it unchanged. The library reports a
  drop two ways, and the transport listens to both: the global `DEVICE_DISCONNECTED` event (sent
  only when the whole Bluetooth ACL link drops; other addresses are ignored) and the per-device
  `DEVICE_DISCONNECTED@<MAC>` event (sent when only the RFCOMM socket's read thread fails — the ACL
  link may stay up, so the global event can come late or never; subscribed through the module's
  `createBluetoothEventSubscription`). A failed write is a drop too: once the socket is gone the
  library rejects writes with "Not connected to <MAC>" (or a socket write fails, or `write`
  resolves `false`), and the transport closes the native connection best-effort and reports
  `disconnected` instead of failing every later command with the status stuck on `connected`. A
  manual `disconnect()` unsubscribes first, closes the device and emits only `disconnected`; a
  disconnect during a connect cancels it (`SppConnectCancelledError`) and closes the late socket.
  If the library still holds a connection to the address (e.g. after a JS reload),
  `connectToDevice` resolves with that existing connection rather than failing — it keeps the
  options it was opened with, which are always `SPP_CONNECT_OPTIONS` in this app.
- **No sniffer.** `SppTransport.capabilities = { monitor: false }`: monitor mode (`ATMA`) streams
  lines ending in `\r` with no prompt until interrupted, which a `>`-delimited link never hands
  over. `DiagnosticSession.startSniffer()` (and `Elm327Client.startMonitor()`) reject with "Bus
  monitoring is not available over this adapter link" before sending anything, and the Bus sniffer
  screen shows that instead of **Start** ([can-sniffer](./can-sniffer.md)).
- **Pairing, no scanning.** `listBondedAdapters()` / `connectionService.listPairedAdapters()` read
  the phone's bonded devices (refusing with "Bluetooth is off…" while the radio is off), flag
  likely adapters with the shared name hints and sort them first. Discovery of unpaired devices is
  out of scope: the user pairs the adapter in Android Settings → Bluetooth (usually `OBDII`, PIN
  `1234` or `0000`) — **Open Bluetooth settings** jumps there.
- **Connect.** `connectInternal`'s SPP branch: a picked target is required ("Select a paired adapter
  first"), `requestClassicBluetoothPermissions()` (CONNECT on API 31+, no prompt on older Android;
  "Bluetooth permission denied" when refused),
  `new SppTransport(target.deviceId)`, `wakeAfterIdleMs` as for BLE, attempt device
  `{ id: <MAC>, name: <paired name> ?? 'Classic Bluetooth adapter' }`, `linkStore.kind = 'spp'`,
  adapter-log origin `{ source: 'car', deviceId: <MAC> }`.
- **iOS: unsupported, hidden.** Apple lets an app open a classic Bluetooth accessory only through
  the MFi (Made for iPhone) programme and its External Accessory framework; ELM327 clones are not
  MFi-certified, so no App Store app can open them. The Settings segment and the Connect-screen
  link render only when `Platform.OS === 'android'`. A stored `'spp'` source on another platform (a
  backup restored from an Android phone) falls back to `'ble'` when the settings hydrate, with a
  one-time notice — `settingsStore.setSettingsPlatform(Platform.OS)` (called by the root layout)
  feeds the `merge` rule and also applies the fallback if hydration already ran. Either way the
  fallback is written back to `bolid.settings.json`, so the notice really is one-time.
- **Tests.** `SppTransport.test.ts` (fake module: status transitions, re-appended prompt, drop for
  this address only, socket-closed event, write failure as a drop, manual disconnect, cancel,
  capability, bonded list, the
  default loader against a virtual module), `SppTransport.session.integration.test.ts`
  (`DiagnosticSession` over `SppTransport` whose fake device re-chunks the simulated Golf **by `>`**
  through `bridgeToMock`: identify, `010C`, `readDtcs('03')`, sniffer refused), the SPP cases in
  `connectionService.test.ts`, `diagnoseFailure.test.ts`, `settingsStore.test.ts`,
  `ConnectionScreen.test.tsx`, `SettingsScreen.test.tsx` and `SnifferScreen.test.tsx`.
- **Out of scope:** iOS classic Bluetooth, discovery / scanning of unpaired SPP devices, `ATMA`
  streaming over SPP. The installed library's Android source also accepts an empty `delimiter`
  (every read handed over as-is), which would allow `ATMA`; switching to it needs a real adapter
  first (plan 27 § Deferred). A real SPP adapter on the owner's phone: on-car pending.

## Web Bluetooth (browser — plan 28)

The web build ([web](../web.md)) reaches a Bluetooth LE ELM327 through the browser's Web Bluetooth
API (Chrome / Edge on desktop and Android, over HTTPS) with `WebBluetoothTransport`
(`src/shared/transports/web-ble/WebBluetoothTransport.ts`), the same `Transport` interface as every
other link. It is pure (no React Native, no `react-native-ble-plx`) and written against narrow
`WebBluetoothLike` / `WebBt*` interfaces so the Node tests inject a fake GATT.

- **Picking.** `WebBluetoothTransport.pickDevice(bt)` calls `requestDevice({ acceptAllDevices: true,
optionalServices: OBD_SERVICE_UUIDS })` — the four ELM327 services now live in the pure
  `shared/transports/common/obdServiceUuids.ts` (re-exported by `ble/manager.ts`). Chrome opens the
  chooser only inside a user gesture, so `useConnect().chooseAndConnect()` is wired straight to the
  **Choose adapter & connect** press and calls `connectionService.chooseWebAdapterAndConnect()`,
  which picks first and then connects. The pick travels on the target
  (`ConnectTarget.webDevice`), so `lastTarget` replays it and **auto-reconnect** reopens the same
  device with `gatt.connect()` — no second chooser.
- **Connecting.** `connect()`: `gatt.connect()` → `getPrimaryServices()` → the first service with a
  notify (or indicate) **and** a write characteristic → `startNotifications()` → `connected`
  (mirroring `BleTransport.selectCharacteristics`; no hard-coded characteristic UUIDs). No
  suitable service → `error`, GATT closed, "No suitable notify + write characteristics found on
  this device". A disconnect during connect tears the half-built link down.
- **Data.** Each `characteristicvaluechanged` `DataView` is copied out (only its own window of the
  buffer). Writes go in **20-byte chunks** (no MTU API on the web) with
  `writeValueWithoutResponse` when the characteristic allows it, else `writeValueWithResponse` /
  `writeValue`; a chunk failing partway sends the same `LINE_FLUSH` as the native transport.
  Separate `write()` calls are **queued** (one GATT operation at a time): the ELM327 client fires
  command writes without awaiting them, and Chrome rejects a second operation while one is pending
  ("GATT operation already in progress") where ble-plx on the phone queues it.
  `linkInfo` reports MTU 23 / payload 20, so the diagnostics panel works unchanged.
- **Link loss.** `gattserverdisconnected` → `disconnected` once (listeners removed first, so a
  manual `disconnect()` is not mistaken for a drop) → the usual link-lost handling and
  auto-reconnect.
- **Errors.** `describeWebBluetoothError(e)` turns the browser's `DOMException` names into plain
  English: a cancelled chooser (`NotFoundError`) → "No adapter was chosen…" — shown as a message
  with the app **disconnected** (not a failed connection, so no diagnostics panel — an earlier
  failed attempt's `error` is reset to `disconnected` too, so its stale diagnostics close); while a
  session is live or in flight (`connected`, `connecting`, `initializing`, or an auto-reconnect run,
  including its back-off pause) the session is left untouched and the message is only a toast; a device
  without the OBD2 services; `SecurityError` (HTTPS / user gesture); `NotAllowedError` (Bluetooth
  blocked for the site); `NetworkError` (link could not be opened). A browser without
  `navigator.bluetooth` → the not-supported panel, simulator still offered.
- **Native stack off.** On web `getBleManager()` throws "Bluetooth LE via react-native-ble-plx is
  not available on web" and the Connect screen calls `useBluetoothState(false)`, so ble-plx is never
  touched. Settings hides **Wi-Fi adapter** and **Classic Bluetooth** on the web
  (`isAdapterSourceSupported(source, 'web')`); a stored Wi-Fi / SPP source falls back to Bluetooth LE
  with `WEB_SOURCE_FALLBACK_NOTICE`.
- **Tests:** `WebBluetoothTransport.test.ts` (fake GATT: service pick, notifications, 20 + 19 chunking,
  `writeValue` fallback, with-response writes, line flush, queued writes, one `disconnected`, manual disconnect,
  reconnect without a chooser, no-service rejection, disconnect during connect, error texts),
  `WebBluetoothTransport.session.integration.test.ts` (`DiagnosticSession` over the bridged Golf:
  identify, `010C`, `readDtcs('03')`), the Web Bluetooth cases in `connectionService.test.ts`,
  `ConnectionScreen.test.tsx`, `SettingsScreen.test.tsx` and `settingsStore.test.ts`.
- **On-car pending** (plan 28 § Deferred): the Vgate from Chrome on Android and on a laptop (chooser
  name, service UUID, latency grade), and whether it needs the 20-byte chunking.

## Connection diagnostics panel

- `ui/ConnectionDiagnostics.tsx`, mounted under the error `Panel` on `ConnectionScreen`, renders
  whenever `sessionStore.status === 'error'` (`accessibilityLabel="Connection diagnostics"`): a
  **stage** chip, a title, a plain-English explanation and up to four suggestions; a collapsible
  **Details** (closed by default) shows this attempt's last 20 adapter-log entries (`» tx` / `« rx`,
  a bare-CR wake-up as `(wake-up)`), the `linkStore` values when present (MTU, payload, service,
  write mode), the device name/id of **this attempt** (`linkStore.device` — `sessionStore` only learns
  the device on success and keeps the previous one after a drop), "Link: Wi-Fi (TCP socket) to
  `<host>:<port>`" for a Wi-Fi attempt, "Link: Classic Bluetooth (serial port) to `<MAC>`" for a
  Classic Bluetooth attempt, and the furthest stage reached, with
  **Copy details**
  (`Share.share({ message })` — no clipboard dependency) and **Open error log** (`/error-log`).
- The rules are the pure `api/diagnoseFailure.ts` (`diagnoseFailure(input): FailureDiagnosis`),
  first match wins. Stages: `bluetooth | transport | init | probe | identify` (the `transport` chip
  reads "Wi-Fi link" for the Wi-Fi source and "Classic Bluetooth link" for the Classic Bluetooth
  source — `stageLabel(stage, source)`).
  1. Bluetooth source and the radio is off / unauthorized / unsupported → `bluetooth` (the
     `BluetoothPrompt` wording; a still-settling radio is not evidence). - 1b. Wi-Fi source and the error matches `ECONNREFUSED | ETIMEDOUT | EHOSTUNREACH |
ENETUNREACH`, "connection refused", "no route to host", "network is unreachable" or
     `TcpTransport`'s own wording → `transport`: "The phone is not on the adapter's Wi-Fi network,
     or the adapter uses a different address", with: join the `WiFi_OBDII` network (Android:
     _Stay connected_), check `192.168.0.10`, port `35000`, turn mobile data off, allow Local
     Network on iPhone (plan 26). - 1c. Classic Bluetooth source and the error matches `socket | read failed | connection refused |
service discovery failed` (Android RFCOMM failures) → `transport`: "The adapter is paired but
     not reachable", with: power-cycle the adapter, make sure no other app (e.g. Torque) holds the
     connection, keep the phone close with the ignition on, re-pair it (PIN 1234 / 0000) (plan 27).
  2. Error `No suitable notify…` → `transport`: not a serial-over-BLE adapter, maybe a classic
     Bluetooth (SPP) one — on Android, pair it and choose Classic Bluetooth as the adapter source.
  3. Error mentions permission (not on Wi-Fi) → `bluetooth` (permission needed).
  4. A timeout whose last command was `ATZ` → `init`: "accepted the link but did not answer `ATZ` —
     it is unpowered or asleep".
  5. "vehicle isn't responding" (DiagnosticSession's probe error) → `probe`, ignition guidance —
     unless rule 6 also matches, since a failed bus start-up ends in the same error.
  6. The log tail contains `UNABLE TO CONNECT` or `BUS INIT` → `probe`, K-line guidance. The rx
     entries are joined with whitespace removed first: on BLE each entry is one notification (≤ 20
     bytes at MTU 23), so the message can be split across two.
  7. A timeout whose last command was an OBD request → `identify`.
  8. Anything else → `transport` with the raw error. Rules 4, 7 and 8 word their link suggestions
     for the source (the Wi-Fi network instead of Bluetooth; rule 4 on Classic Bluetooth: close any
     other OBD2 app holding the adapter).
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
  can't be reached by `react-native-ble-plx` at all — on Android, pick **Classic Bluetooth** as the
  adapter source instead and choose it from the paired list); or **"Forget"** the device in Android
  settings so it advertises again.

## Acceptance

- A fresh install opens on **Scan for adapters** with the first-run card and no simulator banner.
- Settings → **Developer & simulator** → **Simulator (no car)** shows the amber banner on Connect, Live, Faults, More and hidden
  routes; **Use real adapter** switches back and disconnects a live simulator session.
- Completing pick-car → connect → read faults auto-dismisses the first-run card for good.
- Connects to the simulator in dev with no hardware (Settings → Developer & simulator → Simulator (no car)).
- With Bluetooth off, the Connect screen prompts to enable it (one-tap on Android) and re-enables
  scanning automatically once the radio is on — never a raw "powered off" scan error.
- Surfaces a clear error on permission denial, no device, or failed init.
- Already-connected/bonded adapters are listed (or reachable by address) even when not advertising.
- Never hard-codes characteristic UUIDs.
- Killing the link mid-session (sim `simulateDisconnect()` or pulling the adapter) flips the UI to
  disconnected within a poll interval with one actionable error entry — no timeout cascade. A failed
  ignition-off connect followed by a successful retry works without restarting the app.
- Simulator connected → Settings → Developer & simulator → **Simulate a link drop** reconnects on its own
  without touching the toggle; the third drop in a minute stops with the pause message.
- Settings → Developer & simulator → **Fail next connect: no reply to ATZ**, then connect → the diagnostics
  panel opens at stage "Adapter start-up" with the unpowered / asleep suggestion.
- A 16-byte coding write succeeds over a BLE link stuck at MTU 23 (unit test through a BLE fake).
- A late reply after a timeout is never attributed to the next command; an adapter that went to
  sleep is woken before the next command (unit tests against the simulator).
- Settings → Developer & simulator → **Wi-Fi adapter** → Connect with no adapter reachable fails
  within 5 s and the diagnostics panel shows the join-the-network suggestion (unit + component
  tests). Switching between Simulator / Bluetooth / Wi-Fi never constructs a `BleManager` unless
  Bluetooth is selected, not even when the Connect screen unmounts (`useScan`'s `stop()` touches
  the BLE stack only after a scan was started). A real Wi-Fi ELM327 on Android and iOS: on-car pending.
- On Android, Settings → Developer & simulator → **Classic Bluetooth** with nothing paired shows the
  pairing guidance and **Open Bluetooth settings** opens the system Bluetooth screen; a paired
  adapter connects from the list, and identify + DTC read work through the delimiter-chunked
  simulator (integration test). On iOS the segment and the Connect-screen link are absent and a
  stored `'spp'` source falls back to Bluetooth LE with a one-time notice. The Bus sniffer explains
  that monitoring is unavailable over SPP instead of failing. A real SPP adapter: on-car pending.
- In the browser (plan 28), the Bluetooth source shows **Choose adapter & connect** and no scan /
  address entry; cancelling the chooser shows "No adapter was chosen…" with the app still
  disconnected; Safari / Firefox show the not-supported panel and keep the simulator (component +
  service tests over a fake Web Bluetooth). Identify + DTC read work through the 20-byte-notifying
  simulator (integration test). A real adapter from Chrome: on-car pending.
- On-car pending (plan 12, deferred): the Vgate's real sleep delay and whether a bare `\r` wakes it,
  the negotiated MTU on the owner's phones, and one walk-out-of-range reconnect + flap-guard check.
