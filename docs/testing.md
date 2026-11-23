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
| `npm run eval:agent`               | the AI agent eval set against a configured model (skipped unless `BOLID_EVAL_URL` is set)      |
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

| Suite                              | Covers                                                                                                                                                                                                          |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ConnectionScreen.test.tsx`        | simulator mode: **Connect to simulator** + first-run card; BLE: **Scan for adapters**; error panel; a real simulator connect reaches `connected` and moves on to `/vehicle`                                     |
| `VehicleSelectScreen.test.tsx`     | the four built-in profiles; tapping the Golf selects it and opens `/dashboard`; the VIN suggestion card from the simulated Golf's VIN                                                                           |
| `DashboardScreen.test.tsx`         | not connected: prompt; seeded `liveDataStore` values on the RPM / Speed / Coolant gauges (km/h, °C); **All sensors** segment; petrol preset on a new garage car                                                 |
| `FaultCodesScreen.test.tsx`        | two simulator-injected codes with descriptions, readiness / MIL; inline Guide toggle; **Clear codes**, confirm, empty re-read                                                                                   |
| `VehicleInfoScreen.test.tsx`       | VIN, protocol label, supported-PID count and adapter name from the simulator session                                                                                                                            |
| `SensorGroups.test.tsx`            | Live → All sensors, simulated Golf: the five injection DIDs are read once on mount; later live-data updates send no further Mode 22 reads; a superseded read stops                                              |
| `SettingsScreen.test.tsx`          | the hub: General, Connection, then the page rows in order with their status; each row opens its page; theme; poll / switches; Disconnect; Romanian                                                              |
| `DeveloperSettingsScreen.test.tsx` | adapter-source segment (and its simulator sections); switching back drops a live session; fault preset; log export; Show hints again; Reset all app data (two confirmations; hidden without the route's action) |
| `AiSettingsScreen.test.tsx`        | configuration hidden while AI is off; provider presets; Test connection / Detect model                                                                                                                          |
| `MoreScreen.test.tsx`              | five sections, every entry a labelled button; only Workshop rows experimental; search `cod` leaves Coding; Error log opens `/error-log`; **Check for updates** without OTA                                      |
| `RootLayout.test.tsx`              | the seven tab titles in order; every `src/app` route file is registered (hidden ones with `href: null`)                                                                                                         |
| `SettingsDeveloperRoute.test.tsx`  | the Developer & simulator route hands the backup slice's **Reset all app data** to the page                                                                                                                     |

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

- Every Tamagui `Button` is an accessibility element (`accessible` from the config's
  `defaultProps`, plan 20), so `getByRole('button', { name })` finds it; segments are
  `getByRole('radio', { name })` with `toBeSelected()` / `toBeChecked()`, switches
  `getByRole('switch', { name })`. Pressing by visible text still works.
- **Accessibility sweep** (plan 20): `test/a11y/screens.a11y.test.tsx` renders every route in
  `src/app` (disconnected and on the simulator, plus tap-only states) and fails on a pressable with
  no name, role or `accessible`, an unlabelled input, or a switch / radio without a checked state —
  the walker is `test/a11y.ts` (`a11yProblems`). See [accessibility](./accessibility.md). It loads
  every route module once in a `beforeAll`, so the first case does not pay the ~9 s of module
  loading against its timeout. `src/shared/ui/touchTargets.test.ts` (core) scans the source for a
  Tamagui `Button` under 44 pt (`$1` / `$2`, or `$3` without `hitSlop`).
- **Per-test timeout:** `jest.setup.ui.ts` sets 20 s for the `ui` project (Jest's default is 5 s).
  The simulator walk-throughs run in real time and take a few seconds alone, more while `npm test`
  runs every suite in parallel.
- `screen.root` is the first host element: to run `a11yProblems` on a lone component, render it
  inside a `View`.
- `expo-modules-core` is nested under `node_modules/expo/` (not hoisted); the `ui` project adds that
  folder to `modulePaths` because jest-expo's setup requires the package by name.

## Agent eval set

`src/shared/ai/eval/agentEval.test.ts` (plan 34c) measures how well a real model drives the AI
diagnostic agent. It is **not in CI**: the suite is skipped unless `BOLID_EVAL_URL` is set, so
`npm test` and `npm run ci` report its four cases as skipped.

Each case in `src/shared/ai/eval/cases.json` names a simulator profile, an optional scripted fault
(`low_boost`, `lean_trims`, `weak_charging`, see
[simulator.md](./simulator.md#scripted-faults-plan-34c)), a symptom (`null` = **Check everything**)
and `expect`, a case-insensitive regex for the cause:

| id                   | car   | fault           | symptom                              | expect                        |
| -------------------- | ----- | --------------- | ------------------------------------ | ----------------------------- |
| `golf-low-boost`     | Golf  | `low_boost`     | pulls weak above 2000 rpm            | `boost\|turbo\|MAP`           |
| `punto-lean`         | Punto | `lean_trims`    | high fuel consumption and rough idle | `lean\|vacuum\|trim`          |
| `golf-weak-charging` | Golf  | `weak_charging` | battery light flickers               | `charg\|alternator\|voltage`  |
| `golf-everything`    | Golf  | none            | (Check everything)                   | `P2183\|P2015` (seeded codes) |

Per case the harness connects a real `DiagnosticSession` over `MockTransport`, builds the core +
playbook registry, runs triage and then `runAgent` with the real `getAiClient` chat (Node `fetch`).
The eval's driver answers **Done** to every driver step; on the rev hold (`hold_2500_rpm`) it also
calls `holdRevs(15_000)`, so the simulator holds 2500 rpm the way the app does after **Done**. The
clock and sleeps are real, so a case takes as long as it would in the app.

**Run it** against your own server (PowerShell; the provider defaults to `custom`, an
OpenAI-compatible server such as LM Studio or llama.cpp):

```powershell
$env:BOLID_EVAL_URL='http://192.168.1.50:1234'   # the server, with or without /v1
$env:BOLID_EVAL_MODEL='qwen2.5-14b-instruct'     # the model name the server lists
$env:BOLID_EVAL_KEY='sk-...'                     # optional
$env:BOLID_EVAL_PROVIDER='custom'                # optional: local | openai | anthropic | custom
npm run eval:agent
```

In Git Bash: `BOLID_EVAL_URL=http://192.168.1.50:1234 BOLID_EVAL_MODEL=qwen2.5-14b-instruct npm run eval:agent`.
To check the harness without a model, point `BOLID_EVAL_URL` at an address nothing listens on
(`http://127.0.0.1:9`): every case ends `ai_error` with the rule report, and the suite passes.

**Reading the output.** One line per case, then the pass count:

```text
golf-low-boost  PASS  final  5  48.2  Boost stays near baro at the rev hold
punto-lean  FAIL  steps  12  131.0  Check-engine light is on
...
3/4
```

The columns are `id`, `PASS` / `FAIL`, how the run ended (`final` = the model's own report; `steps`,
`time`, `invalid`, `ai_error`, ... = the rule fallback), steps used of the 12-step budget (triage
included), wall time in seconds, and the title of the most severe finding (the first on ties). A case
**passes** when the report is the model's own (`source: 'ai'`), its most severe finding matches
`expect` (title, detail, codes or likely causes) and cites at least one step. A rule-fallback report
never passes, because the eval measures the model, not the on-device rules. The test asserts only that
every case finished; the pass rate is a measurement.

**What to tune** when cases fail:

- **Ends `invalid`:** the model keeps sending replies that are not one valid JSON action. Try the
  other structured-output mode for the server, or tighten the action wording in
  `buildAgentSystemPrompt` (`src/shared/obd-core/agent/prompt.ts`).
- **Ends `steps` or `time`:** the model wanders instead of opening the matching playbook. Check the
  playbook descriptions it sees and the prompt's step-budget wording; `AGENT_BUDGET.maxSteps` (12) in
  `loop.ts` is the step budget.
- **`final` but the wrong top finding:** the model loses the evidence of earlier steps. `FULL_DIGESTS`
  (3) in `prompt.ts` is how many of the latest steps keep their full digest; older ones send only their
  summary. Raise it if the context window allows (`CONTEXT_TOKEN_TARGET`).
- **`final` but `FAIL` with the right cause:** the finding cites no step (it is dropped as uncited)
  or a milder finding outranks it. Look at the prompt's citation and severity rules.

Change one thing at a time and compare the lines and the pass count across runs; a small local model
varies from run to run, so run the set more than once before you trust a change.

## End-to-end

A [Maestro](https://maestro.mobile.dev) smoke flow, `.maestro/simulator-smoke.yaml`, drives the app
on an Android emulator from a fresh install: **Settings → Developer & simulator (row → page) → Simulator (no car) → P0299 → Connect →
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
- **Status (2026-11-22): green on an emulator.** First local runs on AVD `Sere_API36` (Android 16,
  x86_64, 1080 × 2400) with a release-signed APK (embedded bundle) and Maestro CLI 2.12.1 on
  Windows: the flow passed on every run after the first — three in a row on the first APK, once on
  the second and twice in a row on the final build (23 steps each; the optional permission tap is
  skipped, that image shows no prompt). The only change
  it needed was a stale string (the vehicle screen's subtitle is now "Pick a car, or use Auto /
  Generic for any OBD2 car"). The two things flagged for the first run held: the bare `Connect`
  taps hit the tab, and `(?i)clear` hits the alert button. If Maestro stops at once with
  `DeviceServerDiedException … UNAVAILABLE` and no step output, a stale driver from an earlier
  session is still on the device: `adb shell am force-stop dev.mobile.maestro` (and
  `dev.mobile.maestro.test`) and run again. `e2e.yml` first ran green on GitHub on 2026-11-22
  (run 45029217374, API 34 `pixel_6` emulator) after three CI-only fixes: wait for the Connect
  subtitle instead of the below-the-fold **Scan for adapters**, 60 s per `scrollUntilVisible`,
  and resilience to "… isn't responding" system dialogs on a freshly booted emulator (hide error
  dialogs, settle, tap **Wait**, retry the flow once).

### AI agent flow (plan 34c)

`.maestro/ai-agent.yaml` drives a whole agent investigation with no car and no AI server: fresh
install → **Settings → Developer & simulator → Simulator (no car) → Scripted fault: Low boost** →
back → **Settings → AI assistant** → make sure it is on (it is on by default; the flow taps the switch
only while the "off" help text shows) → **Provider: Custom** → **Server URL** `mock://ai` →
**Connect → Connect to simulator** → pick the Golf → **More → Diagnose (AI)** → type
`pulls weak above 2000 rpm` → **Investigate** → the rev-hold prompt ("In Park or Neutral, hold the
engine at 2500 rpm for 10 seconds.") → **Done** (the simulator then holds 2500 rpm with MAP near
baro) → the mock report ("Mock AI report: boost checked (no_boost_hold).") with **Based on: steps
1, 3** and the trail row **Ran the boost check**. The mock's boost script is described in
[features/ai-diagnose.md](./features/ai-diagnose.md#agent).

- **Needs a debug build.** `mock://ai` is refused in release builds (`getAiClient` checks
  `__DEV__`), so install a development build (`npm run android`, with `npm start` running) and run
  `maestro test .maestro/ai-agent.yaml`. The flow is **not** part of `e2e.yml`, which builds a
  release APK.
- **Status (2026-11-23): written, not yet run on an emulator.** The labels are the app's English
  strings; when a screen's copy changes, update the flow in the same change.

### Store screenshots (plan 30)

`.maestro/screenshots.yaml` reuses the same harness to capture the eight store screenshots in
simulator mode: fresh install → app language (Settings → General → Language) → Connect tab with
the first-run card → simulator, Golf, injected `P2183, P2015` → connect → each screen by deep link
(`bolidtester://dashboard`, `faults`, `inspection`, `charts`, `module-scan`, `battery`,
`maintenance`). Run it through `scripts/screenshots.sh [en|ro]`: it puts the emulator status bar
in demo mode, passes the labels of the chosen language (`scripts/screenshot-labels.mjs` reads
them from the locale files) and finishes with `npm run store:assets` (resize to 1080 × 2400) and
`npm run store:release-check`. Labels reach the flow only from the script: Maestro 2.x lets a
flow's `env:` win over `maestro test -e`, so the flow carries no language defaults, and the script
turns every non-ASCII character into `.` because on Windows the JVM decodes `-e` arguments in the
ANSI code page (no `ș` / `ț`). Maestro 2.x saves `takeScreenshot` files under its test-output
folder; the script runs with a scratch `--test-output-dir` and copies them into
`store/screenshots/android/phone/<lang>/`. Details in [store/README.md](../store/README.md).

- **Status (2026-11-22): generated.** On the same emulator and APK: 8 PNGs per language (`01-live`
  … `08-connect`, 1080 × 2400), `npm run store:release-check` passes ("16 screenshots (release
  minimums met)"). Each one was checked by eye: real content, no errors or spinners, the RO set
  in Romanian (only the analysis texts, PID / DTC names and module names stay English — the
  boundary in [i18n.md](./i18n.md#what-stays-english-the-untranslated-identifier-boundary)).
  Flow fixes on the way: pick the Golf profile after connecting (the app only suggests it from
  the VIN), dismiss the Charts gesture hint, run one battery capture (live voltage is read only
  while capturing), and enter an odometer and log three services so Maintenance shows due
  distances; scroll to the custom-codes field (off screen in Romanian); no `hideKeyboard` on
  Maintenance (its Back press left the route). App fixes it surfaced: the simulator reported spark
  ignition for diesel profiles, and Faults showed the raw ignition enum and let the Romanian
  readiness header run off the card. iOS (6.7") screenshots are still to do (needs a Mac).

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
