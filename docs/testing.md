# Testing

Three layers: **automated unit + component tests** (no hardware, every push), an **end-to-end smoke
flow** on an Android emulator (nightly / on demand), and **on-car manual** checks (the user, with the
real Vgate adapter).

| Command                            | Runs                                                                                           |
| ---------------------------------- | ---------------------------------------------------------------------------------------------- |
| `npm test`                         | both Jest projects (`core` + `ui`)                                                             |
| `npm run test:core`                | `*.test.ts`: engine, simulator, stores, services (ts-jest, Node)                               |
| `npm run test:ui`                  | `*.test.tsx`: component tests (jest-expo + React Native Testing Library)                       |
| `npm run check:release`            | release config: signing plugin vs. a generated-gradle fixture, version sync                    |
| `npm run fixtures:sim`             | re-record the committed simulator replay fixtures (`sim-*.json`)                               |
| `npm run check:capture`            | capture analyzer CLI smoke on `docs/captures/synthetic-golf.csv` (plan 25)                     |
| `npm run analyze:capture -- <csv>` | analyze a sniffer capture ([captures](./captures/README.md))                                   |
| `npm run ci`                       | core typecheck + app typecheck + lint + `check:release` + `check:capture` + both Jest projects |

## Automated (no hardware)

The `core` Jest project (`npm run test:core`; ts-jest over the pure-TS core in Node). Coverage:

- **PID decoders** — each Mode 01 decoder against known byte fixtures (RPM, coolant, speed, MAP, MAF,
  voltage, temps, %).
- **DTC parsing** — `01 33 → P0133`, `02 99 → P0299`, `41 01 → C0101`, `C3 00 → U0300`, padding
  `00 00 → none`; Mode 03/07/0A framing.
- **VIN assembly** — multi-frame `0902` → 17-char ASCII.
- **Readiness monitors** — `0101` → MIL, DTC count, ignition type, per-monitor supported/complete.
- **Freeze frame** — Mode 02 trigger DTC + captured PIDs (via the session integration).
- **ELM327 client** — command queueing (half-duplex), echo/whitespace/prompt stripping,
  `NO DATA`/`?`/`SEARCHING...` handling, timeouts.
- **Simulator** — supported-PID bitmaps match the scenario; live values in range; DTC inject/clear;
  VIN present/absent per scenario.
- **DiagnosticSession integration** — for the **generic** profile and **each example car**, run
  `connect → init → identify → poll → readDtcs → clearDtcs` against `MockTransport` and assert:
  - negotiated protocol matches the scenario,
  - the effective PID set equals the expected supported set,
  - injected DTCs read then clear,
  - VIN decodes (or is correctly reported absent).
- **vehicle-docs-sync** — every TS profile has a `docs/vehicles/<id>.md`; the doc front-matter
  `expectedProtocol` and `supportedPidCount` match the TS profile; a recorded `observedProtocol`
  equals `expectedProtocol`; the "Validated on the car" table lists exactly the committed car
  fixtures.
- **Replay fixtures** — `fixtures.replay.test.ts` replays every committed fixture under
  `transport/fixtures/` through `DiagnosticSession` and asserts its `expect` block;
  `sim-fixtures.freshness.test.ts` fails when the committed simulator fixtures differ from a fresh
  recording (regenerate with `npm run fixtures:sim`). See
  [simulator.md → Replay fixtures](./simulator.md#replay-fixtures).

Also: `npm run typecheck` (core, `tsc --noEmit`), `npm run lint` (eslint over `src/`, `test/` and
`jest.setup.ui.ts`), and `npm run typecheck:app` (full RN app, including the `*.test.tsx` component
tests and the `test/` helpers). All of these run in CI (`.github/workflows/ci.yml`) on every push, plus `npm run check:release`
(`scripts/check-signing-plugin.mjs`, `scripts/check-version-sync.mjs`; see [release.md](./release.md))
and `npm run check:capture` (the capture analyzer CLI through Node's type stripping, plan 25).

## Component tests

The `ui` Jest project (`npm run test:ui`, config in `jest.config.js`) renders real screens with
**React Native Testing Library** under the **`jest-expo`** preset, against the **real zustand
stores** and, where a test connects, the **real `connectionService` driving `MockTransport`**: the
same simulator path as the Connect tab's **Connect to simulator** button. Files are `*.test.tsx`
next to the screen (`src/features/<slug>/ui/<Screen>.test.tsx`). Tests that cannot live in
`src/app` (expo-router would treat a `*.test.tsx` there as a route) go under `test/`, e.g.
`test/app/RootLayout.test.tsx`.

| Suite                          | Covers                                                                                                                                                                                                                                                                 |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ConnectionScreen.test.tsx`    | simulator mode: **Connect to simulator** + first-run card; BLE: **Scan for adapters**; error panel; a real simulator connect reaches `connected` and moves on to `/vehicle`                                                                                            |
| `VehicleSelectScreen.test.tsx` | the four built-in profiles; tapping the Golf selects it and opens `/dashboard`; the VIN suggestion card from the simulated Golf's VIN                                                                                                                                  |
| `DashboardScreen.test.tsx`     | not connected: prompt; seeded `liveDataStore` values on the RPM / Speed / Coolant gauges (km/h, °C); **All sensors** segment; petrol preset on a new garage car                                                                                                        |
| `FaultCodesScreen.test.tsx`    | two simulator-injected codes with descriptions, readiness / MIL; inline Guide toggle; **Clear codes**, confirm, empty re-read                                                                                                                                          |
| `VehicleInfoScreen.test.tsx`   | VIN, protocol label, supported-PID count and adapter name from the simulator session                                                                                                                                                                                   |
| `SensorGroups.test.tsx`        | Live → All sensors, simulated Golf: the five injection DIDs are read once on mount; later live-data updates send no further Mode 22 reads; a superseded read stops                                                                                                     |
| `SettingsScreen.test.tsx`      | section order; **Developer & simulator** collapsed on open; adapter-source segment (and its simulator sections); switching back drops a live session; theme; fault preset; Show hints again; Reset all app data (two confirmations; hidden without the route's action) |
| `MoreScreen.test.tsx`          | five sections, every entry a labelled button; only Workshop rows experimental; search `cod` leaves Coding; Error log opens `/error-log`; **Check for updates** without OTA                                                                                             |
| `RootLayout.test.tsx`          | the seven tab titles in order; every `src/app` route file is registered (hidden ones with `href: null`)                                                                                                                                                                |
| `SettingsRoute.test.tsx`       | the Settings route hands the backup slice's **Reset all app data** to the screen                                                                                                                                                                                       |

**Helpers** (`test/`, imported as `@test/…`):

- `renderWithProviders(ui)`: the app's `TamaguiProvider` + dark `Theme`, as in `_layout.tsx`.
- `connectSimulator({ vehicleId?, injectedDtcs? })`: sets the simulator settings and runs the real
  `connect()`; the session is closed again after each test (the global `afterEach` unmounts the
  tree, then disconnects). Closing the session closes its ELM327 client (`Elm327Client.close()`,
  plan W2): a read a screen started on mount and that is still queued (the DPF screen's Mode 22
  refresh, a backup panel's re-compare) rejects at once with `Elm327ClosedError` instead of writing
  to the dead link and timing out seconds later, after the test — no timer outlives the test and
  nothing logs after it. A test that expects its own work to finish still awaits it (the DPF tests
  wait for the refresh, the coding-backup tests wait for the shared work gate to be released, in
  the test and in an `afterEach`), so a teardown never cuts work short by accident.
- `mocks/router.ts`: the expo-router double. Assert navigation on `mockPush`; `setMockSearchParams`
  feeds `useLocalSearchParams`; a stand-in `Tabs` lists the visible tabs (`tab-<route>`) and the
  hidden routes (`hidden-<route>`).
- `mocks/window.ts`: the window size behind `useWindowDimensions` (plan 21). React Native's own
  jest mock reports 750 × 1334 — a "medium" layout class — so the double defaults to a portrait
  phone (390 × 844 dp) and every screen test renders the phone layout. Call
  `setMockWindow(TABLET_WINDOW)` (1280 × 800, a Pixel Tablet in landscape) or
  `setMockWindow({ width, height })` before rendering to test the tablet / landscape layouts;
  `resetStores()` puts the phone back. The stand-in `Tabs` also records its `screenOptions`
  (`lastTabsScreenOptions`) so the layout test can assert the side rail.
- `resetStores()`: runs before every test. Each store a tab screen reads goes back to its initial
  state, every persisted store's pending debounced write is cancelled (`persist.clearStorage()`
  goes through `debouncedStorage.removeItem`), and the in-memory filesystem is emptied. The same
  cancel (`cancelPendingWrites()`) runs in `afterAll`, so no persist timer outlives a test file.
  **Add a store there when a new screen test reads it.**

**Native modules** are replaced in `jest.setup.ui.ts`: `react-native-ble-plx` (a `BleManager` whose
radio reports `PoweredOn`; BLE permissions granted), `expo-file-system` and
`expo-file-system/legacy` (an in-memory `Map` in `test/mocks/fileSystem.ts`; every `zustand/persist`
store writes there), `expo-sharing` (unavailable), `expo-notifications`, `expo-haptics`,
`expo-location`, `expo-secure-store` (in-memory), `expo-updates` (`isEnabled: false`), `expo-router`
and `react-native-safe-area-context` (its bundled jest mock). To mock another native module, add a
`jest.mock('<package>', () => ({ … }))` there. All of the above are installed, so none needs
`{ virtual: true }`; use it only for a package that is not installed. When only one test needs a
double, `jest.mock` it at the top of that file instead: the layout test replaces the headless
`EngineHost` and the animated `AppSplash` that way.

Conventions: find controls by their visible text (`getByText`) or, where the control carries an
accessible role and label, by `getByRole('button', { name })`; await async reads with `findBy…` /
`waitFor`; stub `Alert.alert` with `jest.spyOn` and call the confirm button's `onPress`. Keep each
suite under ~150 lines.

**Tamagui decision:** Tamagui renders **as is** under `jest-expo`, no shim. The only adjustment is in
`babel.config.js`: the `@tamagui/babel-plugin` optimizing compiler is skipped when
`NODE_ENV === 'test'` (it would only add a static-extraction pass per file). If a later Tamagui
upgrade stops rendering under Jest, the fallback from plan 10 is a `moduleNameMapper` entry mapping
`^tamagui$` / `^@tamagui/(.*)$` to a thin shim of RN `View` / `Text` / `Pressable` wrappers.

Notes:

- Tamagui `Button`s render a `role="button"` view without `accessible`, so Testing Library's
  `getByRole` does not find them; tests press them by their text. Making every control a proper
  accessibility element is plan 20.
- `expo-modules-core` is nested under `node_modules/expo/` (not hoisted); the `ui` project adds that
  folder to `modulePaths` because jest-expo's setup requires the package by name.

## End-to-end

A [Maestro](https://maestro.mobile.dev) smoke flow, `.maestro/simulator-smoke.yaml`, drives the app
on an Android emulator from a fresh install: **Settings → Developer & simulator (expand) → Simulator (no car) → P0299 → Connect →
Connect to simulator → Connected → Faults → P0299 → Clear codes → confirm → Stored (0)**. It uses the
app's real labels; when a screen's copy changes, update the flow in the same change.

- **Locally:** start an emulator and install a build. `npm run android` installs a dev-client build
  that loads JS from Metro, so keep `npm start` running (or install a release APK, which embeds the
  bundle). Then run `maestro test .maestro/simulator-smoke.yaml`.
- **CI:** `.github/workflows/e2e.yml` runs on **manual dispatch** and **nightly** (02:30 UTC), never
  on push, and is not a required check. It prebuilds, builds a release-variant APK (embedded bundle,
  prebuild's debug signing, x86_64 only), boots an API 34 x86_64 emulator with
  `reactivecircus/android-emulator-runner@v2`, installs the APK and runs the flow; the JUnit report
  is uploaded as an artifact.
- **Status:** the flow and the workflow are written and YAML-valid, and every label in the flow is
  checked against the source; neither has run yet. The dev workstation has the Android SDK
  emulator, an AVD (`Sere_API36`), `adb` and JDK 17. What is missing to finish the acceptance item:
  (1) the Maestro CLI is not installed (`maestro` is not on `PATH`; see
  [Maestro's install guide](https://docs.maestro.dev/getting-started/installing-maestro)); (2) no
  APK has been built for the emulator (`npm run prebuild:android`, then `npm run android` with
  `npm start`, or a release APK); (3) `e2e.yml` has not been dispatched, which needs the branch on
  GitHub. Things to watch on the first run: the bare `Connect` taps must hit the tab (the Connect
  screen's own title is also "Connect", but the flow only taps it from Settings and Vehicle), and
  the `(?i)clear` alert confirm must match the dialog button, not the **Clear codes** button behind
  it. The first run is an owner action with a step-by-step procedure in
  [plan 10 → Owner actions](./plans/10-component-e2e-tests.md#owner-actions).

## On-car manual checklists

Perform with the real adapter; each car's steps live in its profile doc and are mirrored into the
profile's `testChecklist`:

- **Golf Plus 2009 2.0 TDI** → [`vehicles/golf-plus-2009-20tdi.md`](./vehicles/golf-plus-2009-20tdi.md)
  (expect CAN, full data, VIN, DTC read/clear, try experimental Mode 22).
- **Fiat Grande Punto 1.2 2008** → [`vehicles/fiat-punto-2008-12.md`](./vehicles/fiat-punto-2008-12.md)
  (expect CAN; trims/timing; VIN available).
- **Passat B5.5 1.9 TDI** → [`vehicles/passat-b55-19tdi.md`](./vehicles/passat-b55-19tdi.md)
  (expect slow K-line, fewer PIDs; RPM/coolant/DTC read+clear is success).

### Recording results

Every on-car flow is captured as a **replay fixture** and committed, so what the car answered
becomes a CI test ([simulator.md → Replay fixtures](./simulator.md#replay-fixtures)). The doc is
corrected first, then the TS profile, then `npm test`.

**Session script** (Golf first, then Punto, then Passat). Prepare: phone charged, a build from
`main`, Settings → **Real adapter (Bluetooth)**, adapter plugged in. Before each flow: Settings →
Adapter log → **Clear**. After each flow: type the flow name in **Flow name**, then **Export as
replay fixture**; send the files to the repo (any channel). Flows 2–9 run on the session that
flow 1 connected, so their files hold no connect traffic; that is expected (see step 1 below). The
log keeps the last 300 lines: if Settings says **the log is full** before you export, clear it and
run the flow again, shorter.

| #   | Flow name                                        | Steps on the car                                                                              | Record                                                                                               |
| --- | ------------------------------------------------ | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 1   | `connect`                                        | Ignition ON, engine OFF. Connect → Scan → pick the Vgate → wait for Connected. Open **Info**. | Protocol, VIN, adapter version, supported-PID count, voltage; seconds from tap to Connected.         |
| 2   | `live`                                           | Start engine. **Live** about 30 s at idle, a few throttle blips.                              | Which gauges/cards show values; update feel; any `—`.                                                |
| 3   | `faults`                                         | **Faults** → pull to refresh. Open each code's Guide.                                         | Codes vs the known list (`P2183`, `P2015`, `P0121` on the Golf), readiness, MIL, freeze-frame count. |
| 4   | `inspection`                                     | More → **Used-car inspection** → run.                                                         | Verdict; IUPR present or not.                                                                        |
| 5   | `battery`                                        | Engine OFF: More → **Battery & charging** → capture 20 s; second capture while starting.      | Resting V, cranking dip, charging V, verdict.                                                        |
| 6   | `extended`                                       | Info → **Extended PIDs** → read every DID once.                                               | Per DID: value / `NO DATA` / negative response. Decides which illustrative DIDs survive.             |
| 7   | `module-scan`                                    | More → **Module scan** (engine ON, parked).                                                   | Which modules answer; on the Golf only the engine pair is expected.                                  |
| 8   | `sniffer`                                        | More → **Bus sniffer** → 10 s at idle → Stop → Share CSV.                                     | Frame count, dominant IDs.                                                                           |
| 9   | `clear` (only if a harmless pending code exists) | Faults → Clear → re-read.                                                                     | Before/after sets.                                                                                   |

Passat: expect `BUS INIT` / `SEARCHING…`; flows 6–8 do not apply; note the time to connect. Punto:
two ECUs answer `0100`; confirm there are no phantom DTCs.

**After the session** (whoever commits the files):

1. Copy each exported JSON to `src/shared/obd-core/transport/fixtures/<vehicleId>/<flow>.json`
   (never `sim-*`); keep `meta.source: 'car'`; write `expect` from what the car actually answered
   (read the `pairs`). Only `connect.json` holds the connect handshake (`0100`), so only it carries
   `protocol`, `vin` and `supportedPidCount`; the checker reports those fields on a file without
   connect traffic. In `clear.json`, `storedDtcsAfterClear` is the last `03` reply in the file. A
   file with `meta.droppedEntries` lost its oldest lines: re-record it if the flow's start is
   missing.
2. Run `npm test -- fixtures.replay`. Each failure is either a wrong expectation (fix the fixture) or
   an app bug (fix the code and add a regression test that uses the fixture).
3. Fill the vehicle doc's **Validated on the car** row per flow (the last column names the fixture
   file; `vehicle-docs-sync` fails until every car fixture is listed and every listed file exists).
   Set `validatedOn` and `observedProtocol` in the front-matter; `observedProtocol` must equal the
   profile's `expectedProtocol`, so correct the doc and the profile if the car disagrees. If the
   observed PID bitmap differs from `supportedPids`, change `supportedPidCount` in the doc first,
   then the profile.
4. Flow 6 decides each extended DID: confirmed → keep and mark it; `NO DATA` / negative → remove it
   from the profile and note it in the doc.
5. Write an `implementation-log.md` entry; flip "On-car validation log" in the roadmap per car.
