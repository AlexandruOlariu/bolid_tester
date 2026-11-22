# Plan 34c — AI diagnostic agent: symptom playbooks, new analysis modules, no-AI mode, simulator faults and the eval set Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teach the agent the complaints a driver actually has (17 symptom playbooks, seven with deterministic procedures backed by four new pure analysis modules), make **Check everything** useful without AI, and make all of it reproducible on the simulator, in a Maestro flow and in an offline eval against the owner's model.

**Architecture:** The four analysis modules (`fuelTrims`, `boost`, `cooling`, `misfire`) are pure in `src/shared/obd-core/analysis/`. Playbooks are `bolid.skill.v1` files plus core procedures in `src/shared/obd-core/agent/playbooks/`, exported as `PLAYBOOK_CONTRIBUTION` and added to the route's list; they use core tools directly and reach feature tools only through `ProcedureContext.callTool` / `runProcedure` (gated by `requires.skills`). The simulator gains opt-in scripted faults and a short rev hold; nothing changes in the default scenarios, so the recorded `sim-*.json` fixtures stay fresh.

**Tech Stack:** TypeScript, obd-core, `MockTransport`, zustand settings store, Maestro, Jest.

**Spec:** [`docs/superpowers/specs/2026-11-22-ai-agent-diagnose-design.md`](../superpowers/specs/2026-11-22-ai-agent-diagnose-design.md) — "Skills", "Symptom playbooks, phase 1", "Without AI", "Testing".

**Depends on:** [34a](./34a-ai-agent-core.md); [34b](./34b-ai-agent-capability-skills.md) for the playbooks that lean on feature tools (`read_trip`, `read_dpf`, `used_car_check`, `maintenance`, `adapter_health`, `read_app_errors`, `read_dtcs_detail`) — without them those playbooks are simply not offered.

## Global Constraints

- **Read-only agent in this phase.** Procedures use only the `ProcedureContext` (read-only session, `callTool`, `runProcedure`, gated `askDriver`); none reaches a write path; **Clear codes** stays the existing confirmed button; no forced regeneration, output test or basic setting is run.
- Never immobilizer / airbag / cluster-mileage; never ship seed/key algorithms.
- `ask_driver` only from the fixed list, stationary only (34a gate). A stationary rev hold is "in Park or Neutral".
- Metric only: kPa, °C, rpm, %, V, min, km.
- Every user-facing string en + ro in the same task (finding keys `aiDiagnose:agent.finding.<module>.<id>.{title,detail}`; driver texts and choices). Playbook documents and digests are model-facing English.
- `skill_boost` is **MAP-only** with **per-profile expected ranges**; `skill_cooling` uses the **most recent recorded trip that started cold** and never makes the user wait for a warm-up (spec, verbatim decisions).
- Without AI: **Check everything** runs triage plus every available skill with a procedure in a fixed order (driver steps included) and builds the rule report; a typed symptom without AI does the same with a notice that understanding the symptom needs AI.
- Default simulator scenarios are unchanged (scripted faults are opt-in); `sim-fixtures.freshness.test.ts` must stay green without re-recording.
- The eval set is **not in CI** (skipped unless `BOLID_EVAL_URL` is set).
- `npm run ci` green at the end of every task; `act()` warnings fixed in tests only. Never touch `.agents/`, `.codex/`, `AGENTS.md`; never commit keystores, `.env`, `android/`. Commit messages end with the executing session's attribution lines.

## Review Focus

- **A PID goes `NO DATA` mid-procedure** → the procedure reports "not enough data" for that part and emits no finding from it, instead of judging on a missing value. (Task 1, Task 2 tests.)
- **The driver answers Can't, or the 3-minute timeout hits, on the rev hold** → boost and fuel-trim procedures still report the idle part. (Task 5 test.)
- **The rev hold is not reached** (rpm stays below `minHoldRpm`) → no hold judgement, digest says "rev hold not reached (max N rpm)". (Task 2 test.)
- **No barometric PID (Passat has no `0133`)** → baro assumed 101.3 kPa and the digest says so. (Task 2 test.)
- **No cold-start trip, or a trip without coolant** → the cooling skill uses the current coolant only and says why. (Task 3 test.)

## Read first

Plan 34a (Interfaces of Tasks 3–7), plan 34b catalog table, `src/shared/obd-core/analysis/{battery,dpf,inspection,trip}.ts`, `src/shared/obd-core/obd/mode06.ts`, `src/shared/obd-core/transport/{MockTransport,scenarios}.ts`, `docs/simulator.md`, `src/shared/vehicles/{types,userVehicle,golf-plus-2009-20tdi,passat-b55-19tdi}.ts`, `src/features/connection/api/connectionService.ts` (`buildScenario` call, `__sim`), `src/features/settings/ui/DeveloperSettingsScreen.tsx`, `.maestro/simulator-smoke.yaml`.

---

### Task 1: Fuel-trim analysis

**Files:**

- Create: `src/shared/obd-core/analysis/fuelTrims.ts` (export from `obd-core/index.ts`)
- Test: `src/shared/obd-core/analysis/fuelTrims.test.ts`

**Interfaces:**

- Produces:

```ts
export interface TrimReading {
  stftPct: number | null;
  ltftPct: number | null;
  rpm: number | null;
  mafGs?: number | null;
}
export type TrimPattern =
  | 'ok'
  | 'lean'
  | 'rich'
  | 'vacuum_leak'
  | 'lean_all_speeds'
  | 'insufficient';
export interface FuelTrimResult {
  pattern: TrimPattern;
  idleTotalPct: number | null;
  holdTotalPct: number | null;
  severity: DiagSeverity;
  notes: string[];
}
export const TRIM_LIMIT_PCT = 10; // |STFT + LTFT| at or above this is out of range
export const VACUUM_LEAK_DROP_PCT = 5; // lean at idle that improves by at least this at 2500 rpm
export function assessFuelTrims(idle: TrimReading, hold: TrimReading | null): FuelTrimResult;
```

Rules: total = STFT + LTFT (either null → `insufficient`, severity `info`); idle total ≥ 10 and hold total ≥ 10 → `lean_all_speeds` (`warn`); idle total ≥ 10 and (idle − hold) ≥ 5 → `vacuum_leak` (`warn`); idle total ≥ 10 without a hold → `lean` (`warn`); total ≤ −10 at idle or hold → `rich` (`warn`); else `ok` (`ok`). `notes` are English, model-facing.

- [ ] **Step 1: Write the failing tests**

```ts
it('lean at idle that improves at 2500 rpm is a vacuum leak', () =>
  expect(
    assessFuelTrims(
      { stftPct: 12.5, ltftPct: 18, rpm: 820 },
      { stftPct: 3.1, ltftPct: 9.4, rpm: 2500 },
    ),
  ).toMatchObject({
    pattern: 'vacuum_leak',
    severity: 'warn',
    idleTotalPct: 30.5,
    holdTotalPct: 12.5,
  }));
it('lean at both speeds points at the MAF or fuel delivery', () =>
  expect(
    assessFuelTrims({ stftPct: 6, ltftPct: 8, rpm: 820 }, { stftPct: 7, ltftPct: 8, rpm: 2500 })
      .pattern,
  ).toBe('lean_all_speeds'));
it('rich', () =>
  expect(assessFuelTrims({ stftPct: -6, ltftPct: -7, rpm: 820 }, null).pattern).toBe('rich'));
it('normal', () =>
  expect(assessFuelTrims({ stftPct: 1, ltftPct: -2, rpm: 820 }, null)).toMatchObject({
    pattern: 'ok',
    severity: 'ok',
  }));
it('a missing trim is insufficient, never a verdict', () =>
  expect(assessFuelTrims({ stftPct: null, ltftPct: 18, rpm: 820 }, null)).toMatchObject({
    pattern: 'insufficient',
    severity: 'info',
  }));
```

- [ ] **Step 2: Run to verify failure** — `npx jest --selectProjects core src/shared/obd-core/analysis/fuelTrims.test.ts` → FAIL.
- [ ] **Step 3: Implement `assessFuelTrims`.**
- [ ] **Step 4: Run, then `npm run ci`** → PASS / green.
- [ ] **Step 5: Commit** — `git commit -m "feat(analysis): fuel-trim pattern analysis"`

---

### Task 2: Boost analysis (MAP only) and per-profile expected ranges

**Files:**

- Create: `src/shared/obd-core/analysis/boost.ts` (export from `obd-core/index.ts`)
- Modify: `src/shared/vehicles/types.ts` (`BoostRange`, `VehicleProfile.boost?`), `src/shared/vehicles/golf-plus-2009-20tdi.ts`, `src/shared/vehicles/passat-b55-19tdi.ts`, `src/shared/vehicles/userVehicle.ts` (copy `boost` from the base like `mode06Tests`), `docs/vehicles/golf-plus-2009-20tdi.md`, `docs/vehicles/passat-b55-19tdi.md` (an "Expected boost (agent)" section with the ranges and "not yet confirmed on the car")
- Test: `src/shared/obd-core/analysis/boost.test.ts`, `src/shared/vehicles/userVehicle.test.ts` (extend)

**Interfaces:**

- Produces:

```ts
// types.ts
export interface BoostRange {
  idleDeltaKpa: [number, number];
  holdDeltaKpa: [number, number];
  holdRpm: number;
  minHoldRpm: number;
  confirmed?: Confirmation;
}
// boost.ts
export const ASSUMED_BARO_KPA = 101.3;
export const STUCK_VNT_IDLE_KPA = 30; // spec: "> 30 kPa at idle points to a stuck VNT"
export const MAP_BELOW_BARO_KPA = -10;
export const STUCK_SENSOR_KPA = 2;
export interface BoostInput {
  idleMapKpa: number | null;
  idleRpm: number | null;
  holdMapKpa: number | null;
  holdMaxRpm: number | null;
  baroKpa: number | null;
}
export type BoostFindingId =
  | 'ok'
  | 'idle_high'
  | 'stuck_vnt'
  | 'map_below_baro'
  | 'no_boost_hold'
  | 'overboost_hold'
  | 'stuck_sensor'
  | 'hold_not_reached'
  | 'insufficient';
export interface BoostResult {
  findings: { id: BoostFindingId; severity: DiagSeverity }[];
  idleDeltaKpa: number | null;
  holdDeltaKpa: number | null;
  baroAssumed: boolean;
  notes: string[];
}
export function assessBoost(input: BoostInput, range: BoostRange): BoostResult;
```

Ranges (initial, unconfirmed; the on-car session below confirms them): **Golf 2.0 TDI** `{ idleDeltaKpa: [-5, 15], holdDeltaKpa: [8, 60], holdRpm: 2500, minHoldRpm: 2200 }`; **Passat 1.9 TDI** `{ idleDeltaKpa: [-5, 15], holdDeltaKpa: [5, 60], holdRpm: 2500, minHoldRpm: 2200 }`. The Punto (no turbo) has none, so `requires.profile: ['boost']` hides the skill there.

Rules: baro = `baroKpa ?? 101.3` (`baroAssumed` when null); idle delta < −10 → `map_below_baro` (`warn`); idle delta > 30 → `stuck_vnt` (`warn`); idle delta above the range max (≤ 30) → `idle_high` (`info`); hold present but `holdMaxRpm < minHoldRpm` → `hold_not_reached` (`info`, no hold judgement); `|holdMap − idleMap| < 2` with an rpm rise ≥ 1000 → `stuck_sensor` (`warn`, replaces the hold judgement); hold delta < range min → `no_boost_hold` (`warn`); > range max → `overboost_hold` (`warn`); nothing flagged → `ok`; idle MAP null → `insufficient`. Notes state an unconfirmed range ("expected range not yet confirmed on this car") when `range.confirmed` is absent; findings are **not** capped for it (MAP and baro are standard PIDs).

- [ ] **Step 1: Write the failing tests**

```ts
const golf = getVehicleProfile('golf-plus-2009-20tdi').boost!;
it('normal idle and hold', () =>
  expect(
    assessBoost(
      { idleMapKpa: 100, idleRpm: 820, holdMapKpa: 125, holdMaxRpm: 2500, baroKpa: 100 },
      golf,
    ).findings,
  ).toEqual([{ id: 'ok', severity: 'ok' }]));
it('no boost at the hold (simulated low-boost fault)', () =>
  expect(
    assessBoost(
      { idleMapKpa: 100, idleRpm: 820, holdMapKpa: 104, holdMaxRpm: 2500, baroKpa: 100 },
      golf,
    ).findings.map((f) => f.id),
  ).toEqual(['no_boost_hold']));
it('more than 30 kPa at idle points to a stuck VNT', () =>
  expect(
    assessBoost(
      { idleMapKpa: 135, idleRpm: 820, holdMapKpa: null, holdMaxRpm: null, baroKpa: 100 },
      golf,
    ).findings[0],
  ).toEqual({ id: 'stuck_vnt', severity: 'warn' }));
it('identical MAP while rpm rises is a stuck sensor', () =>
  expect(
    assessBoost(
      { idleMapKpa: 100, idleRpm: 820, holdMapKpa: 101, holdMaxRpm: 2500, baroKpa: 100 },
      golf,
    ).findings[0].id,
  ).toBe('stuck_sensor'));
it('a hold below minHoldRpm is not judged', () =>
  expect(
    assessBoost(
      { idleMapKpa: 100, idleRpm: 820, holdMapKpa: 101, holdMaxRpm: 1500, baroKpa: 100 },
      golf,
    ).findings.map((f) => f.id),
  ).toEqual(['hold_not_reached']));
it('without 0133 the baro is assumed and said so', () => {
  const r = assessBoost(
    { idleMapKpa: 100, idleRpm: 820, holdMapKpa: null, holdMaxRpm: null, baroKpa: null },
    golf,
  );
  expect(r.baroAssumed).toBe(true);
  expect(r.notes.join(' ')).toContain('baro assumed 101.3 kPa');
});
it('a garage car on the Golf base keeps the boost range', () =>
  expect(runtimeProfile(userCarOn('golf-plus-2009-20tdi')).boost).toEqual(golf));
```

- [ ] **Step 2: Run to verify failure** — `npx jest --selectProjects core src/shared/obd-core/analysis/boost.test.ts src/shared/vehicles` → FAIL.
- [ ] **Step 3: Implement** the type, the ranges, the copy in `userVehicle.ts`, `assessBoost`, the two vehicle-doc sections (`vehicle-docs-sync.test.ts` stays green: no front-matter field changes).
- [ ] **Step 4: Run, then `npm run ci`** → PASS / green.
- [ ] **Step 5: Commit** — `git commit -m "feat(analysis): MAP-only boost check with per-profile expected ranges"`

---

### Task 3: Cooling analysis from the current reading and a cold-start trip

**Files:**

- Create: `src/shared/obd-core/analysis/cooling.ts` (export from `obd-core/index.ts`)
- Test: `src/shared/obd-core/analysis/cooling.test.ts`

**Interfaces:**

- Consumes: `TripSample` (`analysis/trip`).
- Produces:

```ts
export const COLD_START_MAX_C = 40,
  WARM_C = 80,
  THERMOSTAT_OPEN_MAX_C = 75,
  THERMOSTAT_DRIVE_MIN = 15,
  HOT_C = 105,
  OVERHEAT_C = 115,
  SLOW_WARMUP_MIN = { petrol: 20, diesel: 25 } as const;
export interface WarmupCurve {
  coldStart: boolean;
  startC: number | null;
  warmupMin: number | null;
  drivenMin: number;
  maxC: number | null;
}
export function warmupCurve(samples: TripSample[]): WarmupCurve | null; // null when no 0105 was logged
export type CoolingFindingId =
  | 'ok'
  | 'hot_now'
  | 'overheat_now'
  | 'thermostat_open'
  | 'slow_warmup'
  | 'trip_overheat'
  | 'no_cold_trip';
export function assessCooling(
  currentC: number | null,
  curve: WarmupCurve | null,
  fuel: Fuel,
): { findings: { id: CoolingFindingId; severity: DiagSeverity }[]; notes: string[] };
```

Rules: current ≥ 115 → `overheat_now` (`critical`), ≥ 105 → `hot_now` (`warn`) (same thresholds as `localHeuristicReport`); curve null or not a cold start → `no_cold_trip` (`info`, note "No recorded trip started cold; judged on the current reading only."); cold start, `drivenMin ≥ 15` and `maxC < 75` → `thermostat_open` (`warn`); `warmupMin` over 20 (petrol) / 25 (diesel) → `slow_warmup` (`info`); trip `maxC ≥ 115` → `trip_overheat` (`critical`), ≥ 105 → `trip_overheat` (`warn`); nothing else → `ok`. `drivenMin` counts samples with `010D > 0`; minutes from sample timestamps.

- [ ] **Step 1: Write the failing tests**

```ts
it('a cold start that never warms in 20 min of driving is a stuck-open thermostat', () => {
  const curve = warmupCurve(trip({ coolant: ramp(15, 68, 20), speed: 50 }))!;
  expect(assessCooling(70, curve, 'diesel').findings).toContainEqual({
    id: 'thermostat_open',
    severity: 'warn',
  });
});
it('a normal warm-up in 9 min is ok', () => {
  const curve = warmupCurve(trip({ coolant: ramp(20, 90, 12), speed: 50 }))!;
  expect(curve.warmupMin).toBeCloseTo(9, 0);
  expect(assessCooling(90, curve, 'petrol').findings).toEqual([{ id: 'ok', severity: 'ok' }]);
});
it('no cold-start trip falls back to the current reading', () =>
  expect(
    assessCooling(
      108,
      warmupCurve(trip({ coolant: ramp(85, 90, 10), speed: 50 })),
      'petrol',
    ).findings.map((f) => f.id),
  ).toEqual(['hot_now', 'no_cold_trip']));
it('a trip without coolant has no curve', () =>
  expect(warmupCurve(trip({ speed: 50 }))).toBeNull());
```

- [ ] **Step 2: Run to verify failure** — `npx jest --selectProjects core src/shared/obd-core/analysis/cooling.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, then `npm run ci`** → PASS / green.
- [ ] **Step 5: Commit** — `git commit -m "feat(analysis): cooling check from coolant and a cold-start trip"`

---

### Task 4: Misfire analysis from Mode 06 misfire monitors

**Files:**

- Create: `src/shared/obd-core/analysis/misfire.ts` (export from `obd-core/index.ts`)
- Test: `src/shared/obd-core/analysis/misfire.test.ts`

**Interfaces:**

- Consumes: `Mode06Result`.
- Produces:

```ts
export const MISFIRE_MIDS = ['A2', 'A3', 'A4', 'A5'] as const; // cylinders 1–4 (all three built-in cars are 4-cylinder)
export const MISFIRE_TID_CYCLE = 0x0c,
  MISFIRE_TID_EWMA = 0x0b,
  MISFIRE_MIN_COUNT = 5;
export type MisfireFindingId = 'none' | 'cylinder' | 'random' | 'no_data';
export function assessMisfire(results: Mode06Result[]): {
  id: MisfireFindingId;
  severity: DiagSeverity;
  cylinder?: number;
  counts: Record<number, number>;
};
```

Rules: counts per cylinder (`mid − 0xA1`) from TID `0x0C`, else `0x0B`; no MID A2–A5 result → `no_data` (`info`); one cylinder ≥ 5 and ≥ 2 × the next highest → `cylinder` (`warn`, `cylinder`); total ≥ 10 otherwise → `random` (`warn`); else `none` (`ok`).

- [ ] **Step 1: Write the failing tests**

```ts
it('one cylinder far above the rest', () =>
  expect(
    assessMisfire([m(0xa2, 0x0c, 1), m(0xa3, 0x0c, 14), m(0xa4, 0x0c, 2), m(0xa5, 0x0c, 0)]),
  ).toMatchObject({ id: 'cylinder', cylinder: 2, severity: 'warn' }));
it('spread across cylinders is random', () =>
  expect(
    assessMisfire([m(0xa2, 0x0c, 4), m(0xa3, 0x0c, 3), m(0xa4, 0x0c, 4), m(0xa5, 0x0c, 3)]).id,
  ).toBe('random'));
it('falls back to the EWMA test', () =>
  expect(assessMisfire([m(0xa2, 0x0b, 9), m(0xa3, 0x0b, 0)]).id).toBe('cylinder'));
it('no misfire monitors', () =>
  expect(assessMisfire([m(0x01, 0x8e, 1)])).toMatchObject({ id: 'no_data', severity: 'info' }));
```

- [ ] **Step 2: Run to verify failure** — `npx jest --selectProjects core src/shared/obd-core/analysis/misfire.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, then `npm run ci`** → PASS / green.
- [ ] **Step 5: Commit** — `git commit -m "feat(analysis): misfire counts from Mode 06 monitors"`

---

### Task 5: The 17 symptom playbooks and their procedures

**Files:**

- Create: `src/shared/obd-core/agent/playbooks/index.ts` (`PLAYBOOK_CONTRIBUTION`), `src/shared/obd-core/agent/playbooks/procedures.ts`, one `src/shared/obd-core/agent/playbooks/<name>.skill.json` per playbook below
- Modify: `src/shared/obd-core/agent/types.ts` (`DriverInstructionId` + `'smoke_colour'`), `src/shared/obd-core/agent/driver.ts`, `src/app/ai-diagnose.tsx` (append `PLAYBOOK_CONTRIBUTION`), `src/shared/i18n/locales/{en,ro}/aiDiagnose.json`
- Test: `src/shared/obd-core/agent/playbooks/playbooks.test.ts` (core)

**Interfaces:**

- Consumes: Tasks 1–4; `ProcedureContext`; `read_live` `data` (34a); `read_trip {id:'latest_cold'}` `data` (34b); `battery_capture` (34a).
- Produces: `PLAYBOOK_CONTRIBUTION: AgentContribution` with these skills (`kind: 'playbook'`; spec's "skill\_<x>" names are written without the prefix):

| Playbook                                                                                  | `requires`                                  | Procedure (what it does)                                                                                                                                                                                                              | Findings (`aiDiagnose:agent.finding.…`)                              |
| ----------------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `fuel_trims`                                                                              | `pids: ['0106','0107']`                     | `read_live` trims + rpm + MAF 5 s at idle → `askDriver('hold_2500_rpm')` → 5 s again on `done` → `assessFuelTrims`                                                                                                                    | `trims.<pattern>`                                                    |
| `boost`                                                                                   | `profile: ['boost'], pids: ['010B','010C']` | `read_live 010B/0133/010C` 3 s at idle → `askDriver('hold_2500_rpm')` → 5 s on `done` → `assessBoost(…, profile.boost)`                                                                                                               | `boost.<id>`                                                         |
| `battery_charging`                                                                        | —                                           | `runProcedure('battery_capture')` → `askDriver('electrical_load_on')` → `read_live 0142/010C` 5 s (or `session.voltage()` when `0142` is unsupported) → `askDriver('electrical_load_off')`; under load < 13.2 V with rpm > 600 → weak | battery findings + `charging.weakUnderLoad` (`warn`) / `charging.ok` |
| `cooling`                                                                                 | `pids: ['0105']`                            | `read_live 0105` once; `callTool('read_trip', { id: 'latest_cold' })` when registered (else no curve) → `warmupCurve` → `assessCooling`                                                                                               | `cooling.<id>`                                                       |
| `misfire`                                                                                 | `protocol: 'can', fuel: ['petrol','lpg']`   | `session.readMode06(mid)` for `MISFIRE_MIDS` → `assessMisfire`                                                                                                                                                                        | `misfire.<id>`                                                       |
| `dpf_regen`                                                                               | `skills: ['dpf']`                           | `runProcedure('dpf')`                                                                                                                                                                                                                 | (from `dpf`)                                                         |
| `used_car`                                                                                | `skills: ['used_car_check']`                | `runProcedure('used_car_check')`                                                                                                                                                                                                      | (from it)                                                            |
| `check_engine_light`                                                                      | —                                           | `read_dtcs`; for each stored code `callTool('read_dtcs_detail', { code })` when registered (max 4)                                                                                                                                    | —                                                                    |
| `before_long_trip`                                                                        | —                                           | `runProcedure` of each available of `cooling`, `maintenance`, `dpf`                                                                                                                                                                   | merged                                                               |
| `keeps_disconnecting`                                                                     | `skills: ['adapter_health']`                | `runProcedure('adapter_health')` + `callTool('read_app_errors', { limit: 10 })` when registered                                                                                                                                       | (from them)                                                          |
| `hard_start`, `rough_idle`, `limp_mode`, `high_consumption`, `smoke`, `glow_plugs`, `egr` | — (`glow_plugs`: `fuel: ['diesel']`)        | none — document only; their `instructions` name the capability skills and tools to use (`smoke` asks `ask_driver smoke_colour`)                                                                                                       | —                                                                    |

Each playbook's procedure id equals its name. Playbook `tools` list only built-ins and core tools (`read_live`, `read_dtcs`) so the registry validates with or without feature contributions; feature reach is through `requires.skills` and `callTool` guarded by `reg.tools.has(name)`. `DRIVER_INSTRUCTIONS.smoke_colour = { en: 'With the engine running, look at the exhaust: what colour is the smoke?', choices: ['white', 'blue', 'black', 'grey', 'none'] }`; the driver's `choice` value goes into the step digest. Every procedure's digest states each part it could not measure (`"rev hold: driver could not do it"`, `"rev hold not reached (max 1800 rpm)"`, `"0107 not answered: trims not judged"`).

- [ ] **Step 1: Write the failing tests** (Golf / Punto simulators; fake `askDriver`; for the hold, a fake session whose `pollOnce` answers hold values after `done`)

```ts
it('every playbook file parses and the registry accepts them alone (no features)', () => {
  const reg = buildAgentRegistry([CORE_AGENT_CONTRIBUTION, PLAYBOOK_CONTRIBUTION]);
  expect([...reg.skills.values()].filter((s) => s.kind === 'playbook')).toHaveLength(17);
});
it('boost is offered on the Golf and Passat, not on the Punto', () => {
  const reg = buildAgentRegistry([CORE_AGENT_CONTRIBUTION, PLAYBOOK_CONTRIBUTION]);
  expect(availableSkills(reg, availability('golf-plus-2009-20tdi')).map((s) => s.name)).toContain(
    'boost',
  );
  expect(availableSkills(reg, availability('fiat-punto-2008-12')).map((s) => s.name)).not.toContain(
    'boost',
  );
});
it('boost reports idle only when the driver cannot hold 2500 rpm', async () => {
  const r = await proc('boost').run(golfProcCtx({ driver: { kind: 'cant' } }));
  expect(r.digest).toContain('rev hold: driver could not do it');
  expect(r.findings?.map((f) => f.key)).toEqual(['aiDiagnose:agent.finding.boost.ok']);
});
it('fuel_trims finds the vacuum-leak pattern on a lean Punto', async () => {
  const r = await proc('fuel_trims').run(
    puntoProcCtx({ simFault: 'lean_trims', driver: { kind: 'done' } }),
  );
  expect(r.findings?.[0].key).toBe('aiDiagnose:agent.finding.trims.vacuum_leak');
});
it('fuel_trims does not judge when 0107 is not answered', async () => {
  const r = await proc('fuel_trims').run(puntoProcCtx({ noData: ['0107'] }));
  expect(r.digest).toContain('0107 not answered: trims not judged');
  expect(r.findings ?? []).toEqual([]);
});
it('cooling without a trip tool judges the current reading only', async () =>
  expect((await proc('cooling').run(golfProcCtx({}))).findings?.map((f) => f.key)).toContain(
    'aiDiagnose:agent.finding.cooling.no_cold_trip',
  ));
it('smoke asks for the colour and records the choice', async () => {
  // run through runAgent with a scripted model: open_skill smoke → ask_driver smoke_colour → final
  const o = await runAgent(
    sym('smoke'),
    deps([OPEN_SMOKE, ASK_SMOKE, FINAL], { driver: { kind: 'choice', value: 'blue' } }),
  );
  expect(o.trail[2].digest).toContain('Driver answered: blue');
});
```

- [ ] **Step 2: Run to verify failure** — `npx jest --selectProjects core src/shared/obd-core/agent/playbooks` → FAIL.
- [ ] **Step 3: Implement** the procedures, the 17 skill files (each with `instructions` naming the capability skills to open, `interpret` with the domain knowledge — e.g. boost: "on a VAG diesel, MAP minus baro at idle near 0 kPa is normal; more than 30 kPa at idle points to a stuck VNT"; `profileNotes` for the Golf and Passat where it matters), the `smoke_colour` instruction with its en + ro texts and five choice labels (`agent.driver.choice.<value>`), and every finding key's en + ro `title` / `detail`. Append `PLAYBOOK_CONTRIBUTION` to `AGENT_CONTRIBUTIONS`.
- [ ] **Step 4: Run, then `npm run ci`** → PASS / green.
- [ ] **Step 5: Commit** — `git commit -m "feat(agent): 17 symptom playbooks with boost, trims, cooling, misfire and charging procedures"`

---

### Task 6: No-AI mode — triage plus every available skill, then the rule report

**Files:**

- Modify: `src/shared/obd-core/agent/loop.ts`, `src/shared/obd-core/agent/loop.test.ts`, `src/features/ai-diagnose/api/agentService.ts`, `src/shared/i18n/locales/{en,ro}/aiDiagnose.json`
- Test: `src/shared/obd-core/agent/loop.test.ts`, `src/features/ai-diagnose/ui/AiDiagnoseScreen.test.tsx`

**Interfaces:**

- Produces:
  - `NO_AI_SKILL_ORDER = ['used_car_check', 'fuel_trims', 'boost', 'misfire', 'cooling', 'dpf', 'battery_charging', 'maintenance'] as const`.
  - `runAgent` with `chat === null`: after triage, for each name in `NO_AI_SKILL_ORDER` that is available and has a procedure, run it as a `kind: 'skill'` step (`why: ''`, label of the skill) under the same Stop / adapter / disconnect rules (model steps stay 0, the 12-step cap does not apply); then `agentRuleReport` over the trail; end `no_ai`.
  - Notices: `agent.end.no_ai` (Check everything) unchanged; a symptom run without AI uses `agent.end.no_ai_symptom` = en "Understanding a described symptom needs an AI provider, so everything available was checked instead. {{problem}}".
  - 34a's test `no AI → rule report from triage` becomes: with only `CORE_AGENT_CONTRIBUTION`, `trail.length === 1`.

- [ ] **Step 1: Write the failing tests**

```ts
it('without AI it runs the available skills in the fixed order', async () => {
  const o = await runAgent({ mode: 'everything' }, { ...deps([], { registry: golfFullRegistry }), chat: null });
  expect(o.end).toBe('no_ai'); expect(o.stepsUsed).toBe(0);
  expect(o.trail.filter((s) => s.kind === 'skill').map((s) => s.tool)).toEqual(['used_car_check', 'boost', 'cooling', 'dpf', 'battery_charging', 'maintenance']);
  expect(o.report.findings.some((f) => (f.steps ?? [])[0] > 1)).toBe(true);
});
it('Stop during the no-AI sweep keeps what was gathered', async () => { /* abort after the 2nd skill → end 'stopped', 3 trail steps */ });
// AiDiagnoseScreen.test.tsx
it('a symptom without AI checks everything and says why', async () => {
  useSettingsStore.setState((s) => ({ ai: { ...s.ai, enabled: false } })); await connectSimulator();
  renderWithProviders(<AiDiagnoseScreen />); // core only: the sweep has nothing to run, so no driver prompt blocks the test
  fireEvent.changeText(screen.getByPlaceholderText(/pulls weak/), 'pulls weak');
  await act(async () => { fireEvent.press(screen.getByText('Investigate')); });
  expect(await screen.findByText(/Understanding a described symptom needs an AI provider/)).toBeTruthy();
});
```

(`golfFullRegistry` = `buildAgentRegistry([CORE_AGENT_CONTRIBUTION, PLAYBOOK_CONTRIBUTION, ...the 34b feature contributions])`, with a fake `askDriver` answering `cant` and a fake `sleep`.)

- [ ] **Step 2: Run to verify failure** — `npx jest --selectProjects core src/shared/obd-core/agent/loop.test.ts` and `npx jest --selectProjects ui src/features/ai-diagnose` → FAIL.
- [ ] **Step 3: Implement**; the driver prompts of the swept skills appear in the UI exactly as in an AI run.
- [ ] **Step 4: Run, then `npm run ci`** → PASS / green.
- [ ] **Step 5: Commit** — `git commit -m "feat(agent): no-AI mode runs every available skill before the rule report"`

---

### Task 7: Simulator scripted faults and the stationary rev hold

**Files:**

- Modify: `src/shared/obd-core/transport/MockTransport.ts` (`SimScenario.simFault`, `holdRevs(ms)`), `src/shared/obd-core/transport/scenarios.ts` (pass-through), `src/shared/state/settingsStore.ts` (`simFault`, `setSimFault`, excluded from `partialize` — no version bump), `src/features/connection/api/connectionService.ts` (pass `simFault` to `buildScenario`; `__sim.holdRevs(ms)`), `src/features/settings/ui/DeveloperSettingsScreen.tsx` (a "Scripted fault" segmented control: None · Low boost · Lean fuel trims · Weak charging), `src/features/ai-diagnose/ui/AiDiagnoseScreen.tsx` + `hooks/useAiDiagnose.ts` (optional prop `onDriverAnswer?: (id: DriverInstructionId, reply: DriverReply) => void`, called after each answer), `src/app/ai-diagnose.tsx` (passes `onDriverAnswer` that calls `__sim.holdRevs(15_000)` on `done` for `hold_2500_rpm`), locales `{en,ro}/settings.json`, `docs/simulator.md` (new "Scripted faults (plan 34c)" section)
- Test: `src/shared/obd-core/transport/MockTransport.test.ts`, `src/features/connection/api/connectionService.test.ts`, `src/features/settings/ui/DeveloperSettingsScreen.test.tsx` (extend or create)

**Interfaces:**

- Produces:
  - `type SimFaultId = 'low_boost' | 'lean_trims' | 'weak_charging'`; `SimScenario.simFault?: SimFaultId`.
  - `MockTransport.holdRevs(ms: number): void` — for `ms` (from now), `010C` answers `[0x27, 0x10]` (2500 rpm) and `010B` answers `0x7D` (125 kPa), or `0x68` (104 kPa) with `low_boost`; afterwards back to idle bytes. Idle bytes are the existing `SIM_PID_BYTES` (820 rpm, 100 kPa).
  - `lean_trims`: idle `0106 = 0x90` (+12.5 %), `0107 = 0x97` (+18.0 %); during a rev hold `0106 = 0x84` (+3.1 %), `0107 = 0x8C` (+9.4 %).
  - `weak_charging`: `ATRV` → `12.1V`, `0142` → `[0x2F, 0x44]` (12.1 V).
  - Only PIDs the scenario supports answer, as today. `simFault` undefined ⇒ every byte identical to today.
  - `useSettingsStore` `simFault: SimFaultId | null` (default `null`), `setSimFault(f)`.
  - `__sim.holdRevs(ms: number): boolean` (false when the live transport is not a `MockTransport`).

- [ ] **Step 1: Write the failing tests**

```ts
it('default scenarios answer exactly as before', async () => {
  for (const id of ['generic', 'golf-plus-2009-20tdi', 'fiat-punto-2008-12', 'passat-b55-19tdi'])
    expect(
      await answersFor(new MockTransport(buildScenario(id)), [
        '010C',
        '010B',
        '0106',
        '0107',
        '0142',
        'ATRV',
      ]),
    ).toEqual(BASELINE[id]);
});
it('holdRevs raises rpm and MAP for its window only', async () => {
  const m = new MockTransport(buildScenario('golf-plus-2009-20tdi'));
  await connect(m);
  m.holdRevs(50);
  expect(await ask(m, '010C')).toBe('410C2710');
  expect(await ask(m, '010B')).toBe('410B7D');
  await sleep(60);
  expect(await ask(m, '010C')).toBe('410C0CD0');
});
it('low_boost keeps MAP near baro during the hold', async () => {
  const m = new MockTransport(buildScenario('golf-plus-2009-20tdi', { simFault: 'low_boost' }));
  await connect(m);
  m.holdRevs(50);
  expect(await ask(m, '010B')).toBe('410B68');
});
it('lean_trims and weak_charging bytes', async () => {
  const p = new MockTransport(buildScenario('fiat-punto-2008-12', { simFault: 'lean_trims' }));
  await connect(p);
  expect(await ask(p, '0107')).toBe('410797');
  const g = new MockTransport(buildScenario('golf-plus-2009-20tdi', { simFault: 'weak_charging' }));
  await connect(g);
  expect(await ask(g, 'ATRV')).toBe('12.1V');
});
it('connect passes the scripted fault from settings', async () => {
  useSettingsStore.setState({ adapterSource: 'mock', simFault: 'weak_charging' });
  await connect();
  expect(useSessionStore.getState().info?.voltage).toBeCloseTo(12.1);
});
```

- [ ] **Step 2: Run to verify failure** — `npx jest --selectProjects core src/shared/obd-core/transport/MockTransport.test.ts src/features/connection/api/connectionService.test.ts` → FAIL.
- [ ] **Step 3: Implement**; confirm `npx jest --selectProjects core src/shared/obd-core/transport/sim-fixtures.freshness.test.ts` stays green **without** running `npm run fixtures:sim`. Write the `docs/simulator.md` section (the three faults, their bytes, `holdRevs`, the Developer picker, that the AI screen's hold step triggers a 15 s hold in simulator mode).
- [ ] **Step 4: Run, then `npm run ci`** → PASS / green.
- [ ] **Step 5: Commit** — `git commit -m "feat(simulator): scripted low-boost, lean-trim and weak-charging faults with a rev hold"`

---

### Task 8: Mock AI playbook script and the Maestro flow

**Files:**

- Modify: `src/shared/ai/__mocks__/mockAiServer.ts`, `src/shared/ai/mockAiServer.test.ts`
- Create: `.maestro/ai-agent.yaml`
- Modify: `docs/testing.md` (how to run the flow: a **debug** build, because `mock://ai` is refused in release builds), `docs/features/ai-diagnose.md` (mock scripts list)
- Test: `src/shared/ai/mockAiServer.test.ts`

**Interfaces:**

- Produces: mock script — symptom containing `pulls weak`, `boost` or `turbo`: `open_skill {name:'boost'}` → `run_skill {name:'boost'}` → final citing `[1, 3]` with one finding per `boost.` finding key found in the step-3 digest (title `"Boost check: <id> (mock)"`). `.maestro/ai-agent.yaml` flow: `launchApp clearState` → Settings → Developer & simulator → **Simulator (no car)** → Scripted fault **Low boost** → back → Settings → **AI assistant** → switch on → Provider **Custom** → Server URL `mock://ai` → Connect tab → **Connect to simulator** → pick the Golf → More → **Diagnose (AI)** → type `pulls weak above 2000 rpm` → **Investigate** → wait for `In Park or Neutral, hold the engine at 2500 rpm for 10 seconds.` → **Done** → `extendedWaitUntil` `Mock AI report` (30 s) → `assertVisible` `Based on: steps` and the trail row label for `boost`.

- [ ] **Step 1: Write the failing test**

```ts
it('a "pulls weak" symptom opens and runs the boost playbook', async () => {
  const c = createMockAiClient();
  const m = [sys, user('The driver reports: "pulls weak above 2000 rpm"')];
  expect(JSON.parse((await c.chat(m, agent))!)).toMatchObject({
    tool: 'open_skill',
    args: { name: 'boost' },
  });
  expect(JSON.parse((await c.chat([...m, asst('{}'), user('r')], agent))!)).toMatchObject({
    tool: 'run_skill',
    args: { name: 'boost' },
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx jest --selectProjects core src/shared/ai/mockAiServer.test.ts` → FAIL.
- [ ] **Step 3: Implement** the script and write the flow (labels are the app's real English strings; the flow header comment says it needs a debug build and is not part of `e2e.yml`, which builds a release APK where `mock://ai` is refused).
- [ ] **Step 4: Run, then `npm run ci`** → PASS / green. (The Maestro run itself is in the deferred section.)
- [ ] **Step 5: Commit** — `git commit -m "test(e2e): mock-AI boost script and the ai-agent Maestro flow"`

---

### Task 9: Offline eval set

**Files:**

- Create: `src/shared/ai/eval/agentEval.test.ts`, `src/shared/ai/eval/cases.json`
- Modify: `package.json` (script `"eval:agent": "jest --selectProjects core src/shared/ai/eval"`), `docs/testing.md` ("Agent eval set")
- Test: the eval file itself (skipped in CI)

**Interfaces:**

- Consumes: `runAgent`, `runTriage`, `buildAgentRegistry`, `CORE_AGENT_CONTRIBUTION`, `PLAYBOOK_CONTRIBUTION`, `createReadOnlySession`, `MockTransport.holdRevs`, `getAiClient` (Node `fetch`).
- Produces:
  - `cases.json`: `[{ "id": "golf-low-boost", "profile": "golf-plus-2009-20tdi", "simFault": "low_boost", "symptom": "pulls weak above 2000 rpm", "expect": "boost|turbo|MAP" }, { "id": "punto-lean", "profile": "fiat-punto-2008-12", "simFault": "lean_trims", "symptom": "high fuel consumption and rough idle", "expect": "lean|vacuum|trim" }, { "id": "golf-weak-charging", "profile": "golf-plus-2009-20tdi", "simFault": "weak_charging", "symptom": "battery light flickers", "expect": "charg|alternator|voltage" }, { "id": "golf-everything", "profile": "golf-plus-2009-20tdi", "symptom": null, "expect": "P2183|P2015" }]` (the last uses the Golf's seeded known faults).
  - The suite runs only when `process.env.BOLID_EVAL_URL` is set (`(URL ? describe : describe.skip)`), with `BOLID_EVAL_MODEL`, optional `BOLID_EVAL_KEY`, `BOLID_EVAL_PROVIDER` (default `custom`). Per case: a real `DiagnosticSession` over `MockTransport(buildScenario(profile, { simFault }))`, the core + playbook registry, `askDriver` answering `done` (and calling `holdRevs(15_000)` for `hold_2500_rpm`), real `chat`. **Pass** = the most severe finding (first on ties) matches `expect` (case-insensitive) **and** cites ≥ 1 step. Prints one line per case with `process.stdout.write`: `id  PASS|FAIL  end  steps  wall_s  top finding`, then `passed/total`; the test asserts nothing about the pass rate (it is a measurement), only that every case finished.

- [ ] **Step 1: Write the eval file and cases; confirm it is skipped without the variable**

Run: `npx jest --selectProjects core src/shared/ai/eval`
Expected: `Tests: 4 skipped`.

- [ ] **Step 2: Run it against the mock-free path locally with a fake server** — set `BOLID_EVAL_URL` to an unreachable `http://127.0.0.1:9` and confirm every case finishes with end `ai_error` and a rule report (proves the harness without a model).

Run (PowerShell): `$env:BOLID_EVAL_URL='http://127.0.0.1:9'; $env:BOLID_EVAL_MODEL='x'; npm run eval:agent`
Expected: 4 lines, each `FAIL  ai_error`, and the suite passes.

- [ ] **Step 3: Document** how to run it against the owner's server and how to read the output (what to tune: prompt wording, `FULL_DIGESTS`, the step budget) in `docs/testing.md`.
- [ ] **Step 4: `npm run ci`** → green (the eval is skipped).
- [ ] **Step 5: Commit** — `git commit -m "test(agent): offline eval set against a configured model (not in CI)"`

---

### Task 10: Docs

**Files:**

- Modify: `docs/features/ai-diagnose.md` (Playbooks section: the 17 names, which have procedures, availability on the three cars; No-AI mode; the four analysis modules and their thresholds), `docs/implementation-log.md` (entry "AI agent playbooks (plan 34c)")
- Test: none beyond `npm run ci` (`featureDocsSync`, `vehicle-docs-sync`)

- [ ] **Step 1: Write the sections** (values copied from Tasks 1–4 and 7).
- [ ] **Step 2: Rebuild the graph** — `PYTHONIOENCODING=utf-8 python .claude/skills/bolid-context/scripts/graph.py build`.
- [ ] **Step 3: `npm run ci`** → green.
- [ ] **Step 4: Commit** — `git commit -m "docs(ai-diagnose): playbooks, no-AI mode and scripted faults"`

---

## Acceptance

- [ ] Simulator Golf + **Low boost** + `mock://ai`: "pulls weak above 2000 rpm" → hold prompt → **Done** → trail shows the boost step with `no_boost_hold` → cited report.
- [ ] Simulator Punto + **Lean fuel trims**, AI off: **Check everything** → driver prompts → rule report with the vacuum-leak finding citing the `fuel_trims` step.
- [ ] Default simulator fixtures unchanged; `npm run ci` green.

## Deferred until an on-car session

1. **Confirm the boost ranges.** Golf, engine warm (coolant ≥ 80 °C), stationary in Neutral: Live → watch `010B` and `0133` for 30 s at idle, then hold 2500 rpm for 10 s and note MAP. Repeat twice. Do the same on the Passat (no `0133`: note MAP with the ignition on and the engine off as the baro). Put the measured deltas, widened by 5 kPa each side, into `boost` in `golf-plus-2009-20tdi.ts` / `passat-b55-19tdi.ts` with `confirmed: { source: 'on-car', date, … }`, and update the two vehicle docs. If a healthy car shows < 8 kPa at the hold, lower `holdDeltaKpa[0]` — a stationary hold builds little boost.
2. **Fuel trims on the Punto.** Warm engine: run the `fuel_trims` playbook (AI off, Check everything) and note the idle and 2500 rpm totals; if a healthy Punto reads beyond ±10 %, record it in its vehicle doc before touching `TRIM_LIMIT_PCT`.
3. **Cooling from a real cold start.** Record a trip from a cold engine (overnight) for ≥ 20 min on any of the cars, then run the `cooling` playbook; check `warmupMin` against the cluster gauge.
4. **Eval against the owner's self-hosted model.** `$env:BOLID_EVAL_URL='http://<server>:<port>'; $env:BOLID_EVAL_MODEL='<model>'; npm run eval:agent` three times; paste the summaries into `docs/testing.md` → "Agent eval set — results" with the date and model. If fewer than 3/4 pass, adjust the agent system prompt or `FULL_DIGESTS` (34a) and re-run; record what changed.
5. **Maestro flow.** Build a debug APK (`npx expo run:android`), then `maestro test .maestro/ai-agent.yaml` on the emulator; fix any label drift in the flow.
