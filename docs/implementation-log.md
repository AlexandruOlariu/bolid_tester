# Implementation Log

A running record of what was actually built, newest first. (Documentation-driven: specs live in the
other docs; this file is the "what we did" history.)

---

## Plan 03 — Bus sniffer: save and share captures (2026-11-08)

[Plan 03](./plans/03-sniffer-capture.md) landed (everything above its "Deferred until an on-car
session" section; the VCDS recording and BLE throughput measurement are on-car pending).

- **Core (pure):** new `obd-core/obd/captureBuffer.ts` — `CapturedLine { t, raw, frame }` and
  `CaptureBuffer` (O(1) ring, default capacity `DEFAULT_CAPTURE_CAPACITY` = 20 000, `size`,
  `dropped`, chronological `lines()`, `clear()`; unparsed lines kept with `frame: null`).
  `canMonitor.ts` gained `CaptureHeader`, `formatCaptureCsv` (`# key: value` header, then
  `t_ms,id,dlc,bytes`, one row per frame, relative `t_ms`, upper hex, trailing `# raw:` block for
  unparsed lines) and `formatCaptureRaw` (header + one `t_ms<TAB>line` per input). Both exported
  from `obd-core/index.ts`.
- **Feature:** `snifferStore` gained `capturedLines`, `dropped`, `note`, `lastExportUri`,
  `setCapture`, `setNote`, `setLastExportUri` (`reset()` keeps the note). New
  `model/captureSession.ts` (module-level current capture), `api/captureExport.ts`
  (`buildCaptureHeader`, `captureFileName` → `bolid-sniff-<vehicleId>-<stamp>.csv|.txt`,
  `buildCaptureFile`, `shareCaptureFile`) and `hooks/useSnifferExport.ts`. The run lifecycle moved
  out of the hook into `model/snifferController.ts` (`SnifferController`, one per session:
  `start` / `stop` / `dispose`; `finishedCapture()`), so it is unit-tested in node. Start clears
  the capture and freezes a `CaptureContext` (vehicle id, session info, device name, note) in
  `captureSession.ts`, which the header is built from at Share time — so changing the car,
  reconnecting or editing the note after Stop cannot rewrite the file. Every line goes into the
  capture, counts are published in the 500 ms snapshot, export is refused while running or empty,
  and dispose (unmount / session change) stops `ATMA` and marks the run finished — also when it
  lands during the `ATH1` round trip before the monitor exists (the controller stops the monitor
  once setup returns and never creates the snapshot interval); Stop pressed mid-setup waits for it.
  `useSniffer` is now a thin binding. `SnifferScreen`: note input above Start (read-only while
  running), `captured N · dropped M`, **Share CSV** / **Share raw** (disabled while running) with
  a one-line explanation and the saved file name; a finished capture can also be shared while
  disconnected (Start is replaced by "Not connected — reconnect to start a new run."); the per-id
  table is unchanged.
- **Simulator:** the Golf scenario's `monitorFrames` is now 30 frames across 4 ids (TP2.0 channel
  setup `200`→`201`, tester session `7E0`→`7E8`) via a new `SIM_MONITOR_FRAMES` map in
  `transport/scenarios.ts`; other profiles unchanged.
- **Tests:** `captureBuffer.test.ts` (7: capacity eviction, order, unparsed lines, 25 000 lines,
  copy + `clear`), `canMonitor.test.ts` (+4: header lines, rows, relative `t_ms`, hex, `# raw:`
  block, raw dump), `sniffer.integration.test.ts` (+2: start → 20 lines → stop → CSV with the
  header and 20 data rows; Golf stream shape), `features/can-sniffer/api/captureExport.test.ts`
  (8: header, file name / MIME, write + share against mocked native modules, failure logged),
  `features/can-sniffer/model/snifferStore.test.ts` (1),
  `features/can-sniffer/model/snifferController.test.ts` (6: Start clears + freezes the header
  context against the simulator, export refused while running / empty, dispose while running
  releases the channel, dispose and Stop during ATMA setup, double Start). Suite **579 → 607
  tests** (77 → 81 suites).
- **Docs:** new `features/can-sniffer.md` (full spec, file formats, memory bound, "Record a VCDS
  session" guide); linked from `features/routines.md` § "Confirming a routine" and
  `features/tp20.md` § "Honest limits"; `simulator.md` (ATMA streaming + Golf frames);
  `roadmap.md` (Sniffer captures ✅, on-car pending). This also covers the `can-sniffer` spec item
  of plan 04.

**Deviations from the plan:**

- The capture buffer lives at module level (`model/captureSession.ts`) instead of a `useRef`, so a
  finished capture can still be shared after the screen is left and reopened (the store counters
  already survived; a ref would have left them pointing at an empty buffer).
- `CaptureHeader` gained an optional `dropped` (written as `# dropped: M`), and the header also
  prints `# lines:` / `# t_ms` explanation lines. Unknown protocol / adapter print as `unknown`; the
  `# note:` line is always present (empty when no note).
- `appVersion` is supported by the formatter but not wired in the app — there is no app-version
  source yet (plan 08 owns versioning).
- The export writes through `expo-file-system/legacy`, not the root `expo-file-system` that
  `useErrorLogExport` imports: on this Expo SDK the root module exports no `documentDirectory`
  and its `writeAsStringAsync` throws (the legacy API moved to `/legacy`). The other existing
  export hooks (error log, DTC report, measuring log, adapter health, chart, module scan, car
  backup) still use the root import, so on a device they most likely return null without
  writing — left for a follow-up, outside this plan.
- Pure export logic sits in `api/captureExport.ts` (unit-tested in node); `useSnifferExport` is a
  thin `busy` wrapper around it rather than a full copy of `useErrorLogExport`.
- The vehicle id comes from `features/vehicle-select/model/vehicleStore` (now imported by
  `model/snifferController.ts`; the existing pattern in `useDpf`, `useCoding`, …), a feature →
  feature import the repo rules discourage; there is no shared selector for it yet. Kept after
  review, consistent with plan 01's decision: moving the store into `shared/state` is a
  cross-cutting refactor (~20 importers; plans 06 / 18 / 32 name its current path) better done
  with plan 07 than inside plan 03.
- The hook-level lifecycle is tested through `SnifferController` rather than by rendering
  `useSniffer`: the jest setup is node-only (`*.test.ts`, no React renderer), and plan 10 owns
  component tests.
- `transport/scenarios.ts` was not run through Prettier (the file was not Prettier-clean before;
  formatting it would rewrite unrelated lines). Same for `routines.md` / `tp20.md`.

---

## Plan 12 — BLE robustness and connection diagnostics (2026-11-08)

[Plan 12](./plans/12-ble-robustness.md) landed (everything above its "Deferred until an on-car
session" section; on-car confirmation pending).

- **Auto-reconnect on by default + flap guard.** `settingsStore` default `autoReconnect: true`;
  persist **version 3**, with plan 01's `migrateSettings` extended by a `fromVersion < 3` step
  (`autoReconnect: p.autoReconnect ?? true` — a stored value survives). New pure
  `connection/api/flapGuard.ts` (`FLAP_WINDOW_MS` 60 s, `MAX_DROPS_PER_WINDOW` 3,
  `shouldAutoReconnect`, `pruneDrops`); `handleUnexpectedDrop()` records each drop and pauses with
  `FLAP_PAUSED_MESSAGE` on the third in a minute; a manual `connect()` resets it.
- **MTU + chunked writes** (`shared/transports/ble/BleTransport.ts`): `requestMTU: 247` only on
  Android (`Platform.OS`), negotiated `device.mtu` read after connect (23 fallback), new
  `linkInfo: BleLinkInfo | null` and `payloadForMtu()`; `write()` sends `mtu - 3` (floor 20) chunks
  in order.
- **Sleep / wake** (`obd-core/elm327/Elm327Client.ts`): `wakeAfterIdleMs` (default 20 000, 0
  disables), `lastIoAt`, `execWake()` (≤ 600 ms, never rejects; a wake timeout starts a drain like a
  command timeout), `init()` stamps after `ATZ`; monitor mode exempt. `connectionService` passes 20 000 for BLE and 0 for the simulator (half the
  scenario's `sleepAfterIdleMs` when it models sleep).
- **Drain-until-prompt**: a timeout starts a drain; `onData` discards the late reply through its
  `>`; the next command awaits it (prompt or `DRAIN_GRACE_MS` = 300 ms).
- **Diagnostics panel**: pure `connection/api/diagnoseFailure.ts` (stages
  `bluetooth | transport | init | probe | identify`, 8 ordered rules, `formatDiagnosticsReport`),
  `ui/ConnectionDiagnostics.tsx` mounted under the error panel on `ConnectionScreen` (stage chip,
  explanation, suggestions, collapsible Details with the attempt's last 20 log lines, link info,
  device, **Copy details** via `Share.share`, **Open error log**), and
  `connection/model/linkStore.ts` (`link`, `stage`, `attemptStartedAt`, `device`).
- **Simulator**: `SimScenario.sleepAfterIdleMs` (low-power model) and
  `MockTransport.dropResponses(n, { includeAt? })`. Settings gained a simulator-only **Developer**
  section — **Simulate a link drop** and **Fail next connect: no reply to ATZ** — through a new
  `connectionService.__sim` hook (`simulateDrop`, `failNextConnect`, `isFailNextConnectArmed`).
  Settings auto-reconnect copy now reads "On by default; pauses after 3 drops in a minute".
- **Tests**: `flapGuard.test.ts`, `diagnoseFailure.test.ts` (one case per rule + fallback + report),
  `BleTransport.test.ts` (39-byte write → 20 + 19 at MTU 23, one write at 247, with-response path,
  `linkInfo`, iOS passes no `requestMTU`, and a 16-byte Golf coding write through an MTU-23 BLE fake
  into the simulator), `Elm327Client.test.ts` (late reply, drain deadline, bare-CR wake, no-wake
  times out, `ATI` wake after an unsafe command, late wake reply drained, `ATI` wake in raw-CAN
  mode, no wake while busy, `isRepeatSafe` incl. raw-CAN), `MockTransport.test.ts` (sleep model,
  `dropResponses`), `connectionService.test.ts` (reconnects after a drop and pauses on the third,
  manual connect resets, spread-out drops never pause, off means off, all attempts failing ends in
  `error` with the last cause, fail-next-connect → stage `init`, a successful connect reaches
  `identify`, no 0100 reply → stage `probe`), `settingsStore.test.ts` (v3, v2 → v3 round-trips). The
  late-reply, wake and late-wake tests fail with the client changes disabled. Suite **527 → 579
  tests** (75 → 77 suites).
- **Docs:** `features/connection.md` (auto-reconnect default + flap guard, MTU/chunking, sleep/wake,
  drain, diagnostics panel + rules, `linkStore`, acceptance), `features/settings.md` (Developer
  section, auto-reconnect copy, v3 migration), `simulator.md` (`sleepAfterIdleMs`, test/dev
  controls), `obd2-reference.md` (bare-CR repeat; "Low power / auto-sleep"),
  `adapter-vgate-icar-pro.md` (quirks + what to confirm on the car), the hardening note in
  `improvement-plan-2026-07.md` marked resolved, `roadmap.md`; the context graph's connection
  concept updated.

**Review fixes (same plan):**

- **K-line rule vs. split notifications.** On BLE each rx log entry is one GATT notification (≤ 20
  bytes at MTU 23), so `UNABLE TO CONNECT` could straddle two entries and rule 6 never fired.
  `diagnoseFailure` now matches the attempt's rx text joined with whitespace removed (test: three
  split variants).
- **Panel showed the wrong device on failure.** `sessionStore.deviceId/deviceName` are only set on
  success (and kept after a drop), so a failed attempt was reported against "unknown" or the
  previous adapter. `linkStore.beginAttempt(stage, device)` now records the attempt's target and
  `ConnectionDiagnostics` reads it from there (`connectionService.test.ts` asserts it after a
  failed connect).
- **Bare-CR wake after an unconfirmed command.** `exec()` set `lastCmd` before the write, so after
  `04` and a swallowed, timed-out `03` the next wake was a bare `\r` and a real ELM327 would repeat
  its remembered `04`. A timeout, a failed write and an unanswered `ATI` wake now reset `lastCmd` to
  null (→ `ATI` wake). A failed write also starts a drain (only while it still owns `pending`).
  Tests: `04` → timed-out `03` → `ATI` wake; failed write → `ATI` wake.
- **Half-sent chunked write.** A chunk failing after earlier ones left a fragment in the ELM327's
  line buffer for the next command to be appended to. `BleTransport.write()` now sends a
  best-effort `LINE_FLUSH` (`X\r`) before rethrowing, so the fragment is rejected with `?`; a bare
  `\r` (the reviewer's suggestion) was not used because it would _execute_ the truncated fragment
  (e.g. a short `2E` write). Tests: flush after a failed second chunk; no flush when the first fails.

**Deviations from the plan:**

- **Wake-up command.** A bare `\r` makes a real ELM327 _repeat the previous command_, so a bare-CR
  wake after a clear (`04`/`14`), a coding write (`2E`), a routine (`31`) or an output test (`2F`)
  would run it again. The client sends a bare `\r` only when `isRepeatSafe(lastCmd)` (reads,
  `3E`, idempotent AT settings/queries) and otherwise — including a fresh connection, where the
  adapter's last command is unknown — wakes with the harmless `ATI`. Because `ATSP0` (init's last
  command) is not repeat-safe, the wake test reads `0100` after `init()` before idling.
- **Simulator wake answer.** With `sleepAfterIdleMs` set, a bare `\r` is answered with `\r>` whether
  the simulated chip is asleep or awake (so a wake never waits out the full 600 ms on an awake
  adapter); without the option the simulator still ignores it. The idle gap counts from the last
  write **or reply** (closer to a real chip than "last write").
- **Test timings.** The plan's 10 ms sleep / 5 ms wake / 20 ms idle are below Windows' ~15 ms timer
  tick (a `setTimeout(0)` reply took 22 ms), so the simulated chip fell asleep between init commands.
  The tests use 120 / 60 / 200 ms (and 1 200 / 300 / 1 300 ms for the `ATI` case, whose swallowed
  wake waits out the 600 ms timeout plus the 300 ms drain). The `MockTransport` sleep-model test uses
  a 400 ms sleep against 60 ms listens and 600 ms idles — a tighter 80 ms threshold was flaky under
  parallel Jest on Windows. The late-reply test sends the first command with a 50 ms timeout and
  the second with the default 1 000 ms (the plan's single 50 ms timeout would time out the second
  command too, at 200 ms latency).
- **Flap guard count.** The plan's message, acceptance ("after three drops in a minute it stops") and
  the Tests line ("false on the 4th") disagree; the guard pauses on the **third** drop inside 60 s,
  matching the message and the acceptance.
- **Classifier details.** Rule 5 ("vehicle isn't responding" → ignition) yields to rule 6 when the
  log also shows `UNABLE TO CONNECT` / `BUS INIT` — a failed K-line start-up ends in the same probe
  error, so in strict first-match order rule 6 could never fire for a connect. The Bluetooth rule
  ignores the simulator and a still-settling (`checking`) radio. The panel feeds the classifier only
  this attempt's log lines (`linkStore.attemptStartedAt`), so an older session's `ATZ` cannot
  mislead it.
- **`linkStore`** also records `attemptStartedAt`, and `link` is captured as soon as the transport
  reports `connected` (not only after `session.connect()` resolves), so a failure during init still
  shows the negotiated MTU. `stage` holds the furthest stage the attempt reached
  (`bluetooth → transport → init → probe → identify`); `DiagnosticSession.connect()` gained an
  optional `onStage` callback (`ConnectProgressStage`) for the last three.
- **Auto-reconnect giving up** ends in `error`, not `disconnected` (the plan has every connection
  failure open the diagnostics panel, which renders only on `error`), and appends the last
  attempt's error to the message.
- **Raw-CAN wake safety.** Not in the plan: while `ATCAF0` is in effect the client treats only AT
  commands as repeat-safe, so a bare-CR wake can never resend a TP2.0 data frame.
- **`MockTransport.dropResponses`** takes `{ includeAt }` (the acceptance's "extend the sim control
  to AT when a flag is set").
- The 16-byte coding-write acceptance test lives in `BleTransport.test.ts` (a BLE fake that
  reassembles writes until `\r` and feeds the Golf simulator), not a separate file.

---

## Plan 01 — Production first-run (2026-11-08)

[Plan 01](./plans/01-production-first-run.md) landed: a fresh install now behaves like a product.

- **Defaults + migration** (`shared/state/settingsStore.ts`): `adapterSource` defaults to `'ble'`,
  `injectedDtcs` to `[]`; persist `version: 2` with the pure, exported `migrateSettings` wired as
  `migrate` — a v1 blob keeps its explicit simulator choice, only missing fields get the new defaults.
  New pure `parseDtcList` backs the Settings **Custom…** DTC injection (first digit limited to
  `0`–`3`, since it is 2 bits on the wire — the plan's `[0-9A-F]{4}` would let `P4135` read back as
  `P0135`).
- **Simulator banner** (`connection/ui/SimulatorBanner.tsx`): amber one-line strip mounted in
  `_layout.tsx` via the `<Tabs screenLayout>` wrapper (inside `RootErrorBoundary`), so every route —
  hidden ones included — shows it under its header (it also shows while a session with device id
  `mock` is live). **Use real adapter** calls the new `connectionService.switchToRealAdapter()`, a
  thin wrapper over `switchAdapterSource(source)`, which the Settings segments use too: it bumps a
  connect epoch so an in-flight simulator connect tears itself down instead of publishing, cancels a
  pending auto-reconnect, resets the session store, flips the source, then closes the old session.
- **First-run card** (`onboarding/model/firstRun.ts` + `ui/FirstRunCard.tsx`): pick car → connect →
  read faults, replacing the `connect-basics` hint on the Connect tab; auto-dismisses (`first-run`)
  when complete. `dtcStore` gained an in-memory `lastReadAt`, stamped only by a real read:
  `dtcService.readAll()` now resolves `null` with no session and `useDtcs` then calls the new
  `clearResults()` (no stamp), so opening Faults while disconnected doesn't tick step 3.
- **Copy:** Connect simulator panel says readings are not from a real car and offers **Use a real
  adapter**; Settings segments renamed **Real adapter (Bluetooth)** / **Simulator (no car)** with a
  helper line.
- **Tests:** `settingsStore.test.ts` (defaults, migration incl. a real persist round-trip of v1 blobs
  through a mocked file system, `parseDtcList`), `firstRun.test.ts`, `connectionService.test.ts`
  (switching tears down a connected and an in-flight simulator session; same-source no-op) and
  `shared/state/dtcStore.test.ts` (`lastReadAt` only on real reads). Suite **504 → 527 tests**
  (71 → 75 suites).
- **Docs:** `features/settings.md`, `features/connection.md` (First run, Simulator banner), new
  `features/onboarding.md`, `features/fault-codes.md` (`dtcStore` location), `phase2-mobile-app.md`,
  root `README.md`; `features/coding.md` no longer claims coding "defaults to the simulator" and
  lists the gates as built.

**Deviations from the plan:** `FirstRunInput` gained a `genericAccepted: boolean` field (the pure
function cannot read the onboarding store, so the `first-run-generic-ok` dismissal is passed in), and
its `connectionStatus` reuses `ConnState` from `sessionStore` (same union). The banner/Connect-screen
switch goes through a new `connectionService.switchToRealAdapter()` instead of inlining
`disconnect()` + `setAdapterSource('ble')` in two places; it also cancels a pending auto-reconnect.
**Use a real adapter** sits under **Connect to simulator** (stacked) rather than beside it, to fit
phone width. The banner is mounted through `<Tabs screenLayout>` rather than as a sibling directly
above `<Tabs>`: a sibling would render above the navigator's header, under the Android edge-to-edge
status bar, whereas `screenLayout` puts it under the header on every route, which is what the plan
asks for. Custom-DTC parsing also drops duplicates and accepts whitespace as a separator.
**Layering:** `dtcStore` (and its test) moved from `features/fault-codes/model/` to
`src/shared/state/dtcStore.ts`, so the first-run card reads it through a shared store instead of
deep-importing another feature (plans/README: "never feature → feature"); EngineHost and
fault-codes now import it from `@/shared/state` too. `FirstRunCard` still deep-imports
`vehicle-select/model/vehicleStore` — kept deliberately: ~20 feature files already import it the
same way, so moving it into `shared/state` is a cross-cutting refactor better done with plan 07
(information architecture) than inside plan 01.

**Coding safety doc:** `features/coding.md` now states the gates that actually exist (CAN +
`codingModules` availability, the in-memory per-session unlock switch, a two-tap Confirm step,
backup-first + verify) in a new "Gates as built today" section, and marks the Settings flag and the
typed confirmation string as target-only, not built. With the real adapter now the default, a real
CAN write on the Golf profile is one switch and two taps away; adding those two gates is open work.

**Known limitation (migration):** v1's `partialize` always wrote `adapterSource` and `injectedDtcs`,
so every real v1 file has them — including installs that never chose anything and merely persisted
the old defaults (`'mock'`, `['P0299']`). As the plan specifies, the migration keeps them, so every
upgraded install stays in simulator mode with P0299 until the user switches (the banner flags it);
only fresh installs get the production defaults. The "v1 blob without an adapter choice" test covers
hand-edited/partial blobs only. Documented in `features/settings.md`.

**Status:** ✅ complete — no on-car part.

---

## Improvement-plan implementation (2026-07-15)

The full [`improvement-plan-2026-07.md`](./improvement-plan-2026-07.md) landed — Phases 1–5, all
ten Phase 6 nice-to-haves minus one deferral, and all ten Phase 6b VCDS-parity items.
Simulator-first, unit-tested; suite grew **309 → 504 tests** (46 → 71 suites), with `typecheck`,
`typecheck:app` and the repo-wide `lint` green.

**Phase 1 — connection correctness:** `Transport.onStatusChange` (BLE + mock, incl.
`simulateDisconnect()`); an unsolicited link drop now flips `sessionStore` to disconnected with an
actionable message; failed connects (e.g. ignition-off probe) tear the half-open transport down;
opt-in **auto-reconnect** with 2/5/10 s backoff (`connection/api/reconnect.ts`).

**Phase 2 — EngineHost:** cross-cutting engines moved out of screen hooks into a headless
`features/engine-host` mounted once in `_layout`: single demand-driven poll loop (union of
screen-acquired PIDs + alert-rule PIDs + trip set), alert evaluation, connection/diagnostic
notifications fed real `milOn`/`dtcCount`, trip sampling. Screen hooks became thin store
subscriptions; double-polling is impossible by construction.

**Phase 3 — multi-ECU parsing:** `ParsedResponse.frames` (one per plain hex line;
`bytes === frames[0]`), per-frame DTC parse + dedupe, OR-merged supported-PID bitmaps, and a
simulator secondary-ECU scenario (Punto engine+TCU) pinning the no-phantom-DTC regression.

**Phase 4 — data lifecycle:** adapter I/O log moved to a module-level ring buffer with a ~4 Hz
throttled publish and rx-pause during ATMA (`state/adapterLog.ts`); trips persist as summaries with
CSV-backed samples (`fromCsv`), CSV delete-on-remove and share; history capped at 200 with
debounced persist (`debouncedStorage`).

**Phase 5 — polish/DX:** AI `apiKey` now lives in the OS keystore (`expo-secure-store`, tolerant
import, one-time migration out of the settings file); a themed root `RootErrorBoundary` logs render
errors to the error log; ESLint covers all of `src/**` with react + react-hooks rules and a
`npm run ci` gate.

**Phase 6 — nice-to-haves:** fuel economy (015E or MAF+speed) on the dashboard + trip stats;
GPS trip tracks (expo-location, tolerant) with GPS-vs-OBD distance/speed; metric/imperial units at
display level; shareable HTML diagnostic report; dashboard gauge customization (per-vehicle,
persisted); adapter health check feature (grade + share); chart tap-inspect, pinch-zoom/pan and
window-CSV share; first-run onboarding hints + a11y labels on shared gauges; EAS Update wiring
('Check for updates' in More). _Deferred: 6.9 Web Bluetooth PWA transport._

**Phase 6b — VCDS parity, next tier:** forum-pasteable Auto-Scan text report; persisted scan
history with before/after diff; DTC search across modules; long-coding per-bit helper with label
names + live old→new preview; one-tap reversible coding tweaks (3 Golf Plus presets, sim-verified);
measuring-block CSV logging in extended-pids; per-profile guided fault finding (DTC → DIDs /
routine / freeze frame); full-car coding+adaptation backup with per-module gated restore;
readiness drive-cycle coach with flip-to-ready notifications; tester-present bus wake before scans.

Per-feature docs updated throughout; `vcds-parity-roadmap.md` status table reflects the landings.

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

Safety: reads + **clear DTCs only** (Mode 04, confirmed); the model only _suggests_ actions from a
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
