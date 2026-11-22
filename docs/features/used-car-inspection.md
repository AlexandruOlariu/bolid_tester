# Feature: used-car-inspection

A one-tap **pre-purchase check** for a used car. It runs a standard OBD2 snapshot and turns it into a
plain verdict — **pass / caution / fail** — with a per-check breakdown a non-expert can read while
standing next to the car.

> All **standard OBD2** — no manufacturer access needed, so it works on **any** OBD2 car (CAN or
> K-line). It is a screening aid, not a mechanical inspection: it sees the engine/emissions ECU, not
> body/structural condition.

## The headline check — "were the codes just cleared?"

A seller can clear fault codes minutes before a viewing so the dash looks clean. But clearing codes
also **resets the emissions readiness monitors**, which then take a full drive cycle to re-complete.
So **many not-ready monitors + no stored codes + a tiny "distance since codes cleared"** (Mode 01 PID 31) is a classic tell that something was wiped. The inspection surfaces this explicitly as a caution.

## What it checks

- **MIL** (check-engine light) on/off — from readiness (Mode 01 PID 01).
- **Stored** DTCs (Mode 03) → fail; **permanent** DTCs (Mode 0A) → fail (cannot be cleared by a tool
  or battery pull — a genuine current emissions fault); **pending** DTCs (Mode 07) → caution.
- **Readiness** monitors complete/total, plus the **recently-cleared** heuristic above.
- **Freeze frame** present → info (a fault was captured at some point).
- **VIN** readable (info) — older K-line ECUs may not report it.

## UI

- **InspectionScreen** — a big **Run inspection** button; on completion a colored verdict header with a
  0–100 score and a list of checks (pass/caution/fail/info) each with a one-line detail. A short
  disclaimer that it screens the emissions ECU only.

## hooks

- `useInspection()` — calls `runInspection(session, info?.vin ?? null)`, stores the report,
  exposes `{ run, report, running }`.

## api (core)

- Pure logic in [`obd-core/analysis/inspection`](../architecture.md) — `assessInspection(input)` →
  `{ verdict, score, checks[] }`. No I/O; unit-tested, incl. the recently-cleared heuristic.
- `api/runInspection.ts` — `runInspection(ro, knownVin)`: the reads (`readReadiness`,
  `readDtcs('03'|'07'|'0A')`, `readFreezeFrame`, `readValue('0131')`, `readIupr`, and `readVin` only
  when `knownVin` is null) built into an `InspectionInput` and assessed by `assessInspection`. It
  needs only those six standard-OBD2 reads, so the screen passes the `DiagnosticSession` and the AI
  agent passes its read-only facade.

## AI agent

- AI agent: `read_inspection` — `agent/agentTools.ts` contributes the tool (through `runInspection`
  on the read-only facade with the run's VIN; digest `Verdict: <verdict> (score N/100)` then one
  `<status>: <label> — <detail>` line per check, clamped with `… (N more)`; one finding
  `inspection:agent.finding.<verdict>` — pass `ok`, caution `info`, fail `warn` — with the score),
  the `used_car_check` procedure and the `used_car_check` skill to the
  [AI agent](./ai-diagnose.md#agent). Always offered (standard OBD2, CAN or K-line).

## model

- `inspectionStore` (Zustand): `report: InspectionReport | null`, `running`, `ranAt`,
  `ranFor` (the car the report was produced for, stamped by `set` with a report; the
  [vehicle report](./report.md) only uses a report stamped for its car). Not persisted —
  but a completed run can be saved to [`history`](./history.md) like an AI diagnose.

## Behavior

- Fully testable in the **simulator**: injecting DTCs / toggling readiness in Settings drives each
  verdict. Works on CAN and K-line (it only uses standard modes).
- Honest about scope: it never claims a clean result means a sound car.

## Acceptance

- A clean simulated car → **pass**, score 100.
- Injected stored DTC or simulated MIL → **fail**.
- Readiness reset with a short distance-since-clear and no codes → **caution** with the
  "possible recent code clear" check present.
