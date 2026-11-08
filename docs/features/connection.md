# Feature: connection

Scan for, connect to, and initialize the ELM327 BLE adapter.

## UI

- **ScanScreen** — list of nearby BLE devices (name + RSSI), with name hints highlighted
  (`Vlink`, `IOS-Vlink`, `VEEPEAK`, `OBDII`). "Connect" per row. A connect/init progress state.
- **StatusBadge** — shared component showing `disconnected / connecting / initializing / connected /
error` and the negotiated protocol once known.

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

- `useScan()` — start/stop scanning, returns discovered devices. Guards on the radio being
  `PoweredOn` before scanning, so a powered-off adapter fails with clear guidance, not a raw error.
- `useConnect()` — connect to a chosen device, run the ELM327 init, expose progress/errors.
- `useAdapterStatus()` — read connection status + protocol from the store.
- `useBluetoothState(enabled?)` — subscribe to the phone's live Bluetooth radio state
  (`onStateChange`): `ready / poweredOff / unauthorized / unsupported / checking`. Pass `false` in
  simulator mode so the `BleManager` is never constructed. Drives `BluetoothPrompt`.

## api (service layer)

- `connectionService` — builds the `Transport` (BLE or Mock per Settings), constructs the
  `Elm327Client`, runs the init sequence, then hands a ready `DiagnosticSession` to the app.

## model

- `connectionStore` (Zustand): `status`, `deviceId`, `deviceName`, `protocol`, `adapterVersion`,
  `voltage`, `error`.

## Behavior

0. Detect the Bluetooth **radio** state. When it isn't `PoweredOn`, the Connect screen shows a
   `BluetoothPrompt` banner and disables scanning: **off** → one-tap "Turn on Bluetooth" on Android
   (`BleManager.enable()`; iOS points to Control Center), **unauthorized** → "Open settings",
   **unsupported** → guidance to use the simulator. The banner clears itself the moment the radio
   comes on (state subscription).
1. Request BLE permissions (Android 12+ scan/connect; iOS usage description).
2. Scan; user picks a device (or auto-connect to the last used).
3. `BleTransport` connects, **discovers** services/characteristics, selects the notify + write pair.
4. Run init: `ATZ → ATE0 → ATL0 → ATS0 → ATH0 → ATAT1 → ATSP0`, probe `0100`, read `ATDPN`/`ATRV`.
5. On success → `connected`, store protocol + voltage; navigate onward.

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

## Auto-reconnect (optional, default off)

- Behind the persisted `settingsStore.autoReconnect` toggle (Settings → Auto-reconnect). On an
  unexpected link loss it retries the stored device with backoff (2 s / 5 s / 10 s, 3 attempts),
  surfacing progress via `sessionStore` status `connecting` + an "attempt _n_ of 3" message. It
  aborts immediately on a manual disconnect or a new manual connect. The backoff control flow is the
  pure `reconnect.ts` (`runReconnect`), unit-tested with injected timers.

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
