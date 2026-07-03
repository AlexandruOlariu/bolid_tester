# Implementation Log

A running record of what was actually built, newest first. (Documentation-driven: specs live in the
other docs; this file is the "what we did" history.)

---

## Real-adapter hardening pass (2026-07-03)

**Status:** ✅ complete — full suite **272 tests** green (16 new), `eslint` 0, core + full-app
`tsc` 0. A code review of the VCDS-parity expansion found four real-hardware gaps the simulator
could not catch; all fixed simulator-first, with the simulator upgraded to REPRODUCE the real
adapter behaviors so the whole test suite now exercises them.

- **ISO-TP multi-frame de-framing** (was P0) — real ELM327s print >7-byte CAN responses as a hex
  length line + `N:`-prefixed segment lines; `parseElmResponse` treated those prefix digits as
  payload hex, garbling module idents, `19 02` DTC lists, `19 04` snapshots and long DIDs on real
  hardware (VIN survived only via its `49 02` marker resync). New
  `responseParser.reassembleIsoTp` strips the prefixes and uses the length line to truncate clone
  padding; `MockTransport.shapeResponse` now prints the real multi-line format on CAN, so every
  integration test exercises the de-framing (datasheet VIN example pinned in unit tests).
- **Addressing restore** (was P0) — `setHeader(null)` used to send bare `ATSH` (invalid on real
  firmware: `?`, old header kept) and `ATCRA` was never cleared, leaving the adapter deaf to
  standard replies after ANY module-scoped work. New `DiagnosticSession.resetAddressing()` —
  protocol-aware functional header (`7DF` 11-bit CAN / `686AF1` ISO 9141 / `C233F1` KWP) + bare
  `ATCRA` — is called in the `finally` of every module path: module-scan, adaptations, routines,
  coding, sensor-tests, service-reset. The simulator now rejects bare `ATSH` and models a stale
  receive filter blocking replies; regression tests pin both directions.
- **NRC 0x78 responsePending** (was P1) — `checkNegative` (deduplicated into `udsCoding`, shared
  by `udsModule`/`guidedRoutine` — was 3 copies) strips repeated `7F <svc> 78` echoes before
  judging a response, so slow operations (forced DPF regen start, security access, clears) no
  longer fail spuriously; pending-only responses throw a distinct 0x78-tagged `UdsError`.
  `securityAccess` retries once after NRC 0x37 (boot lockout) and never retries 0x36.
- **Interlocks fail closed + run continuously** (was P1) — an unreadable RPM/speed now BLOCKS a
  routine instead of silently passing (`requireEngineOff`/`maxSpeedKmh` were fail-open), and
  `useRoutines` re-checks interlocks during the run on the same periodic tick as the keep-alive
  (single interval → deterministic ordering; `checkInterlocksDuringRun` switches to the functional
  address and back), auto-stopping on violation. Spec: [`features/routines.md`](./features/routines.md).

Smaller, from the same review: `Tp20Channel` serializes requests + keep-alive channel tests
through an op queue (the `busy` flag was check-then-act racy — a keep-alive could inject `0xA3`
mid-packet); adaptation values support **signed** (two's-complement) channels; `writeChannel`
enforces min/max bounds at the service layer (was UI-only); the module-scan "skipped" copy now
points at the shipped TP2.0 gateway scan instead of calling it future work.

---

## Phase 5 — Diesel, ownership & screening (5 features)

**Status:** ✅ core + UI built, verified here (full suite **141 tests** green, `eslint` clean, full-app
`tsc -p tsconfig.app.json` **0 errors**). Specs: [`dpf`](./features/dpf.md),
[`used-car-inspection`](./features/used-car-inspection.md), [`battery-health`](./features/battery-health.md),
[`vin-decode`](./features/vin-decode.md), [`maintenance-log`](./features/maintenance-log.md).

Pure, unit-tested core (no hardware):
- `obd-core/obd/vinDecode.ts` (+ test) — `decodeVin` (WMI dictionary, ISO-3780 country, char-10 year
  with the char-7 rule, FMVSS-565 check digit). Verified against the three example VINs + a US case.
- `obd-core/analysis/battery.ts` (+ test) — `analyzeBattery` / `socFromResting` (resting SoC, cranking
  dip, alternator voltage, verdict + notes).
- `obd-core/analysis/dpf.ts` (+ test) — `assessDpf` (soot %, regen status, EGT-driven regen detection).
- `obd-core/analysis/maintenance.ts` (+ test) — `computeDue` / `dueStatus` / `projectOdometer` +
  `DEFAULT_SERVICE_ITEMS` (diesel-biased: timing belt, fuel filter, DPF check).
- `obd-core/analysis/inspection.ts` (+ test) — `assessInspection` incl. the "recently-cleared"
  readiness heuristic. All exported from `obd-core/index.ts`.

Vehicle data:
- Golf TDI profile gains a **diesel/DPF extended-PID pack** (soot mass/%, ash, distance & count since
  regen, EGT, oil temp, EGR), each `experimental` and tagged `category`/`role`; `ExtendedPid` gained
  optional `category`/`role` fields. The simulator auto-seeds every DID from its `sampleResponse`.

Feature slices (feature-sliced, Tamagui) + routes + **More** menu + hidden tabs:
- `features/dpf` — CAN/diesel-gated DPF monitor (status banner + tiles), maps DID `role`s into
  `assessDpf`.
- `features/inspection` — one-tap used-car screening (readiness + DTC 03/07/0A + freeze frame +
  distance-since-clear → verdict).
- `features/battery-health` — `ATRV` voltage capture → `analyzeBattery`.
- `features/vin-decode` — decodes the session VIN or a typed VIN; also linked from **Vehicle info**.
- `features/maintenance` — persisted logbook (`bolid.maintenance`) + due list.

---

## History feature (feature: history)

**Status:** ✅ added. A persistent, file-backed log of every AI auto-diagnose run and every
fault-code check. Spec: [`features/history.md`](./features/history.md).

- `src/shared/state/historyStore.ts` — persisted (expo-file-system, `bolid.history`) zustand store;
  `AiHistoryEntry | DtcHistoryEntry`, `addAiRun` / `addDtcCheck` / `remove` / `clear`; unlimited.
- Recorders: `useAiDiagnose` (AI runs) and `fault-codes/dtcService.readAll` (DTC checks); both use a
  new shared `vehicleLabel()` helper in `shared/vehicles`.
- `src/features/history/` — `HistoryScreen` (All/AI/Faults filter, colour-coded cards, Clear all) +
  `/history` route, hidden tab, and a **More** menu entry.

Also: settings + AI config + selected vehicle now persist across launches (zustand `persist` over the
same file storage); the AI request no longer sends `temperature`; structured output is a 3-way
schema/object/off control with auto-fallback when a server rejects `response_format`.

---

## AI auto-diagnosis (feature: ai-diagnose)

**Status:** ✅ core complete and verified (pure logic unit-tested here; 20 new tests, full core suite
green, lint clean). The RN screen + settings build on a dev machine / EAS like the rest of the app.
Spec: [`features/ai-diagnose.md`](./features/ai-diagnose.md).

One-tap health check: gather a snapshot from the live `DiagnosticSession` (DTCs 03/07/0A, readiness,
freeze frame, and a one-shot poll of the key supported live PIDs), send it to a user-configured
**OpenAI-compatible** server (e.g. a local **LM Studio**), and render a plain-language report. Falls
back to a deterministic on-device rule-based report when the AI is off/unconfigured/unreachable.

Platform-agnostic core (`src/shared/obd-core/analysis/aiDiagnosis.ts`, unit-tested):
- Types `DiagnosticSnapshot` / `AiReport` / `AiFinding` / `AiAction` / `AiClientConfig`.
- `summarizeSnapshot`, `localHeuristicReport` (MIL/DTCs/overheat/fuel-trim/charging/readiness rules).
- `buildDiagnosisMessages`, `buildChatRequestBody`, `extractMessageContent`, `parseAiReport`
  (tolerant of code-fenced/prose-wrapped JSON; falls back to local on any failure),
  `normalizeBaseUrl`, `overallFromFindings`, `KEY_DIAGNOSTIC_PIDS`.

App layer:
- `src/shared/ai/openaiClient.ts` — `chatCompletion` / `listModels` over `fetch` with an
  AbortController timeout and friendly errors (lives in `shared`, no cross-feature deps).
- `src/features/ai-diagnose/*` — store, `diagnoseService` (gather/analyze/clearCodes), `useAiDiagnose`
  hook, and `AiDiagnoseScreen` (overall banner, findings, gated Clear-DTC action, disclaimer).
- Settings → **AI assistant** section (enable, server URL, model + Detect, JSON mode, timeout, Test).
- Routing: `/ai-diagnose` route + hidden tab; entry added to the **More** menu.

Safety: reads + **clear DTCs only** (Mode 04, confirmed); the model only *suggests* actions from a
fixed enum and never writes coding/service-reset.

---

## Phase 4 — Analysis, performance, sensor tests, coding & notifications

**Status:** ✅ core complete and verified (87 tests pass, lint clean). UI slices built on top of the
tested core; the RN/Tamagui screens compile/run on a dev machine / EAS like the rest of the app.
Specs: [`features/trip-recording`](./features/trip-recording.md), [`live-charts`](./features/live-charts.md),
[`performance-tests`](./features/performance-tests.md), [`alerts`](./features/alerts.md),
[`sensor-tests`](./features/sensor-tests.md), [`coding`](./features/coding.md),
[`notifications`](./features/notifications.md).

Platform-agnostic core (in `src/shared/obd-core`, all unit-tested here):
- `analysis/alerts.ts` — `AlertEngine` (edge detection + hysteresis), `defaultRules`.
- `analysis/performance.ts` — `computeAccelRun` (0–100 + splits), `computeDragRun` (60 ft / ⅛ / ¼
  mile + trap), `computeBrakeRun`, plus `timeToSpeed` / `cumulativeDistance` integration.
- `analysis/trip.ts` — `downsample`, `tripStats` (duration/distance/max), `toCsv` / `toJson`.
- `analysis/chartBuffer.ts` — `ChartBuffer` ring buffer + min/max `decimate` + `seriesStats`.
- `analysis/notifications.ts` — `deriveDiagnosticEvents` (MIL/connection rising edges), quiet-hours
  `filterNotifications`, `dueReminders`.
- `obd/mode06.ts` — `decodeMode06` (on-board monitor test results with pass/fail).
- `coding/coding.ts` — byte/bit helpers, schema decode, `diffCoding`.
- `coding/udsCoding.ts` — UDS sequence (`10/27/22/2E/3E`) and the guarded `codeModule`
  (read→backup→security→write→verify) over an injectable sender.

Engine/profile/simulator extensions:
- `vehicles/types.ts` + the Golf profile gained `mode06Tests`, `moduleSensors` (illustrative ABS
  wheel-speed), and `codingModules` (illustrative BCM coding) — all clearly experimental/unverified.
- `MockTransport` now answers **Mode 06**, **module-scoped UDS 22** (via `ATSH` addressing), and the
  **coding services**; `buildScenario` wires the new profile data through.
- `DiagnosticSession` gained additive `send` / `setHeader` / `setRxFilter` / `readMode06`.
- Integration tests cover Mode 06, an ABS module read, and a full coding backup→write→verify on the
  Golf simulator — all with no hardware.

Follow-up (reachability + Passat): added a visible **More** tab (`src/features/more`) that links to
all the Phase-4 screens (charts, performance, trips, alerts, sensor tests, service reset, coding,
notifications) via expo-router — they were previously hidden routes. Extended **service reset to the
Passat** with a **KWP2000 (K-line)** path: `serviceReset` now branches on `transport: 'uds' | 'kwp'`
(KWP uses `10`/`27`/`31`/`3B`/`21`); the simulator answers the KWP session-start + routine; the
Passat profile carries an illustrative KWP descriptor; UI gating matches the link (CAN for UDS,
K-line for KWP). Tests: 87 passing.

Follow-up (service reset): added a **service-interval reset** ("oil service / SRI reset") — a write
to the instrument cluster via UDS **RoutineControl `31`** or adaptation `2E`, in
`obd-core/coding/udsCoding` (`routineControl`, `serviceReset`) with unit + Golf-simulator integration
tests; `MockTransport` answers RoutineControl; the Golf profile carries an illustrative `serviceReset`
descriptor; a gated `service-reset` feature slice + route. Experimental — extended to the Passat via
KWP2000 in the follow-up above. Spec: [`features/service-reset`](./features/service-reset.md).

UI (feature-sliced, `src/features/*`, each with `model` Zustand store + `hooks` + `ui` screen +
`index`): `alerts`, `live-charts`, `performance-tests`, `trip-recording`, `sensor-tests`, `coding`,
`notifications`; a shared `src/shared/notify` delivers local notifications (dependency-tolerant
wrapper) so features don't depend on each other. New expo-router routes registered (hidden tabs);
`expo-notifications` / `expo-file-system` / `expo-haptics` / `expo-location` / `expo-sharing` added
to `package.json` (install on a dev machine with `npx expo install`).

Verified here: `npm test` (87 passing), `npm run lint` (0 issues). Note: `npm run typecheck` currently
trips on a pre-existing `expo/tsconfig.base` `customConditions` vs `moduleResolution` conflict in the
toolchain (unrelated to this code); ts-jest type-checks the core on every test run.

---

## Phase 3 — Polish (in progress)

Done:
- **Verified the whole app typechecks** against the real RN/Tamagui/`react-native-ble-plx` types
  (`npm run typecheck:app` → 0 errors), not just the core.
- **Readiness monitors** (Mode 01 PID 01) — `src/shared/obd-core/obd/readiness.ts`
  (`decodeMonitorStatus`) + `DiagnosticSession.readReadiness()`, surfaced on the Fault Codes screen
  (MIL state, monitors complete/total, spark/compression ignition, not-ready list).
- **Freeze frame** (Mode 02) — `DiagnosticSession.readFreezeFrame()` + simulator support, shown on the
  Fault Codes screen with the triggering DTC and captured PIDs.
- **CI** — `.github/workflows/ci.yml` runs lint + core typecheck + tests + full-app typecheck on
  every push.

Verified: `npm test` (39 passing, 11 suites), `npm run typecheck` (0), `npm run typecheck:app` (0),
`npm run lint` (0).

Remaining (needs hardware or external accounts):
- On-car validation against the three example cars (checklists in `testing.md`); tune the profiles
  from what the real cars report.
- Log export/share; optional persisted settings (AsyncStorage).
- iOS/Android store or EAS builds + signing (Apple Developer account / Android keystore).

## Phase 2 — Mobile app (Expo + Tamagui + BLE)

**Status:** ✅ code complete. Core stays green here; the RN app compiles/runs on a dev machine /
EAS (native build can't run in the container). See [`phase2-mobile-app.md`](./phase2-mobile-app.md).

Implemented the feature-sliced UI over the tested core:
- `src/shared/transports/ble/BleTransport.ts` — `Transport` over `react-native-ble-plx` with
  **runtime characteristic discovery** (no hard-coded UUIDs); `permissions.ts`, `manager.ts`,
  and a dependency-free `src/shared/lib/base64.ts` (unit-tested) for BLE payloads.
- `src/shared/state/*` — Zustand stores (`sessionStore`, `settingsStore` incl. the adapter I/O log)

## Error log ("logging zone")

**Status:** ✅ code complete; core verified here (`npm test`, `npm run lint`, `npm run typecheck`,
`npm run typecheck:app` all green). See [`features/error-log.md`](./features/error-log.md).

A persistent, capped on-device store of errors, reviewable and **exportable** (Markdown/JSON via the
share sheet) to fix later.
- `src/shared/lib/errorLog.ts` — pure, unit-tested core: `LoggedError` shape, `normalizeError`,
  `buildLoggedError`, and the export renderers (`formatErrorsForExport`, `errorsToJson`).
- `src/shared/state/errorLogStore.ts` — persisted Zustand store (`bolid.errors`, capped at 500) with
  the module-level `logError(...)` convenience and `installGlobalErrorHandlers()` (chains RN
  `ErrorUtils` + web `unhandledrejection`).
- `src/features/error-log/*` — `ErrorLogScreen` (severity filter, expandable stack/context, delete,
  clear, export) + `useErrorLogExport` (dependency-tolerant expo-file-system/expo-sharing). Wired
  into the `connection`, `fault-codes` and `ai-diagnose` catch blocks and reachable from **More**
  (`/error-log`). Partly addresses the earlier "log export/share" remaining item.

## VCDS-parity expansion (2026-07)

A large parity pass toward "do what VCDS does on the VW cars", plus OBD2 gap-fillers. All
simulator-first and unit-tested; app compiles (`typecheck`, `typecheck:app`, `lint` green; full
`npm test` green). New docs under `docs/features/` and a roadmap at
[`vcds-parity-roadmap.md`](./vcds-parity-roadmap.md).

**Passat service reset** — root-caused: the B5.5 instrument cluster speaks **KWP1281**, which a
generic ELM327 cannot address, so the OBD reset returns "No response" ("Failed: No response" on the
car). The profile now carries an honest `obdUnreachable` reason; the screen **leads with the
dash-stalk manual procedure** and demotes the OBD attempt to an explicit "try anyway".
`isModuleUnreachableError` widens error matching (No response / NO DATA / timeout / UNABLE TO
CONNECT / BUS INIT).

**New obd-core modules** (all pure, unit-tested): `uds/udsModule` (0x19 read / 0x14 clear / 0x19 04
snapshot / ident DIDs + status decode), `uds/vagDtcs` (VAG 5-digit dictionary), `uds/guidedRoutine`
(2F/31), `coding/adaptationValue`, `obd/multiPid`, `obd/iupr`, `obd/mode05`, `obd/canMonitor`,
`transport/logReplay`, and the **`tp20/`** stack (framing, `Tp20Channel`, `scanTp20`, an in-memory
`FakeTp20Bus`, `Elm327RawCanLink`, VAG address names).

**New features** (feature-sliced + routes + More entries + docs): `module-scan` (VCDS-style
auto-scan incl. TP2.0 gateway list), `adaptations` (channel browser with label packs), `routines`
(output tests / basic settings with live interlocks), `can-sniffer` (ATMA monitor). Plus:
multi-PID batching in `pollOnce` (CAN), a freeze frame per stored DTC, IUPR in `used-car-inspection`,
Mode 05 in `sensor-tests`, VIN→profile suggestion in `vehicle-select`, and adapter-log→replay-fixture
export in Settings.

**Label packs** (`src/shared/labels/`) — the open equivalent of VCDS label files, keyed by module
part-number prefix.

**Honest limits kept explicit:** the Passat (KWP1281) stays out of module scan / adaptations /
routines; every non-standard address/DID/routine id is badged illustrative; TP2.0 over a generic
ELM327 is documented as timing-sensitive and adapter-dependent.
