# Architecture

## Overview

A pure-TypeScript **OBD2 core** (no platform APIs) sits behind a swappable **Transport** interface.
A thin React Native (Expo) UI, organized as **feature slices**, sits on top. This keeps the
diagnostic engine unit-testable with **no hardware** and reusable across the BLE transport, the
Wi-Fi TCP transport, the Classic Bluetooth (SPP) transport, the Web Bluetooth transport of the
browser build ([web](./web.md), plan 28), and the in-memory simulator.

```
UI — feature slices (Tamagui)  ──►  state stores (Zustand)  ──►  DiagnosticSession
                                                              │
                                                       OBD2 layer (PIDs, DTC, VIN)
                                                              │
                                                       ELM327 client (AT cmds, queue, parsing)
                                                              │
                                                   Transport interface
         ┌──────────────────┬──────────────────┬─────────┴────────┬──────────────────┬──────────────┐
    BleTransport         TcpTransport         SppTransport     WebBluetoothTransport  MockTransport
(react-native-ble-plx) (react-native-tcp-   (react-native-     (browser Web Bluetooth,  (simulator)
                        socket, Wi-Fi        bluetooth-classic, Chrome / Edge, plan 28)
                        ELM327, plan 26)     Android SPP,
                                             plan 27)
```

## Layers (bottom-up)

### 1. Transport (`src/shared/obd-core/transport`)

A minimal byte pipe. The rest of the stack does not care whether bytes go over BLE, a TCP socket,
a classic Bluetooth serial port, Web Bluetooth in the browser, or a mock.

```ts
interface Transport {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  write(bytes: Uint8Array): Promise<void>;
  onData(listener: (bytes: Uint8Array) => void): () => void; // returns unsubscribe
  readonly status: TransportStatus; // 'disconnected' | 'connecting' | 'connected' | 'error'
  readonly capabilities?: TransportCapabilities; // { monitor: boolean }; absent = can stream ATMA
}
```

`capabilities` (plan 27) is optional and backwards-compatible: absent means `{ monitor: true }`. A
link that only delivers prompt-terminated messages declares `{ monitor: false }`;
`DiagnosticSession.canMonitor` reads it and `startSniffer()` / `Elm327Client.startMonitor()` refuse
with `MONITOR_UNAVAILABLE_MESSAGE` instead of holding the queue forever.

- **`MockTransport`** — the simulator (see [`simulator.md`](./simulator.md)). Pure, deterministic.
- **`BleTransport`** — wraps `react-native-ble-plx`. **Discovers** the notify + write characteristics
  at runtime instead of hard-coding UUIDs, so it is robust across ELM327 BLE clones.
- **`TcpTransport`** (`src/shared/transports/tcp/`, plan 26) — a TCP socket to a Wi-Fi ELM327
  (default `192.168.0.10:35000`). Written against an injected `TcpSocketFactory`; the app's default
  loads `react-native-tcp-socket` through a variable specifier, the tests use a fake socket driven
  by the simulator (`obd-core/transport/testing/bridge.ts`). Same status events as BLE, so link
  loss and auto-reconnect work unchanged (see [connection](./features/connection.md#wi-fi-adapters-tcp-plan-26)).
- **`SppTransport`** (`src/shared/transports/spp/`, plan 27, Android only) — an RFCOMM socket to a
  paired classic Bluetooth ("3.0") ELM327 through `react-native-bluetooth-classic`, injected as an
  `SppModuleLike` loader (the tests use a fake whose device re-chunks the simulator's output by `>`
  through the same bridge). The library hands over one message per `>` with the `>` stripped, so
  the transport re-appends the prompt; for the same reason it declares `capabilities = { monitor:
false }` (no `ATMA` sniffer). `listBondedAdapters()` lists paired devices — there is no scanning.
  iOS cannot open non-MFi classic accessories, so the source is hidden there (see
  [connection](./features/connection.md#classic-bluetooth-spp-android--plan-27)).

### 2. ELM327 client (`src/shared/obd-core/elm327`)

Turns the byte pipe into a request/response command channel.

- **Half-duplex command queue.** The ELM327 handles **one** command at a time. The client serializes
  commands, appends `\r`, and resolves when the terminating `>` prompt is seen.
- **Response cleanup.** Strips command echo (we also send `ATE0`), `\r`/`\n`, spaces (`ATS0`), and the
  `>` prompt; detects `NO DATA`, `?`, `SEARCHING...`, `UNABLE TO CONNECT`, `STOPPED`, `BUFFER FULL`.
- **Init sequence.** `ATZ → ATE0 → ATL0 → ATS0 → ATH0 → ATSP0` then probe `0100`. Adaptive timing
  (`ATAT1`). See [`obd2-reference.md`](./obd2-reference.md).
- **Timeouts & retries** per command, with a longer timeout while the adapter is `SEARCHING...`.
- **Close on disconnect.** `DiagnosticSession.disconnect()` calls `Elm327Client.close()`: the
  command in flight and every queued one reject at once with `Elm327ClosedError`, so no read
  outlives its session (see [connection](./features/connection.md)).

### 3. OBD2 layer (`src/shared/obd-core/obd`)

Protocol-agnostic OBD2 semantics on top of the ELM327 client.

- **PID registry** — declarative table of Mode 01 PIDs with `{ pid, name, unit, bytes, decode() }`.
- **Decoders** — pure functions from response bytes to typed values (RPM, °C, km/h, %, V, …).
- **DTC parsing** — 2-byte → `P/C/B/U` codes for Modes 03 (stored), 07 (pending), 0A (permanent).
- **VIN** — Mode 09 PID 02 (multi-frame assembly).
- **Supported-PID discovery** — bitmaps `0100/0120/0140/0160`.

### 4. DiagnosticSession (`src/shared/obd-core/session`)

High-level orchestration used by the UI:
`connect → init → identify (protocol + supported PIDs + VIN) → poll live PIDs → read/clear DTCs`.
Exposes reactive streams/snapshots the UI subscribes to.

### 5. Vehicle registry (`src/shared/vehicles`)

Typed profiles (an **extensible registry**). A built-in `generic` auto-detect profile works for any
car. Profiles drive protocol pre-selection, dashboard filtering, the simulator, and extended-PID
gating. See [`vehicles/README.md`](./vehicles/README.md).

## UI: feature-sliced

Each feature in `src/features/<name>` is **self-contained** and depends only on `src/shared/*`,
never on another feature:

```
features/<name>/
├── ui/        # screens + components (Tamagui)
├── styles/    # styling for this feature
├── hooks/     # React hooks (consume api + stores)
├── api/       # the feature's service layer → talks to the OBD2 core/device (NOT a network API)
├── model/     # types + Zustand store slice
└── index.ts   # the feature's public surface
```

Shared, cross-cutting code (the OBD2 core, vehicle registry, BLE, TCP and SPP transports, design-system wrappers,
theme, generic hooks, utils) lives under `src/shared/*`. Anything reused by two features is promoted
to `shared`.

**Engine host.** The one sanctioned cross-feature composition point is the headless
`features/engine-host` ([spec](./features/engine-host.md)), mounted once in `src/app/_layout.tsx`.
It owns the engines that must run whatever screen is on top: the single demand-driven poll loop,
alert evaluation, diagnostic / connection notifications, trip sampling and the readiness coach. It
is the only slice the rule allows to read several features' stores; everything else that two
features need belongs in `src/shared/*`. The code does not match that yet: 19 slices import another
feature, 16 of them only `vehicle-select` (its `vehicleStore` or the active-profile helpers, both
now re-exports of `src/shared/state/`). The
[engine-host spec](./features/engine-host.md#the-composition-rule) lists them. New code should
not add to the list.

**Report.** The second sanctioned composition point is `features/report`
([spec](./features/report.md), plan 15): the unified vehicle report reads the fault-code, module-scan,
inspection, battery, AI and maintenance stores to build one shareable document. Its pure model and
renderers live in `src/shared/lib/vehicleReport.ts` and take the report's own narrowed types, never
feature types; the slice's `api/sections.ts` maps each store shape into them. No feature imports the
report slice (the Faults screen's report snapshot, `dtcCheckFromRead`, is in `src/shared/lib`).

**Backup.** The third sanctioned composition point is `features/backup`
([spec](./features/backup.md), plan 18): backup, restore and per-store export need every persisted
store, so `api/registry.ts` imports them all. That registry (`PERSISTED_STORES`) is **the one list
to update when a store gains `persist`** — `storeVersions.test.ts` fails when a `bolid.*` store is
missing from it. The bundle format, validation, redaction and restore plan are pure, in
`src/shared/lib/backup.ts`. No feature imports the backup slice: Settings' **Reset all app data**
(plan 07, `resetAllAppData`) is handed in by the route `src/app/settings.tsx` as a prop.

**History.** The fourth sanctioned composition point is `features/history`
([spec](./features/history.md), plan 16): the per-car timeline merges AI runs, fault-code checks
and reports (`historyStore`) with the module-scan, trip, maintenance and coding-backup stores, and
re-opens a saved AI report through the ai-diagnose slice's `AiReportView`. The merge, filters and
day grouping are pure, in `src/shared/lib/timeline.ts` (no state or feature imports); the slice's
`api/timelineSources.ts` maps each store's records into `TimelineItem`s. No feature imports the
history slice; it reaches the other screens only through routes (`/module-scan?after=&before=`,
`/trip-detail?id=`, `/maintenance`, `/coding`).

**Layout classes (plan 21).** Screens adapt to the window with `useLayoutClass()`
(`src/shared/ui/useLayoutClass.ts`: `useWindowDimensions()` → `{ cls, width, height, landscape,
fontScale }`). The class comes from the pure `classify(width)` in `src/shared/ui/layoutClass.ts`
(unit-tested): **compact** < 600 dp, **medium** 600–839, **expanded** ≥ 840 — Material 3's
window-size classes, chosen over Tamagui's v3 media queries (`sm` ≤ 800, `gtSm` ≥ 801, `gtMd` ≥
1021, no 768 edge) because the 600 dp edge gives a 7-inch tablet in portrait and a small phone in
landscape the two-pane layouts. Two rules build on it: `isTwoPane` (anything but compact) switches
Live to gauges | values, Charts to two panels per row and More / Vehicle to two-column card grids
(`CardGrid`, `src/shared/ui/CardGrid.tsx`); `usesSideRail` (expanded, or medium in landscape — and only when
the window is at least `railMinHeight(fontScale)` tall, ~555 dp at font scale 1, because the
navigator's rail is a non-scrolling column that must fit all seven tabs; a phone on its side keeps
the bottom bar) moves the tab bar to a left rail (`tabBarPosition: 'left'`, `tabBarVariant: 'material'`, labels
below the icons) in `src/app/_layout.tsx`; the header stays on top. **Screen width cap:** `Screen`
(`src/shared/ui/Screen.tsx`) pads 16 dp on compact and 24 dp otherwise, and wraps its content in a
centred column capped at `CONTENT_MAX_WIDTH` (1100 dp) on medium / expanded — unless the screen
passes `wide` (Live, Charts and the bus sniffer lay out their own columns). Its `ScrollView` sets
`automaticallyAdjustKeyboardInsets` so a focused input (Settings → Server URL on a phone in
landscape) scrolls above the keyboard on iOS. That prop is iOS-only; on Android the app runs
edge-to-edge (Expo 57 / RN 0.86, no `android.softwareKeyboardLayoutMode` in `app.json`) and whether
the default `adjustResize` still shrinks the window there is **unverified** — a device check (see
the plan 21 entry in the implementation log). Foldables, multi-window
and a web target are out of scope.

**Colour and accessibility (plan 20).** `src/shared/ui/palette.json` is the **only colour
source** for on-screen UI: `tamagui.config.ts` merges its semantic tokens (`$accent`, `$muted`,
`$statusOk|Warn|Error|Info|Fatal`, `$placeholderColor`, `$gaugeTrack`, `$onFill`) into every light
and dark theme, components use the tokens (or `usePalette()` for raw strings: icons, SVG, chart
series), and `npm run check:contrast` holds every pair to WCAG AA in both themes. No component
hard-codes a hex colour (the HTML / PDF exports' inline CSS excepted). Controls follow
[accessibility.md](./accessibility.md): every `Button` is one accessibility element (config
`defaultProps`), single choices are `SegmentedControl` radios, on / off settings are
`LabeledSwitch` / `AccessibleSwitch`, targets are ≥ 44 pt, display numbers cap font scaling at
1.3×, and decorative motion follows `useReducedMotion()`. `test/a11y/screens.a11y.test.tsx` sweeps
every route for unnamed controls.

**Specs.** Every slice has a spec in `docs/features/<slug>.md` (see [docs/README](./README.md));
`src/shared/lib/featureDocsSync.test.ts` enforces it.

**Routing.** `src/app/*` (expo-router) files are thin and just render a feature screen.

## State management

[Zustand](https://github.com/pmndrs/zustand) stores hold connection state, the live-data snapshot,
and the DTC list. The `DiagnosticSession` pushes updates into these stores; hooks read from them.
Keeping stores thin and the logic in the core means the logic is testable without React.

Shared stores (`src/shared/state/`), used by several features:

- `sessionStore` — connection status and the live `DiagnosticSession` + `SessionInfo` (in memory);
- `settingsStore` — adapter source, simulator, polling, auto-reconnect, VIN auto-select, theme, AI,
  opt-in crash reports (`bolid.settings`);
- `garageStore` — the user's garage cars (`UserVehicle[]`, `bolid.garage`);
- `vehicleStore` — the selected vehicle id (`bolid.vehicle`); `activeProfile.ts` resolves it over the
  registry and the garage by `resolveProfile` (`getActiveProfile` / `useActiveProfile`, see
  [vehicle-select](./features/vehicle-select.md));
- `dtcStore`, `historyStore` (`bolid.history`), `errorLogStore` (`bolid.errors`) and the
  `adapterLog` ring buffer;
- `seedKeyStore` — the index of the owner's security-access plugins (`bolid.seedKeys`, plan 23;
  the programs stay in their own files and are resolved by `src/shared/security/`, see
  [coding → Security-access plugins](./features/coding.md#security-access-plugins-plan-23)).

Per-feature stores live in their slice's `model/`. Persisted stores use `fileStateStorage`, a
`bolid.<area>` name, an explicit version and a `migrate` when the shape changes, and are listed in
the backup registry (`src/features/backup/api/registry.ts`, see **Backup** above) so a backup
holds them — except the ones it names in `NOT_BACKED_UP` (`bolid.backups`, `bolid.seedKeys`). Stores on `debouncedStorage` can be flushed at once with `flushPendingWrites()` (the
backup reads complete files).

## Error handling & resilience

- Every command can fail (`NO DATA`, timeout, `UNABLE TO CONNECT`); the session degrades gracefully
  (e.g. skip an unsupported PID rather than abort the whole poll).
- BLE disconnects surface as a `status` change; the UI offers reconnect.
- All adapter I/O can be mirrored to an in-app **log** (Settings) for debugging real cars.

## Telemetry: opt-in crash reports (plan 31)

`src/shared/telemetry/` holds the only code that can send diagnostics off the phone on its own, and
it is **opt-in**: off by default, switched on only by the user in Settings → Privacy (after a
confirmation), and a **no-op** when the build has no `EXPO_PUBLIC_SENTRY_DSN` (dev builds, forks —
the DSN comes from a CI / EAS secret, never from the repository) or `@sentry/react-native` cannot be
loaded.

- `crashReporting.ts` — no React Native or store imports (so `errorLogStore` can call it without an
  import cycle, and it runs in the Node test project). Loads the SDK lazily through a variable
  import specifier, initialises it only when switched on, closes it when switched off, and gates
  `beforeSend` on the switch. `captureError(input)` is called by `logError` for `error` / `fatal`
  entries; `addCrashBreadcrumb('nav' | 'connection', …)`; `sendTestCrashReport()`.
- `useCrashReporting.ts` — mounted once by `src/app/_layout.tsx` as the headless
  `<CrashReportingHost />` (so its per-navigation `usePathname` re-render stays out of the root
  layout): starts the reporter with the
  stored choice, follows the switch, adds the screen-path and connection-status breadcrumbs, keeps
  the known VINs (connected car, garage) in the scrubber's list.
- `src/shared/lib/scrub.ts` — `scrubEvent` / `scrubBreadcrumb` / `scrubCrashText`, pure and in the
  core typecheck scope: VIN, device ids, URLs, tokens, coordinates and e-mail addresses removed;
  `user` / `request` / `server_name` dropped; contexts reduced to device model, OS and app version;
  tags whitelisted; only `nav` / `connection` breadcrumbs kept. Native crashes (Java / Objective-C /
  NDK / ANR) are sent by the native SDK without this scrubber; the privacy policy says so. No
  tracing: `tracesSampleRate` is unset, so no `sentry-trace` / `baggage` headers go on any request.

Rule: anything new that would send data off the phone without the user choosing a destination
goes through this module's opt-in gate and the privacy policy first.

## Why this shape

- **Testable without a car** — the core + simulator run in plain Node/Jest in CI and in this
  container.
- **Portable** — the browser build swaps `BleTransport` for `WebBluetoothTransport` (plan 28); the
  stack above the transport is unchanged.
- **Generic-first** — no car model is hard-coded in the engine; cars are data (profiles).
