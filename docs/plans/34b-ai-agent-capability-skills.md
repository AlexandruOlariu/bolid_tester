# Plan 34b — AI diagnostic agent: every capability skill (phase 1, read-only) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the agent every capability skill in the spec's table — the 18 not shipped in 34a — each owned by its feature, contributed through the route, with a digest, an availability check and, where useful, a procedure the no-AI mode can run.

**Architecture:** Each owning feature gets `src/features/<slug>/agent/agentTools.ts` (an `AgentContribution`) plus one `<skill>.skill.json` per skill, exported from the feature's `index.ts` as `<camelSlug>AgentTools` and appended to `AGENT_CONTRIBUTIONS` in `src/app/ai-diagnose.tsx`. Where a feature's read logic lives inside a React hook, it is first extracted into a plain function in the feature's `api/` that both the hook and the tool call (behaviour of the screen unchanged). Tools only ever see the `ReadOnlySession` from plan 34a; module and channel reads go through `withModule`.

**Tech Stack:** TypeScript, zustand stores of the owning features, obd-core analysis modules, Jest `core` project against `MockTransport` scenarios.

**Spec:** [`docs/superpowers/specs/2026-11-22-ai-agent-diagnose-design.md`](../superpowers/specs/2026-11-22-ai-agent-diagnose-design.md) — section "Skill catalog: every feature of the app".

**Depends on:** [34a](./34a-ai-agent-core.md) (types, registry, facade, loop, route list).

## Global Constraints

- **Read-only agent in this phase.** Tools receive only `ToolContext.session: ReadOnlySession`; no tool imports `useSessionStore` to reach `DiagnosticSession`; no tool calls a write service (`writeChannel`, `clearModule`, coding writes, service reset, routines); **Clear codes** stays the existing confirmed button.
- Never immobilizer / airbag / cluster-mileage: `scan_modules` skips VAG `15` and `25` (the facade refuses them); no tool reads a mileage DID.
- Never ship seed/key algorithms; no tool performs a KWP login or SecurityAccess.
- Metric only; every user-facing string en + ro in the same task (tool labels `<ns>:agent.tool.<name>`, findings `<ns>:agent.finding.<id>.{title,detail}` in the owning feature's namespace). Skill documents and digests are model-facing English.
- Values from profile items whose `verificationState(item) === 'unverified'` are labelled `unconfirmed` in the digest and set `ToolResult.unconfirmed` / `SkillFinding.unconfirmed` (34a caps them at `info`).
- Digests through `clampDigest` (≤ 1600 chars), numeric and unit-labelled; a tool on an empty store says so in one line ("No trips recorded for this car.") instead of failing.
- Data belonging to a car is filtered to the **active car** (`getActiveProfile().id`, garage-aware), never mixed across cars.
- Features import only `@/shared/*` (history keeps its sanctioned composition reads); no new feature → feature import; composition only in `src/app/ai-diagnose.tsx`.
- `npm run ci` green at the end of every task; `act()` warnings fixed in tests only. Never touch `.agents/`, `.codex/`, `AGENTS.md`; never commit keystores, `.env`, `android/`. Commit messages end with the executing session's attribution lines.

## Review Focus

- **A store that is empty or not hydrated yet** (no trips, no maintenance entries, no history, no saved scan) → a one-line "none recorded" digest, never a throw. (Test in each store-backed task.)
- **The selected car changed between runs (garage)** → trips, maintenance and history tools report only the active car. (Task 6 and Task 7 tests.)
- **Module scan on a K-line car (Passat) or a car whose modules are TP2.0 only** → `scan_modules` is not offered; TP2.0 results come only from the last saved scan, labelled with its date. (Task 1 test.)
- **Many modules / codes / errors** → the digest is clamped and ends with "… (N more)", the model still sees the counts. (Task 1 test.)
- **An unconfirmed DPF / extended / adaptation value that looks alarming** → digest says `unconfirmed`, the finding is flagged so 34a caps it at `info`. (Task 3 test.)

## The catalog (what each task builds)

| Skill (`*.skill.json`) | Owner feature     | Tool(s)                                                                          | Reads (existing code)                                                                                                                                                                      | Available when                                                                 | `costMs`                   | Procedure        |
| ---------------------- | ----------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | -------------------------- | ---------------- |
| `module_scan`          | module-scan       | `scan_modules {addresses?: string[≤12] ^[0-9A-F]{2}$}`, **triage** `{}`          | `readModuleIdent`, `readModuleDtcs(send, 0xff)` inside `withModule` per UDS module; TP2.0 rows from the latest `useScanHistoryStore` scan of this car                                      | CAN and ≥ 1 UDS module with `reqHeader`                                        | 3000 × modules, max 30 000 | `module_scan`    |
| `record_live`          | live-charts       | `record_live {pids: ≤4, seconds: 3..15}`                                         | `session.pollOnce` every 500 ms                                                                                                                                                            | always                                                                         | 1000 + 1000 × s            | —                |
| `sensor_tests`         | sensor-tests      | `read_mode06 {}`; `wiggle_test {pid, seconds?: 5..15 = 10}`                      | `readMode06(t.mid)` over `profile.mode06Tests`, `readMode05` sweep `01 02 05 06` on petrol K-line (as `useSensorTests`); wiggle samples every 250 ms while `askDriver('wiggle_connector')` | Mode 06 tests declared, or petrol K-line; wiggle always                        | 4000; 1000 + 1000 × s      | —                |
| `extended_data`        | extended-pids     | `read_extended {dids?: ≤8 ^[0-9A-F]{4}$}`                                        | `pollExtendedOnce` + each `ExtendedPid.decode`; default = first 8 declared                                                                                                                 | `profile.extendedPids` non-empty and CAN (same gate as `useExtendedPids`)      | 500 × dids                 | —                |
| `dpf`                  | dpf               | `read_dpf {}`                                                                    | new `readDpf` extracted from `useDpf` → `assessDpf`                                                                                                                                        | diesel, CAN, ≥ 1 `dpf`/`diesel` category DID                                   | 4000                       | `dpf`            |
| `adaptations_read`     | adaptations       | `read_adaptations {channel?: string}`                                            | new `readChannelReadOnly(ro, ch)` (KWP: `enterSession` + `kwpReadLocal`; UDS: `22 <did>`), `decodeAdaptationRaw`                                                                           | `profile.adaptations` non-empty; each channel only on its transport's protocol | 1500 × channels (max 10)   | —                |
| `coding_read`          | coding            | `read_coding {module?: string}`                                                  | `22 <codingDid>` in `withModule`, decoded with the same label-pack view `useCoding` builds (`buildCodingView` / `decodeSchema`)                                                            | CAN and `profile.codingModules` non-empty                                      | 2000 × modules             | —                |
| `used_car_check`       | inspection        | `read_inspection {}`                                                             | new `runInspection` extracted from `useInspection` → `assessInspection`                                                                                                                    | always                                                                         | 6000                       | `used_car_check` |
| `vehicle_identity`     | vehicle-info      | `read_identity {}`                                                               | `ctx.vin ?? readVin()`, `decodeVin`, `readCalibrationId`, `readPartNumber` (CAN), `PROTOCOL_LABELS`                                                                                        | always                                                                         | 3000                       | —                |
| `adapter_health`       | adapter-health    | `check_adapter {}`                                                               | `runHealthCheck(client, { burst: 5 })`, client = `{ version: ro.adapterVersion, voltage: ro.voltage, protocolNumber: ro.protocolNumber, command: ro.request }`                             | always                                                                         | 5000                       | `adapter_health` |
| `trips`                | trip-recording    | `list_trips {limit?: 1..5}`; `read_trip {id, pids?: ≤4}`                         | `useTripStore.trips` (active car via `tripCarKey`), `loadTripSamples(header)`                                                                                                              | always                                                                         | 0                          | —                |
| `fuel_economy`         | trip-recording    | `read_fuel_economy {}`                                                           | `pollOnce(FUEL_ECONOMY_PIDS ∩ supported)` → `fuelEconomyFromValues(values, profile.fuel)`; last 5 trips' `stats.fuel`                                                                      | `0110` or `015E` supported, or a trip with fuel stats                          | 1500                       | —                |
| `performance_history`  | performance-tests | `read_performance_history {}`                                                    | `usePerformanceStore.history` (in memory: this app session only)                                                                                                                           | always                                                                         | 0                          | —                |
| `maintenance`          | maintenance       | `read_maintenance {}`                                                            | the active car's bucket (`maintenanceKeysFor`, `bucketFor`) → `computeDue` as `useMaintenance` does                                                                                        | always                                                                         | 0                          | `maintenance`    |
| `history`              | history           | `read_history {limit?: 1..10}`, **triage** `{limit: 5}`; `history_compare {pid}` | `historyStore` + `timelineSources` for the active car; trips' `stats.max[pid]` + one live read                                                                                             | always                                                                         | 0; 1000                    | —                |
| `alerts_history`       | alerts            | `read_alerts {}`                                                                 | `useAlertsStore` `rules` (with `ruleLabel`) and `active`                                                                                                                                   | always                                                                         | 0                          | —                |
| `app_errors`           | error-log         | `read_app_errors {limit?: 1..10}`                                                | `useErrorLogStore.errors`, messages through `scrubText`                                                                                                                                    | always                                                                         | 0                          | —                |
| `bus_listen`           | can-sniffer       | `listen_bus {seconds?: 2..10 = 10}`                                              | new facade `listenBus(ms)` (`startSniffer` / `stopSniffer` in `finally`), ids via `parseRawCanLine`                                                                                        | CAN and `canMonitor`                                                           | 1000 + 1000 × s            | —                |
| (fine tool)            | fault-codes       | `lookup_guide {code?, topic?}`                                                   | `matchFaultGuide(guideProfileId, code, vagCodeForDtc(code))`; topic = case-insensitive search of this car's guide notes                                                                    | always                                                                         | 0                          | —                |

Fine tools from the spec map as: `read_dtcs_detail` (34a), `read_mode06` / `wiggle_test` → sensor-tests, `scan_modules` → module-scan, `read_extended` → extended-pids, `lookup_guide` → fault-codes, `history_compare` → history, `ask_driver` (34a core). With 34a's `fault_codes`, `live_data`, `battery`, this makes all **21** capability skills.

A "procedure" here is a `SkillProcedure` with the skill's name whose `run` calls the skill's zero-argument tool through `ctx.callTool`, so `run_skill` works and the no-AI mode of plan 34c can run it.

## Read first

Plan 34a (Interfaces blocks of Tasks 2–5, 9), `src/features/<slug>/{api,hooks,model}` of each owner above, `src/shared/obd-core/uds/udsModule.ts`, `src/shared/obd-core/coding/*`, `src/shared/vehicles/{types,confirmation}.ts`, `src/features/history/api/timelineSources.ts`, `src/shared/lib/scrub.ts`, `src/shared/obd-core/tp20/elmRawCan.ts`.

---

### Task 1: `module_scan` — every UDS module's identity and codes

**Files:**

- Create: `src/features/module-scan/agent/agentTools.ts`, `src/features/module-scan/agent/module_scan.skill.json`
- Modify: `src/features/module-scan/index.ts` (`export { agentTools as moduleScanAgentTools }`), `src/app/ai-diagnose.tsx`, `src/shared/i18n/locales/{en,ro}/moduleScan.json`, `docs/features/module-scan.md`
- Test: `src/features/module-scan/agent/agentTools.test.ts` (core)

**Interfaces:**

- Consumes: `ReadOnlySession.withModule`, `ModuleNotAllowedError`, `AGENT_EXCLUDED_MODULE_ADDRESSES`, `clampDigest`, `verificationState`, `isModuleUnreachableError`, `useScanHistoryStore`.
- Produces: `agentTools: AgentContribution` with tool `scan_modules` (label `moduleScan:agent.tool.scan_modules`, `triage: { args: {} }`), procedure `module_scan`, skill `module_scan`. Digest line per module: `"<addr> <name>: part <F187> sw <F189>; <n> DTCs: <code> status 0x<ss>, …"`; silent module → `"<addr> <name>: no answer"`; excluded → `"<addr> <name>: skipped (outside the agent's scope)"`; TP2.0 → `"TP2.0 modules (saved scan <yyyy-mm-dd>): …"` or `"TP2.0 modules: not read by the agent; open Module scan to read them."`; `unconfirmed` appended for unverified modules. One finding per module with codes: `{ key: 'moduleScan:agent.finding.moduleDtcs', severity: 'warn', values: { module, count }, codes, unconfirmed }`.

- [ ] **Step 1: Write the failing tests** (Golf scenario, which seeds `7E0`, `760`, `714` idents and sample DTCs)

```ts
it('scans the Golf UDS modules and lists their codes', async () => {
  const r = await toolOf(agentTools, 'scan_modules').run({}, golfCtx);
  expect(r.digest).toMatch(/^01 Engine: part 03L906022LM/m);
  expect(r.findings?.every((f) => f.key === 'moduleScan:agent.finding.moduleDtcs')).toBe(true);
});
it('skips airbag and immobilizer and never addresses them', async () => {
  const r = await toolOf(agentTools, 'scan_modules').run({ addresses: ['15', '25'] }, golfCtx);
  expect(r.digest).toContain('15 ');
  expect(r.digest).toContain("skipped (outside the agent's scope)");
  expect(sentHeaders).not.toContain('ATSH715');
});
it('is not offered on the K-line Passat', () =>
  expect(toolOf(agentTools, 'scan_modules').available(availability('passat-b55-19tdi'))).toBe(
    false,
  ));
it('TP2.0 rows come only from a saved scan, with its date', async () => {
  expect((await toolOf(agentTools, 'scan_modules').run({}, golfCtx)).digest).toContain(
    'TP2.0 modules: not read by the agent',
  );
  useScanHistoryStore.setState({ scans: [savedScanWithTp20('2026-11-20')] });
  expect((await toolOf(agentTools, 'scan_modules').run({}, golfCtx)).digest).toContain(
    'TP2.0 modules (saved scan 2026-11-20)',
  );
});
it('clamps a long scan and says how many lines were cut', async () => {
  const r = await toolOf(agentTools, 'scan_modules').run({}, ctxWith20ModulesEach5Dtcs);
  expect(r.digest.length).toBeLessThanOrEqual(1600);
  expect(r.digest).toMatch(/… \(\d+ more\)$/);
});
```

- [ ] **Step 2: Run to verify failure** — `npx jest --selectProjects core src/features/module-scan/agent` → FAIL.
- [ ] **Step 3: Implement** the tool, the procedure and the skill file (instructions: read the triage line first, then `scan_modules` with addresses when the symptom points to one system; interpret: VAG status bits, "pending" vs "confirmed", silent ≠ faulty). Extend `clampDigest` usage with a trailing `… (N more)` count (add an optional `moreLabel` to `clampDigest` in `agent/digest.ts` if needed). Append `moduleScanAgentTools` to `AGENT_CONTRIBUTIONS`. One line in `docs/features/module-scan.md` ("AI agent: `scan_modules`, part of triage").
- [ ] **Step 4: Run, then `npm run ci`** → PASS / green.
- [ ] **Step 5: Commit** — `git commit -m "feat(module-scan): scan_modules agent tool and module_scan skill"`

---

### Task 2: `record_live` and `sensor_tests` (Mode 06 / 05 and the wiggle test)

**Files:**

- Create: `src/features/live-charts/agent/{agentTools.ts,record_live.skill.json}`, `src/features/sensor-tests/agent/{agentTools.ts,sensor_tests.skill.json}`
- Modify: `src/shared/obd-core/agent/types.ts` (`DriverInstructionId` + `'wiggle_connector'`), `src/shared/obd-core/agent/driver.ts`, `src/shared/obd-core/agent/digest.ts` (`trendOf`), both features' `index.ts`, `src/app/ai-diagnose.tsx`, locales `{en,ro}/{liveCharts,sensorTests,aiDiagnose}.json`, `docs/features/{live-charts,sensor-tests}.md`
- Test: `src/shared/obd-core/agent/digest.test.ts`, `src/features/sensor-tests/agent/agentTools.test.ts`, `src/features/live-charts/agent/agentTools.test.ts`

**Interfaces:**

- Produces:
  - `trendOf(values: number[]): 'rising' | 'falling' | 'steady'` — mean of the last third minus mean of the first third; `|Δ| < max(1, 0.05 × |mean of all|)` → steady.
  - `DRIVER_INSTRUCTIONS.wiggle_connector.en = "With the engine idling, gently flex the wiring and connector of the sensor the app is watching for 10 seconds."`
  - `record_live` digest: `statsLine(...) + ", trend <trend>"` per PID.
  - `read_mode06` digest per result: `"MID 01 TID 8E: 0.40 V (limits 0.10–0.90) pass"`; failing results → finding `{ key: 'sensorTests:agent.finding.monitorFail', severity: 'warn', values: { mid, tid } }`.
  - `wiggle_test` digest: min / max, `NO DATA` dropouts, largest step between samples; finding `sensorTests:agent.finding.wiggleDropout` (`warn`) when dropouts ≥ 1, `sensorTests:agent.finding.wiggleUnstable` (`info`) when the largest step ≥ 3 × the median step and ≥ 10 % of the mean.

- [ ] **Step 1: Write the failing tests**

```ts
it.each([
  [[1, 1, 1, 5, 5, 5], 'rising'],
  [[5, 5, 5, 1, 1, 1], 'falling'],
  [[100, 101, 100, 101, 100, 101], 'steady'],
])('trendOf(%j) = %s', (v, t) => expect(trendOf(v)).toBe(t));
it('read_mode06 lists the Golf monitor with its limits', async () =>
  expect((await toolOf(sensorTools, 'read_mode06').run({}, golfCtx)).digest).toMatch(
    /MID 01 TID 8E: .* \(limits .*\) (pass|fail)/,
  ));
it('wiggle_test asks the driver and reports dropouts', async () => {
  const ctx = golfCtx({ askDriver: jest.fn().mockResolvedValue({ kind: 'done' }), dropEvery: 7 });
  const r = await toolOf(sensorTools, 'wiggle_test').run({ pid: '010B', seconds: 5 }, ctx);
  expect(ctx.askDriver).toHaveBeenCalledWith('wiggle_connector');
  expect(r.findings?.[0].key).toBe('sensorTests:agent.finding.wiggleDropout');
});
it('record_live adds a trend', async () =>
  expect(
    (await toolOf(chartTools, 'record_live').run({ pids: ['0105'], seconds: 3 }, golfCtx)).digest,
  ).toMatch(/trend (rising|falling|steady)/));
```

- [ ] **Step 2: Run to verify failure** — `npx jest --selectProjects core src/shared/obd-core/agent/digest.test.ts src/features/sensor-tests/agent src/features/live-charts/agent` → FAIL.
- [ ] **Step 3: Implement** both contributions and skill files (the `sensor_tests` skill explains pass/fail vs limits and when to propose a wiggle test: intermittent codes, a reading that drops to 0). Add `aiDiagnose:agent.driver.wiggle_connector` en + ro. Append both to `AGENT_CONTRIBUTIONS`; one doc line each.
- [ ] **Step 4: Run, then `npm run ci`** → PASS / green.
- [ ] **Step 5: Commit** — `git commit -m "feat(agent): record_live and sensor_tests skills with a guided wiggle test"`

---

### Task 3: `extended_data` and `dpf` (profile DIDs, unconfirmed labelling)

**Files:**

- Create: `src/features/extended-pids/agent/{agentTools.ts,extended_data.skill.json}`, `src/features/dpf/api/dpfRead.ts`, `src/features/dpf/agent/{agentTools.ts,dpf.skill.json}`
- Modify: `src/features/dpf/hooks/useDpf.ts` (call `readDpf`), both `index.ts`, `src/app/ai-diagnose.tsx`, locales `{en,ro}/{extendedPids,dpf}.json`, `docs/features/{extended-pids,dpf}.md`
- Test: `src/features/dpf/api/dpfRead.test.ts`, `src/features/dpf/agent/agentTools.test.ts`, `src/features/extended-pids/agent/agentTools.test.ts`

**Interfaces:**

- Produces:
  - `readDpf(session: Pick<ReadOnlySession, 'readExtended' | 'currentProtocol'>, profile: VehicleProfile): Promise<{ values: DpfValue[]; report: DpfReport } | null>` — `null` when not diesel-CAN-with-DPF-DIDs; `useDpf.refresh` keeps its store updates and calls this (a `DiagnosticSession` satisfies the `Pick`).
  - `read_dpf` digest: soot %, soot g, ash g, km since regen, regen count, EGT °C, status, each value `unconfirmed` when its DID is unverified; finding `{ key: 'dpf:agent.finding.<status>', severity }` with `ok→ok, filling→info, regenerating→info, regen-due→warn, high→warn, unknown→info`, `unconfirmed` when any value it used is.
  - `read_extended` digest per DID: `"<did> <name>: <value> <unit>"` + ` (unconfirmed)`; `ToolResult.unconfirmed = true` when every read value is unverified.

- [ ] **Step 1: Write the failing tests**

```ts
it('readDpf on the Golf decodes the DPF DIDs and assesses them', async () => {
  const out = await readDpf(
    createReadOnlySession(golfSession),
    getVehicleProfile('golf-plus-2009-20tdi'),
  );
  expect(out?.report.status).toBeDefined();
  expect(out?.values.length).toBeGreaterThan(0);
});
it('readDpf is null on the petrol Punto', async () =>
  expect(
    await readDpf(createReadOnlySession(puntoSession), getVehicleProfile('fiat-punto-2008-12')),
  ).toBeNull());
it('read_dpf labels unverified values and flags the finding', async () => {
  const r = await toolOf(dpfTools, 'read_dpf').run({}, golfCtx);
  expect(r.digest).toContain('(unconfirmed)');
  expect(r.findings?.[0].unconfirmed).toBe(true);
});
it('read_extended reads the first 8 declared DIDs by default', async () => {
  const r = await toolOf(extTools, 'read_extended').run({}, golfCtx);
  expect(r.digest.split('\n').filter((l) => /^[0-9A-F]{4} /.test(l)).length).toBeLessThanOrEqual(8);
});
```

- [ ] **Step 2: Run to verify failure** — `npx jest --selectProjects core src/features/dpf src/features/extended-pids/agent` → FAIL.
- [ ] **Step 3: Implement**; the existing DPF screen test (if any) and behaviour stay unchanged. Skill `dpf` interpret: soot % bands as `assessDpf` uses them, "a regen needs 15–20 min above 60 km/h", unconfirmed data never justifies an urgent verdict. Append both contributions; doc lines.
- [ ] **Step 4: Run, then `npm run ci`** → PASS / green.
- [ ] **Step 5: Commit** — `git commit -m "feat(agent): extended_data and dpf skills; readDpf extracted from useDpf"`

---

### Task 4: `adaptations_read` and `coding_read` (read only)

**Files:**

- Modify: `src/features/adaptations/api/adaptationService.ts` (add `readChannelReadOnly`)
- Create: `src/features/adaptations/agent/{agentTools.ts,adaptations_read.skill.json}`, `src/features/coding/agent/{agentTools.ts,coding_read.skill.json}`, `src/features/coding/api/codingRead.ts`
- Modify: both `index.ts`, `src/app/ai-diagnose.tsx`, locales `{en,ro}/{adaptations,coding}.json`, `docs/features/{adaptations,coding}.md`
- Test: `src/features/adaptations/api/adaptationService.test.ts` (extend), `src/features/coding/api/codingRead.test.ts`

**Interfaces:**

- Produces:
  - `readChannelReadOnly(ro: ReadOnlySession, ch: AdaptationChannel): Promise<number[] | null>` — `withModule({ reqHeader: ch.reqHeader, rxFilter: <same rule as address()> }, send => KWP ? (enterSession(send, ch.session ?? DEFAULT_KWP_SESSION), kwpReadLocal(send, ch.did)) : <22 read of ch.did through send>)`.
  - `readCodingReadOnly(ro: ReadOnlySession, m: CodingModule, labels: <the label source useCoding uses>): Promise<{ hex: string; fields: { name: string; value: string }[] } | null>`.
  - `read_adaptations` digest per channel (max 10): `"<name> (<module>): <decoded> <unit> raw <hex>"` + ` (unconfirmed)`; `read_coding` digest: module, coding hex, up to 12 decoded fields.

- [ ] **Step 1: Write the failing tests**

```ts
// adaptationService.test.ts, Passat KWP scenario: the read path never sends a write or a login
it('readChannelReadOnly reads a KWP channel with a session change only', async () => {
  const { session, sent, mark } = await passatSession();
  mark();
  const raw = await readChannelReadOnly(createReadOnlySession(session), idle);
  expect(raw).not.toBeNull();
  expect(sent().filter((c) => /^(2B|3B|27|2E)/.test(c))).toEqual([]);
  expect(sent()).toContain('1085');
});
it('readCodingReadOnly decodes the Golf coding module', async () => {
  const out = await readCodingReadOnly(
    createReadOnlySession(golfSession),
    golf.codingModules![0],
    labels,
  );
  expect(out?.hex).toMatch(/^[0-9A-F ]+$/);
  expect(out?.fields.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run to verify failure** — `npx jest --selectProjects core src/features/adaptations src/features/coding/api/codingRead.test.ts` → FAIL.
- [ ] **Step 3: Implement**; `useCoding` may call `readCodingReadOnly` for its read but its write path is untouched. Skill documents say plainly: "This phase reads only; to change a value the owner uses the Adaptations / Coding screens." Append both contributions; doc lines.
- [ ] **Step 4: Run, then `npm run ci`** → PASS / green.
- [ ] **Step 5: Commit** — `git commit -m "feat(agent): read-only adaptation and coding skills"`

---

### Task 5: `used_car_check`, `vehicle_identity`, `adapter_health`

**Files:**

- Create: `src/features/inspection/api/runInspection.ts`, `src/features/inspection/agent/{agentTools.ts,used_car_check.skill.json}`, `src/features/vehicle-info/agent/{agentTools.ts,vehicle_identity.skill.json}`, `src/features/adapter-health/agent/{agentTools.ts,adapter_health.skill.json}`
- Modify: `src/features/inspection/hooks/useInspection.ts` (call `runInspection`), the three `index.ts`, `src/app/ai-diagnose.tsx`, locales `{en,ro}/{inspection,vehicleInfo,adapterHealth}.json`, the three feature docs
- Test: `src/features/inspection/api/runInspection.test.ts`, `src/features/vehicle-info/agent/agentTools.test.ts`, `src/features/adapter-health/agent/agentTools.test.ts`

**Interfaces:**

- Produces:
  - `runInspection(ro: Pick<ReadOnlySession, 'readReadiness' | 'readDtcs' | 'readFreezeFrame' | 'readValue' | 'readIupr' | 'readVin'>, knownVin: string | null): Promise<InspectionReport>`.
  - `read_inspection` digest: verdict, each check `status: label`; finding `{ key: 'inspection:agent.finding.<verdict>', severity: pass→ok, caution→info, fail→warn }`.
  - `read_identity` digest: VIN (as read), decoded make / year / plant, check digit valid yes/no, calibration id, ECU part number, protocol label.
  - `check_adapter` digest: grade, firmware, voltage, protocol, median and slowest latency ms, timeouts out of 5; finding `{ key: 'adapterHealth:agent.finding.<grade>', severity: good→ok, ok→info, poor→warn }`.

- [ ] **Step 1: Write the failing tests**

```ts
it('runInspection flags recently cleared codes on a fresh Golf', async () =>
  expect((await runInspection(createReadOnlySession(golfSession), null)).verdict).toMatch(
    /pass|caution|fail/,
  ));
it('read_identity decodes the Golf VIN', async () => {
  const r = await toolOf(infoTools, 'read_identity').run({}, golfCtx);
  expect(r.digest).toContain('WVWZZZ1KZ9W903398');
  expect(r.digest).toMatch(/check digit valid: (yes|no)/);
});
it('check_adapter grades the simulator and never sends a write', async () => {
  const r = await toolOf(adapterTools, 'check_adapter').run({}, golfCtx);
  expect(r.findings?.[0].key).toMatch(/^adapterHealth:agent\.finding\.(good|ok|poor)$/);
  expect(sent.filter((c) => c === '04')).toEqual([]);
});
```

- [ ] **Step 2: Run to verify failure** — `npx jest --selectProjects core src/features/inspection src/features/vehicle-info/agent src/features/adapter-health/agent` → FAIL.
- [ ] **Step 3: Implement** (procedures `used_car_check` and `adapter_health` call their tools); append contributions; doc lines.
- [ ] **Step 4: Run, then `npm run ci`** → PASS / green.
- [ ] **Step 5: Commit** — `git commit -m "feat(agent): used-car check, vehicle identity and adapter health skills"`

---

### Task 6: `trips`, `fuel_economy`, `performance_history`

**Files:**

- Create: `src/features/trip-recording/agent/{agentTools.ts,trips.skill.json,fuel_economy.skill.json}`, `src/features/performance-tests/agent/{agentTools.ts,performance_history.skill.json}`
- Modify: both `index.ts`, `src/app/ai-diagnose.tsx`, locales `{en,ro}/{tripRecording,performanceTests}.json`, the two feature docs
- Test: `src/features/trip-recording/agent/agentTools.test.ts`, `src/features/performance-tests/agent/agentTools.test.ts`

**Interfaces:**

- Produces:
  - `list_trips` digest per trip (newest first, active car only): `"<id> <yyyy-mm-dd hh:mm> <min> min, <km> km, max coolant <°C>, max rpm <rpm>, <L/100 km>"`.
  - `read_trip {id}` also accepts `id: 'latest_cold'` = this car's most recent trip whose first `0105` sample is ≤ 40 °C; it returns `data: { header: TripHeader; samples: TripSample[] }` (used by the cooling playbook in 34c).
  - `read_trip` digest: per requested PID (default `0105`, `010C`, `010B`, `010D` when logged) min / avg / max, and for coolant the minutes from the first sample ≤ 40 °C to 80 °C (`"warm-up 9 min"`, or `"started warm"`); `"Trip <id> not found for this car."` for a foreign or missing id. `loadTripSamples` failures become an error digest.
  - `read_fuel_economy` digest: instant L/100 km (or L/h at standstill) from live values, and the last 5 trips' averages for this car with their distance.
  - `read_performance_history` digest: 0–100 km/h times, drag and braking results with dates; first line `"Runs from this app session only (they are not saved)."`

- [ ] **Step 1: Write the failing tests** (in-memory file system from the core test setup; trips seeded through `useTripStore.setState` and CSV files)

```ts
it("lists only the active car's trips", async () => {
  seedTrips([
    { id: 'g1', vehicleId: 'golf-plus-2009-20tdi' },
    { id: 'p1', vehicleId: 'fiat-punto-2008-12' },
  ]);
  const d = (await toolOf(tripTools, 'list_trips').run({}, golfCtx)).digest;
  expect(d).toContain('g1');
  expect(d).not.toContain('p1');
});
it('says when there are no trips', async () =>
  expect((await toolOf(tripTools, 'list_trips').run({}, golfCtx)).digest).toBe(
    'No trips recorded for this car.',
  ));
it('read_trip measures the warm-up from a cold start', async () => {
  seedTripCsv('g1', coldStartCoolant([20, 35, 50, 65, 80, 85], 120_000));
  expect((await toolOf(tripTools, 'read_trip').run({ id: 'g1' }, golfCtx)).digest).toContain(
    'warm-up 8 min',
  );
});
it('read_trip latest_cold picks the newest cold-start trip and returns its samples', async () => {
  seedTripCsv('g0', coldStartCoolant([20, 50, 85], 60_000));
  seedTripCsv('g1', warmStartCoolant([85, 88]));
  const r = await toolOf(tripTools, 'read_trip').run({ id: 'latest_cold' }, golfCtx);
  expect((r.data as { header: { id: string } }).header.id).toBe('g0');
});
it("read_trip refuses another car's trip", async () =>
  expect((await toolOf(tripTools, 'read_trip').run({ id: 'p1' }, golfCtx)).digest).toBe(
    'Trip p1 not found for this car.',
  ));
it('performance history says it is session-only', async () =>
  expect((await toolOf(perfTools, 'read_performance_history').run({}, golfCtx)).digest).toMatch(
    /^Runs from this app session only/,
  ));
```

- [ ] **Step 2: Run to verify failure** — `npx jest --selectProjects core src/features/trip-recording/agent src/features/performance-tests/agent` → FAIL.
- [ ] **Step 3: Implement**; append contributions; doc lines.
- [ ] **Step 4: Run, then `npm run ci`** → PASS / green.
- [ ] **Step 5: Commit** — `git commit -m "feat(agent): trips, fuel economy and performance history skills"`

---

### Task 7: `maintenance`, `history`, `alerts_history`, `app_errors`

**Files:**

- Create: `src/features/maintenance/agent/{agentTools.ts,maintenance.skill.json}`, `src/features/history/agent/{agentTools.ts,history.skill.json}`, `src/features/alerts/agent/{agentTools.ts,alerts_history.skill.json}`, `src/features/error-log/agent/{agentTools.ts,app_errors.skill.json}`
- Modify: the four `index.ts`, `src/app/ai-diagnose.tsx`, locales `{en,ro}/{maintenance,history,alerts,errorLog}.json`, the four feature docs (`maintenance-log.md`, `history.md`, `alerts.md`, `error-log.md`)
- Test: `src/features/{maintenance,history,alerts,error-log}/agent/agentTools.test.ts`

**Interfaces:**

- Produces:
  - `read_maintenance` digest per service item: status (`ok` / `soon` / `overdue` / `unknown`), last done date and km, due in km / days; findings `maintenance:agent.finding.overdue` (`warn`, values `{ item }`) and `maintenance:agent.finding.soon` (`info`).
  - `read_history` (triage `{ limit: 5 }`) digest for the active car: last AI runs (date, overall, summary ≤ 120 chars), fault-code checks with their codes, `"Codes went away between <d1> and <d2> (cleared or fixed)"` when a check with codes is followed by one without, `"Recurring: P0401 (3 checks)"` for codes seen in ≥ 2 checks, number of saved module scans.
  - `history_compare {pid}` digest: this car's trips' max and average of `pid` (last 10, oldest → newest) and one live read now.
  - `read_alerts` digest: each rule `"<label>: <pid> <op> <value> (on|off)"`, the alerts active now, and the line `"Fired alerts are not stored; only the ones active right now are known."` (the alerts store keeps rules and the active set only — no history exists, none is added in this phase).
  - `read_app_errors` digest: newest first, `"<age> ago <source> <severity>: <message ≤120>"` with `scrubText` applied, then counts per source over the last 24 h.

- [ ] **Step 1: Write the failing tests**

```ts
it('maintenance reports an overdue item for the active car only', async () => {
  seedMaintenance('golf-plus-2009-20tdi', overdueOilChange);
  seedMaintenance('fiat-punto-2008-12', allOk);
  const r = await toolOf(maintTools, 'read_maintenance').run({}, golfCtx);
  expect(r.findings).toEqual(
    expect.arrayContaining([expect.objectContaining({ key: 'maintenance:agent.finding.overdue' })]),
  );
});
it('history spots recurring codes and a clear', async () => {
  seedDtcChecks('golf-plus-2009-20tdi', [['P0401'], ['P0401'], []]);
  const d = (await toolOf(historyTools, 'read_history').run({ limit: 5 }, golfCtx)).digest;
  expect(d).toContain('Recurring: P0401 (2 checks)');
  expect(d).toMatch(/Codes went away between/);
});
it('history is empty-safe', async () =>
  expect((await toolOf(historyTools, 'read_history').run({}, golfCtx)).digest).toBe(
    'No history for this car yet.',
  ));
it('alerts say fired alerts are not stored', async () =>
  expect((await toolOf(alertTools, 'read_alerts').run({}, golfCtx)).digest).toContain(
    'Fired alerts are not stored',
  ));
it('app errors are scrubbed', async () => {
  logError({
    source: 'ble',
    error: new Error('lost WVWZZZ1KZ9W903398 at http://192.168.0.10:35000'),
  });
  const d = (await toolOf(errTools, 'read_app_errors').run({}, golfCtx)).digest;
  expect(d).not.toContain('WVWZZZ1KZ9W903398');
  expect(d).not.toContain('192.168.0.10');
});
```

- [ ] **Step 2: Run to verify failure** — `npx jest --selectProjects core src/features/maintenance/agent src/features/history/agent src/features/alerts/agent src/features/error-log/agent` → FAIL.
- [ ] **Step 3: Implement** (procedure `maintenance` calls its tool); append contributions; doc lines.
- [ ] **Step 4: Run, then `npm run ci`** → PASS / green.
- [ ] **Step 5: Commit** — `git commit -m "feat(agent): maintenance, history, alerts and app-error skills"`

---

### Task 8: `bus_listen` and `lookup_guide`

**Files:**

- Modify: `src/shared/obd-core/agent/readOnlySession.ts` (add `listenBus`), `src/shared/obd-core/agent/readOnlySession.test.ts`
- Create: `src/features/can-sniffer/agent/{agentTools.ts,bus_listen.skill.json}`
- Modify: `src/features/fault-codes/agent/agentTools.ts` (add `lookup_guide`), `src/features/fault-codes/agent/fault_codes.skill.json` (`tools` + `lookup_guide`), `src/features/can-sniffer/index.ts`, `src/app/ai-diagnose.tsx`, locales `{en,ro}/{canSniffer,faultCodes}.json`, `docs/features/can-sniffer.md`, `docs/features/fault-codes.md`
- Test: `src/features/can-sniffer/agent/agentTools.test.ts`, `src/features/fault-codes/agent/agentTools.test.ts` (extend)

**Interfaces:**

- Produces:
  - `ReadOnlySession.listenBus(ms: number): Promise<string[]>` — `ms` clamped to 10 000; rejects `Error(MONITOR_UNAVAILABLE_MESSAGE)` when `!canMonitor`, `Error('Bus listening needs a CAN car.')` off CAN; `stopSniffer()` in `finally`. Passive monitor only (ATMA), nothing is transmitted on the bus by it.
  - `listen_bus` digest: frame count, seconds, distinct ids, top 10 ids by count with frames/s.
  - `lookup_guide` digest: the guide note, related DIDs, the routine id when present; `"No curated guide for <code> on this car."`; `"Give a code or a topic."` when both are missing.

- [ ] **Step 1: Write the failing tests**

```ts
it('listenBus returns the Golf monitor frames and stops the monitor', async () => {
  const lines = await createReadOnlySession(golfSession).listenBus(200);
  expect(lines.length).toBeGreaterThan(0);
  expect(golfSession.sniffing).toBe(false);
});
it('listen_bus summarises ids', async () =>
  expect((await toolOf(snifferTools, 'listen_bus').run({ seconds: 2 }, golfCtx)).digest).toMatch(
    /distinct ids: \d+/,
  ));
it('lookup_guide finds the Golf EGR guide by code and by topic', async () => {
  expect(
    (await toolOf(faultTools, 'lookup_guide').run({ code: 'P0401' }, golfCtx)).digest,
  ).toContain('EGR flow/position fault');
  expect(
    (await toolOf(faultTools, 'lookup_guide').run({ topic: 'egr' }, golfCtx)).digest,
  ).toContain('EGR');
  expect((await toolOf(faultTools, 'lookup_guide').run({}, golfCtx)).digest).toBe(
    'Give a code or a topic.',
  );
});
```

- [ ] **Step 2: Run to verify failure** — `npx jest --selectProjects core src/shared/obd-core/agent/readOnlySession.test.ts src/features/can-sniffer/agent src/features/fault-codes/agent` → FAIL.
- [ ] **Step 3: Implement**; append `canSnifferAgentTools`; doc lines.
- [ ] **Step 4: Run, then `npm run ci`** → PASS / green.
- [ ] **Step 5: Commit** — `git commit -m "feat(agent): passive bus_listen and lookup_guide"`

---

### Task 9: Catalog completeness and docs

**Files:**

- Modify: `test/app/aiDiagnoseRoute.test.tsx`, `docs/features/ai-diagnose.md` (capability-skill table: skill, owner, tools, availability on the Golf / Punto / Passat), `docs/implementation-log.md` (entry "AI agent capability skills (plan 34b)")
- Test: `test/app/aiDiagnoseRoute.test.tsx`

**Interfaces:**

- Consumes: `AGENT_CONTRIBUTIONS`, `buildAgentRegistry`, `availableSkills`.
- Produces: `CAPABILITY_SKILLS` constant in the test (the 21 names from the spec's table).

- [ ] **Step 1: Write the failing test**

```ts
const CAPABILITY_SKILLS = [
  'fault_codes',
  'module_scan',
  'live_data',
  'record_live',
  'sensor_tests',
  'extended_data',
  'adaptations_read',
  'coding_read',
  'dpf',
  'battery',
  'used_car_check',
  'vehicle_identity',
  'adapter_health',
  'trips',
  'performance_history',
  'fuel_economy',
  'maintenance',
  'history',
  'alerts_history',
  'app_errors',
  'bus_listen',
];
it('registers all 21 capability skills, each a capability', () => {
  const reg = buildAgentRegistry([CORE_AGENT_CONTRIBUTION, ...AGENT_CONTRIBUTIONS]);
  for (const n of CAPABILITY_SKILLS) expect(reg.skills.get(n)?.kind).toBe('capability');
});
it.each([
  ['golf-plus-2009-20tdi', ['module_scan', 'dpf', 'extended_data']],
  ['passat-b55-19tdi', ['adaptations_read']],
  ['fiat-punto-2008-12', ['fault_codes', 'live_data']],
])('%s offers %j', (id, names) => {
  const offered = availableSkills(
    buildAgentRegistry([CORE_AGENT_CONTRIBUTION, ...AGENT_CONTRIBUTIONS]),
    availability(id),
  ).map((s) => s.name);
  expect(offered).toEqual(expect.arrayContaining(names));
});
it('no capability tool is a write', () => {
  const reg = buildAgentRegistry([CORE_AGENT_CONTRIBUTION, ...AGENT_CONTRIBUTIONS]);
  for (const name of reg.tools.keys())
    expect(name).not.toMatch(/clear|write|reset|code_module|routine|regen/);
});
```

- [ ] **Step 2: Run to verify failure** — `npx jest --selectProjects ui test/app/aiDiagnoseRoute.test.tsx` → FAIL until every task above has landed (run it last).
- [ ] **Step 3: Fill any gap the test finds**; write the ai-diagnose table and the implementation-log entry; rebuild the graph (`PYTHONIOENCODING=utf-8 python .claude/skills/bolid-context/scripts/graph.py build`).
- [ ] **Step 4: Run, then `npm run ci`** → PASS / green.
- [ ] **Step 5: Commit** — `git commit -m "test(agent): all 21 capability skills registered; docs"`

---

## Acceptance

- [ ] With `mock://ai`, "Check everything" on the simulator Golf shows triage with the module-scan and history lines; `open_skill` on any capability skill returns its document.
- [ ] Every owning feature's screen behaves as before (the extracted `readDpf`, `runInspection`, `readCodingReadOnly` are used by the screens too).
- [ ] No agent tool reaches `DiagnosticSession` directly (grep: no `useSessionStore` in `src/features/*/agent/`).
- [ ] `npm run ci` green.

## Deferred until an on-car session

1. **Golf module scan vs VCDS.** On the Golf, run `scan_modules` through the agent (Investigate "check all modules") and compare each module's part number and codes with a VCDS auto-scan from the same day (see `golf-real-logs` in the owner's notes: VAG 5-digit = the DTC's two bytes as decimal). Mismatches go into the module entries of `src/shared/vehicles/golf-plus-2009-20tdi.ts` with `confirmed` evidence (plan 25 rules).
2. **Adaptation and coding reads.** On the Passat (KWP) run `read_adaptations` and on the Golf `read_coding`; confirm the session change (`10 85`) is accepted and the values match the Adaptations / Coding screens. No write is attempted by the agent.
3. **`bus_listen` on the real adapter.** On a Vgate (BLE), run `listen_bus` for 10 s at idle; record the frame count and distinct ids in `docs/features/can-sniffer.md`; if the adapter drops frames (`BUFFER FULL`), lower the default to 5 s.
