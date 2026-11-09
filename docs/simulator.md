# OBD2 Simulator (virtual ELM327)

`MockTransport` (`src/shared/obd-core/transport/MockTransport.ts`) is a **virtual ELM327** that makes
the entire app and test-suite runnable **without any hardware**. It implements the `Transport`
interface and answers AT/OBD commands with realistic bytes, parameterized by a **scenario** derived
from a vehicle profile.

## Why

- Develop and demo the app with no car or adapter.
- Deterministic, fast **unit/integration tests** (CI and this container).
- Reproduce per-car quirks (CAN vs K-line, missing PIDs, slow init) so the UI is exercised honestly.

## What it models

- **AT commands:** `ATZ` (version banner), `ATE0/L0/S0/H1`, `ATSP0`, `ATDPN` (returns the scenario's
  protocol number), `ATRV` (voltage), `ATI` (version). Unknown → `?`.
- **Addressing, realistically:** bare `ATSH` is rejected with `?` (like real firmware — restoring
  default addressing requires the protocol's functional header, e.g. `ATSH7DF`); `ATCRA` is
  **tracked**, bare `ATCRA` clears it, and a stale specific filter blocks default-address replies
  with `NO DATA` — the regression guard for `DiagnosticSession.resetAddressing()`.
- **Multi-frame printout, realistically:** CAN responses longer than 7 bytes are printed the way a
  real ELM327 prints reassembled ISO-TP messages — a hex length line, then `N:`-prefixed segment
  lines — so the app's de-framing (`responseParser.reassembleIsoTp`) is exercised by every
  integration test (module idents, `19 02` DTC lists, VIN, multi-PID batches).
- **Multi-ECU, realistically:** with a `secondaryEcus` scenario the simulator answers FUNCTIONAL
  (headers-off) requests — the supported-PID bitmaps (`0100/0120/…`) and Mode 03/07 DTCs — with
  **one plain hex line per responding ECU**, exactly as a real adapter does on an engine+aux car.
  Each ECU answers a bitmap range only when it supports a PID in it, and answers Mode 03 even with
  no codes (`43 00`). This pins the multi-ECU parsing fix (`responseParser` returns per-line
  `frames`; `DiagnosticSession.readDtcs` merges/dedupes per frame, `discoverSupportedPids` unions
  the bitmaps). The **Fiat Punto** profile is seeded this way (see `transport/scenarios.ts`
  `SIM_SECONDARY_ECUS`).
- **Protocol negotiation:** first OBD request may emit `SEARCHING...` then data; K-line scenarios add
  latency and may emit a `BUS INIT` notice.
- **Supported-PID bitmaps:** `0100/0120/0140/0160` computed from the scenario's PID set.
- **Mode 01 live values:** generated from a small physical model (idle vs revving, gentle noise) so
  gauges move realistically. Unsupported PIDs → `NO DATA`.
- **DTCs:** Mode 03/07/0A return the scenario's injected codes; **Mode 04** clears them (subsequent
  reads are empty). Mode 02 returns a freeze frame for the first stored code.
- **VIN:** Mode 09 PID 02 returns a scenario VIN (multi-frame on CAN); K-line scenarios can be
  configured to **not** answer (to emulate older ECUs).
- **Extended (Mode 22):** answers only the DIDs the scenario declares (Golf); otherwise `NO DATA`.
  `buildScenario` seeds every profile DID from its `sampleResponse` and, for a profile that declares
  DIDs, the engine module's `sampleIdent.F187` as ASCII on the default header (the Golf answers
  `22 F187` with `03L906022LM`), so the label pack and its measuring groups resolve in the simulator
  (plan 14). The live poll loop reads `22:<DID>` keys the same way (`pollExtendedOnce`). These are
  the **engine's** DIDs: on CAN they answer with default addressing or on the engine header `7E0`
  only, never on another module's `ATSH` header (plan 25) — a physically addressed `22 F187` there
  answers only from that module's seeded `moduleIdent`, so **Discover modules** on the Golf finds
  exactly `7E0`, `760` and `714`.
- **KWP login and local identifiers (plan 22):** `kwpLocals` (header, or `'*'` for the
  functional / single K-line ECU → local id → mutable bytes), `kwpLogins` (header | `'*'` →
  `{ code, wsc? }`, the codes the simulated module accepts) and `kwpLoginRequired` (local ids whose
  write needs a login). `2B` + 10 hex compares against `kwpLogins` → `6B`, or `7F 2B 35` for a
  wrong code (`7F 2B 11` when the module has no login); `21 <lid>` → `61 <lid> <bytes>`, else
  `NO DATA`; `3B <lid> <data>` → `7B <lid>` and stored, `7F 3B 33` when the lid needs a login and
  none succeeded in this session, `7F 3B 31` for an unknown lid. A `10 xx` restarts the session
  and drops that header's login, like a real module. `buildScenario` seeds `kwpLocals` and
  `kwpLoginRequired` from channels with `transport: 'kwp'` (their `sampleValue`; KWP channels are
  not put in the UDS `coding` store) and `kwpLogins` from a **simulator-only placeholder**
  (`SIM_KWP_LOGINS`: the Passat engine accepts `12345`, a demo value that is not a login code for
  any real module) replaced by any code the profile documents in `loginCodes` (`kwpLoginSeeds`;
  module addresses match trimmed and case-insensitive, like the app's `loginCodeFor`). Tests pin
  their own code with a `kwpLogins` override.
- **Bus monitor (`ATMA`):** streams the scenario's `monitorFrames` cyclically (one line per 30 ms,
  no prompt) until any byte interrupts it. The **Golf** streams 30 illustrative frames across 4 ids
  (TP2.0 channel setup `200`→`201`, tester session `7E0`→`7E8`) so a saved sniffer capture has real
  content; other CAN profiles a generic 5-frame mix, K-line a single line. See
  [can-sniffer](./features/can-sniffer.md).
- **GPS track (synthetic):** not an ELM327 feature, but simulator-only: with the adapter source set
  to the simulator, trip recording's `startTrackCapture()` does not touch `expo-location`; it walks
  a deterministic 2 km rounded-rectangle loop around 44.4268 N, 26.1025 E
  (`syntheticLoopPoint` in `analysis/track.ts`), one fix every 5 s plus one at the stop, advancing
  by the live `010D` speed (40 km/h when none is published). Each step is a straight line of
  speed × time from the last fix (`syntheticLoopAdvance`), so the GPS distance equals the OBD one
  even where a step cuts a corner. The trip is badged "simulated GPS" on the Trip detail screen, and
  its GPS-vs-OBD check reads `ok` at any steady speed. Demo: Settings → Simulator, connect, open
  Live (the Golf's speed varies), Trips → **Record** for about 3 min (one 2 km lap at ~40 km/h;
  60 s draws only the first straight and a corner) → **Stop** → **Open**. See
  [trip-recording](./features/trip-recording.md#trip-detail-plan-17).

## Scenarios

Built from the vehicle registry + overrides:

- `generic` — CAN, broad PID set, sample VIN, no injected DTCs.
- `golf-plus-2009-20tdi` — CAN 11/500, 16 PIDs, real VIN `WVWZZZ1KZ9W903398`,
  optional DTCs, one experimental Mode 22 DID.
- `fiat-punto-2008-12` — CAN 11/500, 13 PIDs, VIN. **Multi-ECU**: a second ECU answers functional
  `0100` and Mode 03/07 on its own line (regression coverage for the multi-ECU parser).
- `passat-b55-19tdi` — KWP2000 fast, 9 PIDs, real VIN `WVWZZZ3BZ4E342958` in scenario data,
  **no MAF/oil/fuel-rate**, slower timing, Mode 09 VIN often absent.

Tests and the in-app Settings picker select a scenario. The picker also lists the user's **garage
cars** (plan 06): `simulatorSourceFor(id, garage)` (`src/shared/vehicles/resolve.ts`) simulates a
garage car from its base profile with `buildScenario(base, { vin, supportedPids, calibrationId })`
taken from its learned identity, so a car learned from the simulated Golf reconnects with the same
VIN and PID set (and is recognised by the VIN auto-select). `resolve.test.ts` and
`learnVehicle.test.ts` cover it. Latency is configurable (≈0 ms in tests for
speed; non-zero to emulate K-line in the UI).

## Quirks toggles

- `latencyMs` — per-response delay (K-line > CAN).
- `emitSearching` — prefix the first OBD reply with `SEARCHING...`.
- `vinSupported` — whether `0902` answers.
- `secondaryEcus` — extra ECUs that answer functional `0100`/Mode 03/07 on their own line (multi-ECU).
- `whitespaceInResponses` — emulate adapters that ignore `ATS0` (the client must still parse).
- `sleepAfterIdleMs` — adapter auto-sleep (ELM327 low-power mode). After this idle gap (ms since
  the last write in or reply out) the next non-empty command is **swallowed** — its byte only wakes
  the chip — while a bare `\r` is answered with `\r>`. While the option is set, a bare `\r` to an
  awake adapter also gets `\r>` (a real ELM327 would repeat its last command; the client only sends
  a bare CR when that is harmless). Unset ⇒ the simulator never sleeps and ignores a bare `\r`, as
  before. `connectionService` then sets the client's `wakeAfterIdleMs` to half the gap.

## Test / dev controls

- `simulateDisconnect()` — an unsolicited link drop (adapter pulled, out of range); drives the
  link-loss path, auto-reconnect and the flap guard. Settings → Developer → **Simulate a link drop**.
- `dropResponses(n, { includeAt? })` — the next `n` non-AT commands get **no reply at all** (not
  even a prompt), so the client times out; drives the timeout, drain-until-prompt and diagnostics
  paths. With `includeAt: true` AT commands count too — Settings → Developer → **Fail next connect:
  no reply to ATZ** arms exactly that (`dropResponses(1, { includeAt: true })`) for the next
  simulator connect. A bare `\r` is never dropped; calling it again replaces the budget.
- For a **late** reply (rather than none), set `latencyMs` above the client's timeout.

## Replay fixtures

A **replay fixture** is a recorded adapter session: every command the app sent, paired with the
reply it got. `ReplayTransport` (`transport/logReplay.ts`) serves those replies back, so a real-car
session (or a simulator recording) runs through the real `DiagnosticSession` in CI with no hardware.

### Format (`ReplayFixture`)

| Field       | Meaning                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pairs`     | command (upper case, no spaces) → the **first** reply to it. Prompt stripped; a multi-line reply keeps its lines joined with `\r` (the ELM327's own separator), so several ECUs' lines and ISO-TP segment lines replay exactly.                                                                                                                                                                |
| `sequences` | command → **every** reply, in order — only for commands whose reply changed during the session (a clear flow: `03` → codes, `04` → `44`, `03` → none; the Passat's first `0100` carries `SEARCHING...`). Commands that always got the same reply are omitted.                                                                                                                                  |
| `meta`      | `source` (`simulator` \| `car`), `vehicleId` (registry id; a garage car exports its base profile's id), `flow` (`connect`, `live`, `faults`, `clear`, `inspection`, `battery`, `extended`, `module-scan`, `sniffer` or custom), `adapter` (ATI), `protocol`, `appVersion`, `droppedEntries` (only when the Settings log wrapped before the export: the file then starts mid-session), `notes`. |
| `expect`    | What a replay must produce; each field is asserted only when present: `protocol`, `vin` (string or `null`), `supportedPidCount`, `storedDtcs`, `pendingDtcs`, `milOn`, `freezeFrameCount`, `storedDtcsAfterClear` (clear flows: the **last** recorded `03` answer, however many `03` reads came before the `04`).                                                                              |

`ReplayTransport.write` answers from a command's `sequences` entry first (one reply per send,
repeating the last one when exhausted), then from `pairs`, then `OK` (AT) / `NO DATA` (OBD).
`fixtureFromLog(entries, name?, { meta?, keepSequences? })` builds a fixture from `LoggedIo[]`
(`keepSequences` defaults to `true`). The rx chunks of one command are concatenated as sent (a BLE
notification can split a line anywhere), then split into lines; a bare-CR wake-up and a command
that got no reply are skipped.

### Where fixtures come from

- **The car:** Settings → Adapter log → **Clear**, run one flow, type its **Flow name**, **Export as
  replay fixture** ([settings](./features/settings.md)). The log keeps the last 300 lines
  (`ADAPTER_LOG_CAPACITY`); when it wraps, Settings says so and the export records
  `meta.droppedEntries`. The adapter log and `RecordingTransport`
  share one normalisation (`logTxText` / `logRxText`): rx chunks keep their line breaks, and a KWP
  login (`2B` + code) is logged as `2B <login code redacted>` (`transport/redact.ts`), so a
  fixture never carries a login code.
- **The simulator:** `RecordingTransport` (`transport/recordingTransport.ts`) wraps any transport
  and records tx/rx as `LoggedIo`; `recordSession(inner, run, meta, options?)` runs a scripted
  session over it (the callback calls `connect()` itself), disconnects (also on error) and returns `fixtureFromLog(log, meta.flow, { meta })`.
  `npm run fixtures:sim` (`scripts/record-sim-fixtures.ts`, run by `scripts/run-ts.cjs`, a
  20-line runner on the `typescript` devDependency) records `connect`, `faults` and `clear` for
  every registry profile (`transport/simFixtures.ts`) with `meta.source: 'simulator'`. The DTC
  flows seed the profile's known stored faults, or `P0113` + `P0562` when it has none. `expect`
  is derived from the **scenario**, not from the recording, so the replay test is an independent
  check. Files carry no timestamp or app version, so they change only when a profile or the
  simulator does.

### Where they live and what checks them

- `src/shared/obd-core/transport/fixtures/<vehicleId>/<flow>.json` (car) and
  `…/<vehicleId>/sim-<flow>.json` (simulator; the `sim-` prefix is reserved for
  `source: 'simulator'`). The tests read the directory, so a new file needs no registration.
- `fixtures.replay.test.ts` replays every file through `DiagnosticSession` (500 ms timeouts) via
  `checkReplayFixture` (`transport/fixtureCheck.ts`, which returns one message per mismatch) and
  asserts its `expect`. A fixture with a `0100` reply is replayed from `connect()`. One without it
  (recorded on an already-connected session, or cut by a wrapped log) is replayed with no connect
  handshake: only the non-connect expectations are checked, and a `protocol`, `vin` or
  `supportedPidCount` expectation on it is reported as a failure, since nothing in the file can
  confirm it. For `storedDtcsAfterClear` the checker sends `04`, moves the `03` cursor to the last
  recorded reply (`ReplayTransport.skipToLast`) and reads it. A car fixture must also be listed in its vehicle doc's "Validated on the
  car" table ([vehicles/README.md](./vehicles/README.md#validated-on-the-car)).
- `sim-fixtures.freshness.test.ts` re-records the simulator and fails when a committed
  `sim-*.json` differs, is missing or is stale. After changing a profile, a scenario or the
  simulator, run `npm run fixtures:sim` and commit the result.
- **Simulator fixtures are never validation.** They prove the pipeline (record → export → replay →
  assert) works before a single car session; only `source: 'car'` files fill a vehicle's
  "Validated on" table.

## Contract

The simulator's **outputs are bytes ending in the `>` prompt**, exactly like a real ELM327, so the
`Elm327Client` is unaware it is talking to a mock. This is what makes the tests meaningful.
