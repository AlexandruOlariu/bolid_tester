# Plan 02 — Log → fixture pipeline now, on-car validation later

**Size:** M code (1 day, no car needed) + deferred owner sessions · **Depends on:** plan 01 ·
**Roadmap:** v0.2 "On-car validation log", "Log → fixture pipeline"

## Goal

**Part A (implement now, no car):** the app can turn any adapter session into a **replay fixture**
that expresses command sequences and expectations; committed fixtures run in CI against the real
`DiagnosticSession`; the simulator itself is recorded into fixtures for every registry profile so
the whole pipeline is exercised before a single car session; vehicle docs have a machine-checked
"Validated on" section ready to be filled.

**Part B (deferred, owner):** drive the Golf, Punto and Passat with the script below, export one
fixture per flow, and let the implementing agent commit them, fill the tables and fix what breaks.

## Why

No vehicle doc records an observed protocol, PID bitmap or DTC read. The export path
(`Settings → Export as replay fixture`) exists but fixtures are not committed, not asserted, and
cannot express sequences (a clear-codes flow answers differently before and after `04`). Everything
except the driving can be built and tested today.

## Read first

- `src/shared/obd-core/transport/logReplay.ts` (`LoggedIo`, `ReplayFixture`, `fixtureFromLog`,
  `ReplayTransport`) and `logReplay.test.ts`.
- `src/shared/obd-core/transport/{Transport.ts, MockTransport.ts, scenarios.ts}` (`buildScenario`,
  `SimScenario`).
- `src/features/settings/hooks/useLogFixtureExport.ts`, the "Adapter log" block in
  `SettingsScreen.tsx`, `src/shared/state/adapterLog.ts` (ring buffer size and shape).
- `src/shared/obd-core/session/DiagnosticSession.ts` (`connect()` → `SessionInfo`, `readDtcs`,
  `readReadiness`, `readFreezeFrames`, `readIupr`, `readExtended`) and `DiagnosticSession.test.ts`.
- `src/shared/vehicles/vehicle-docs-sync.test.ts`, `docs/testing.md`, `docs/vehicles/README.md`,
  `docs/vehicles/golf-plus-2009-20tdi.md`.

## Design (Part A)

### Fixture format (extend `ReplayFixture`)

```ts
export interface ReplayFixture {
  name?: string;
  createdAt?: number;
  /** First response per command (existing behaviour, unchanged). */
  pairs: Record<string, string>;
  /** Every response per command in order; ReplayTransport consumes these first and repeats the last
   *  one when exhausted. Lets a clear flow replay 03 → codes, 04 → OK, 03 → none. */
  sequences?: Record<string, string[]>;
  meta?: {
    source: 'simulator' | 'car'; // simulator fixtures never count as validation
    vehicleId: string; // registry id or 'user:<id>' (plan 06)
    flow: string; // 'connect' | 'live' | 'faults' | 'clear' | 'inspection' | 'battery' | 'extended' | 'module-scan' | 'sniffer' | custom
    adapter?: string; // ATI string, e.g. 'ELM327 v2.2'
    protocol?: string; // ProtocolId observed
    appVersion?: string;
    notes?: string;
  };
  expect?: {
    protocol?: string;
    vin?: string | null;
    supportedPidCount?: number;
    storedDtcs?: string[];
    pendingDtcs?: string[];
    milOn?: boolean;
  };
}
```

- `fixtureFromLog(entries, name?, opts?: { meta?: ReplayFixture['meta']; keepSequences?: boolean })`
  fills `sequences` when `keepSequences` (default `true` from the Settings export; the existing
  "first wins" unit test keeps passing because `pairs` is unchanged).
- `ReplayTransport.write`: per-command cursor (`Map<string, number>`) over `sequences`, repeating
  the last entry when exhausted; then `pairs`; then the `OK` / `NO DATA` defaults.

### `RecordingTransport` — record any transport into `LoggedIo[]`

New `src/shared/obd-core/transport/recordingTransport.ts`:

```ts
/** Wraps a Transport and records tx/rx as LoggedIo (same normalisation as the app's withLog). Pure core, no React. */
export class RecordingTransport implements Transport {
  constructor(private inner: Transport) {}
  readonly log: LoggedIo[] = [];
  // connect/disconnect/onData/onStatusChange delegate; write() pushes {dir:'tx'} then forwards; onData pushes {dir:'rx'} per chunk
}
export function recordSession(
  inner: Transport,
  run: (session: DiagnosticSession) => Promise<void>,
  meta: ReplayFixture['meta'],
): Promise<ReplayFixture>;
```

`recordSession` connects, runs the callback (e.g. `connect → readDtcs('03') → readReadiness`),
disconnects, and returns `fixtureFromLog(log, meta.flow, { meta })`.

### Committed fixtures and the fixtures test

- Directory: `src/shared/obd-core/transport/fixtures/<vehicleId>/<flow>.json`. The test reads the
  directory with `fs`, so new files need no registration.
- New `scripts/record-sim-fixtures.ts` (run with `npx ts-node` or a tiny `tsx` dev dep — pick one and
  add an npm script `fixtures:sim`): for each registry profile builds `MockTransport(buildScenario(id))`
  and records `connect`, `faults` (with `storedDtcs` seeded from `knownFaults`), `clear` (03 → 04 → 03) into `fixtures/<id>/sim-<flow>.json` with `meta.source: 'simulator'` and `expect` filled from
  the scenario. Commit the generated files. Re-run when a profile or the simulator changes; a test
  asserts the committed files equal a fresh recording (`sim-fixtures.freshness.test.ts`), so drift
  is caught.
- New `src/shared/obd-core/transport/fixtures.replay.test.ts`: for every `*.json` under `fixtures/`,
  build `ReplayTransport`, run `new DiagnosticSession(t, { commandTimeoutMs: 500,
firstCommandTimeoutMs: 500 }).connect()`, assert each present `expect` field (`info.protocol`,
  `info.vin`, `info.supportedPids.length`; `readDtcs('03'|'07')` sets; `readReadiness().milOn`).
  Car fixtures (`meta.source === 'car'`) additionally assert the vehicle doc has a matching
  "Validated on" row (see below).

### Export UX (Settings)

- `useLogFixtureExport.exportFixture(log, name, meta)` — `SettingsScreen` passes
  `{ source: 'car', vehicleId: selectedProfileId, flow, adapter: info?.version, protocol:
info?.protocol, appVersion: Constants.expoConfig?.version ?? '0.1.0' }` (`expo-constants` is a
  transitive dependency of Expo; import it directly). A "Flow name" `Input` next to the export
  button (default `session`); file name `bolid-replay-<vehicleId>-<flow>-<stamp>.json`. Success
  copy reminds: "Clear the log before recording the next flow."

### Vehicle doc "Validated on" section (template now, rows later)

Front-matter gains optional `validatedOn: YYYY-MM-DD` and `observedProtocol: <ProtocolId>`; body
gains:

```markdown
## Validated on the car

| Date                | App build | Adapter | Flow | Result | Fixture |
| ------------------- | --------- | ------- | ---- | ------ | ------- |
| _not yet validated_ |           |         |      |        |         |
```

`vehicle-docs-sync.test.ts`: when `observedProtocol` is present it must equal `p.expectedProtocol`
(the profile is corrected to the observation, doc first); every car fixture under
`fixtures/<id>/` must be referenced from that doc's table (parse the table's last column).

## Steps (Part A — all now)

1. `logReplay.ts`: `sequences`, `meta`, `expect`, options, cursor replay; extend `logReplay.test.ts`.
2. `recordingTransport.ts` + `recordingTransport.test.ts` (records a MockTransport connect; the
   produced fixture replays to the same `SessionInfo`).
3. `scripts/record-sim-fixtures.ts`, npm script, generated `fixtures/*/sim-*.json`,
   `sim-fixtures.freshness.test.ts`, `fixtures.replay.test.ts`.
4. Settings export meta + flow name + file name.
5. `vehicle-docs-sync.test.ts` rules; add the empty "Validated on" table + front-matter fields to the
   three vehicle docs.
6. Docs: `docs/testing.md` ("Recording results" → the Part B script + post-session procedure),
   `docs/simulator.md` ("Replay fixtures": format, recorder, where files live, freshness test),
   `docs/vehicles/README.md` (front-matter fields, table template, "simulator fixtures are not
   validation").
7. `npm run format`, `npm run ci`.

## Tests

- `logReplay.test.ts`: sequences consumed in order then repeat-last; `pairs` still first-wins;
  `meta`/`expect` JSON round-trip.
- `recordingTransport.test.ts`: tx/rx captured in order; fixture replays to identical `SessionInfo`.
- `fixtures.replay.test.ts`: every committed fixture satisfies its `expect`; a deliberately wrong
  expectation fails (prove once, then revert).
- `sim-fixtures.freshness.test.ts`: committed simulator fixtures equal a fresh recording.
- `vehicle-docs-sync.test.ts`: `observedProtocol` rule; car-fixture ↔ table-row rule.

## Acceptance (Part A)

- [ ] `npm run fixtures:sim` regenerates `fixtures/<id>/sim-{connect,faults,clear}.json` for the three
      profiles; the freshness test is green; editing a scenario value turns it red until regenerated.
- [ ] Settings export produces JSON with `pairs`, `sequences`, `meta.source: 'car'`, `meta.flow`; the
      file name carries vehicle + flow.
- [ ] Vehicle docs carry the empty "Validated on" table and pass the sync test.
- [ ] `npm run ci` green.

## Deferred until an on-car session (Part B — owner, then agent)

### Session script (Golf first, then Punto, then Passat)

Prepare: phone charged, build from `main` after plan 01, Settings → **Real adapter**, adapter
plugged in. Before each flow: Settings → Adapter log → **Clear**. After each flow: **Export as replay
fixture** with the flow name below; send the files to the repo (any channel).

| #   | Flow name                                        | Steps on the car                                                                              | Record                                                                                               |
| --- | ------------------------------------------------ | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 1   | `connect`                                        | Ignition ON, engine OFF. Connect → Scan → pick the Vgate → wait for Connected. Open **Info**. | Protocol, VIN, adapter version, supported-PID count, voltage; seconds from tap to Connected.         |
| 2   | `live`                                           | Start engine. **Live** 2 minutes at idle, a few throttle blips.                               | Which gauges/cards show values; update feel; any `—`.                                                |
| 3   | `faults`                                         | **Faults** → pull to refresh. Open each code's Guide.                                         | Codes vs the known list (`P2183`, `P2015`, `P0121` on the Golf), readiness, MIL, freeze-frame count. |
| 4   | `inspection`                                     | More → **Used-car inspection** → run.                                                         | Verdict; IUPR present or not.                                                                        |
| 5   | `battery`                                        | Engine OFF: More → **Battery & charging** → capture 20 s; second capture while starting.      | Resting V, cranking dip, charging V, verdict.                                                        |
| 6   | `extended`                                       | Info → **Extended PIDs** → read every DID once.                                               | Per DID: value / `NO DATA` / negative response. Decides which illustrative DIDs survive.             |
| 7   | `module-scan`                                    | More → **Module scan** (engine ON, parked).                                                   | Which modules answer; on the Golf only the engine pair is expected.                                  |
| 8   | `sniffer`                                        | More → **Bus sniffer** → 10 s at idle → Stop → Share CSV (plan 03).                           | Frame count, dominant IDs.                                                                           |
| 9   | `clear` (only if a harmless pending code exists) | Faults → Clear → re-read.                                                                     | Before/after sets.                                                                                   |

Passat: expect `BUS INIT` / `SEARCHING…`; flows 6–8 not applicable; note time-to-connect. Punto:
two ECUs answer `0100`; confirm no phantom DTCs.

### Post-session procedure (agent)

1. Copy each exported JSON to `fixtures/<vehicleId>/<flow>.json`; set `expect` from what the car
   actually answered (read the `pairs`); keep `meta.source: 'car'`.
2. Run `npm test -- fixtures.replay`; every failure is either a wrong expectation (fix the fixture)
   or an app bug (fix the code + add a regression test that uses the fixture).
3. Fill the "Validated on" rows; set `validatedOn` and `observedProtocol`; if the observed PID
   bitmap differs from `supportedPids`, change the doc's `supportedPidCount` first, then the profile.
4. Flow 6 decides each extended DID: confirmed → keep and mark (plan 25 `confirmed` field);
   `NO DATA`/negative → remove from the profile and note it in the doc.
5. `implementation-log.md` entry; roadmap item "On-car validation log" → ✅ per car.

### Acceptance (Part B)

- [ ] Golf: `connect`, `live`, `faults` car fixtures committed and green; table filled.
- [ ] Punto and Passat: at least `connect` and `faults`.
- [ ] Every bug found on the car has a fixture-backed regression test.

## Out of scope

Sniffer capture export (plan 03); turning captures into confirmed Tier C data (plan 25).
