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
So **many not-ready monitors + no stored codes + a tiny "distance since codes cleared"** (Mode 01 PID
31) is a classic tell that something was wiped. The inspection surfaces this explicitly as a caution.

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
- `useInspection()` — orchestrates the reads (`readReadiness`, `readDtcs('03'|'07'|'0A')`,
  `readFreezeFrame`, `readValue('0131')`, VIN from the session), builds an `InspectionInput`, calls
  `assessInspection`, stores the report, exposes `{ run, report, running }`.

## api (core)
- Pure logic in [`obd-core/analysis/inspection`](../architecture.md) — `assessInspection(input)` →
  `{ verdict, score, checks[] }`. No I/O; unit-tested, incl. the recently-cleared heuristic.

## model
- `inspectionStore` (Zustand): `report: InspectionReport | null`, `running`, `ranAt`. Not persisted —
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
