# Feature: routines — output tests & basic settings (experimental, write-capable, gated)

VCDS-style **output tests** (UDS `2F` InputOutputControlByIdentifier) and **basic settings**
(UDS `31` RoutineControl) as *guided* routines: each one ships with a description of what it does,
live **interlocks** (engine off / at idle / vehicle stationary) checked immediately before
starting **and re-checked continuously while the routine runs** (violation = auto-stop),
TesterPresent keep-alive, live values while running, and a prominent stop that returns control to
the ECU. Interlocks **fail closed**: if the RPM or speed needed by a rule cannot be read, the
routine is blocked — an unreadable value never passes a safety check. The flagship basic setting
is the **stationary DPF service regeneration** the read-only [dpf](./dpf.md) monitor deliberately
excluded.

> ⚠️ **DANGER / EXPERIMENTAL.** Routine IDs / IO DIDs are per-module and NOT standardized; the
> shipped Golf entries are **illustrative** and must be confirmed on the real car. Actuating
> components can be dangerous — interlocks are enforced from live data, not trusted from the user.
> CAN/UDS only: VAG basic settings on K-line cars live behind KWP1281, which a generic ELM327
> cannot speak. Airbag/immobilizer/cluster-mileage routines are never offered.

## Core (`obd-core/uds/guidedRoutine.ts`, unit-tested)
- `startOutputControl` / `stopOutputControl` — `2F <did> 03 <data>` / `2F <did> 00`.
- `startGuidedRoutine` — enter diagnostic session, **optionally `0x27` SecurityAccess**, then
  `31 01 <id>` or `2F … 03`. Security runs only when the descriptor supplies a `seedToKey`
  algorithm; a bare `level` (all a profile can declare today) is *not* enough to unlock, so the
  routine is attempted unlocked and the ECU decides (NRC `0x33` if it needed access).
- `stopGuidedRoutine` — best-effort `31 02` / `2F … 00`; never throws (stop must always be safe).
- `guidedRoutineResults` — `31 03 <id>` (31-routines only).
- Negative responses are named, not just numbered: `checkNegative` labels the NRC via `nrcName`
  (`Negative response: securityAccessDenied (NRC 0x33)`).

## Feature
- `routineService` — fail-closed interlock checks from standard Mode 01 (RPM/speed — works on any
  car) plus `checkInterlocksDuringRun` (switches to the functional address and back around the
  reads); start/stop with `ATSH`/`ATCRA` addressing (**both** restored via
  `session.resetAddressing()`), keep-alive, live-value reads of the routine's `liveDids`. Passes the
  profile routine's `security` through to the core start.
- `describeRoutineFailure(err, routine)` — turns a start NRC into on-car guidance, because routine
  IDs and security requirements in the shipped profiles are **unverified placeholders**: `0x33` →
  "needs security access this app doesn't carry"; `0x11/0x12/0x31/0x7E/0x7F` → "this routine ID is
  unverified for your car — confirm it from a VCDS Basic Settings session / UDS capture"; `0x22/0x24`
  → "conditions not correct — warm engine, steady idle, no active faults". Surfaced by `useRoutines`
  in place of the raw error.
- `useRoutines()` — one routine at a time; a single periodic tick drives keep-alive → live
  values → interlock re-check (deterministic ordering, auto-stop + explicit message on
  violation); unmount stops any active routine; unlock switch gates every start; interlock
  failures render as an explicit "blocked" list, not an error.
- **RoutinesScreen** — unlock switch, per routine: description, two-step confirm ("Check
  interlocks & start"), live values + stop while running.
- Profiles gain `routines?: GuidedRoutine[]`. The Golf ships: stationary DPF regen (31, requires
  idle + stationary), **Intake Manifold Runner/Motor (V157) adaptation** (VCDS Basic Settings
  Group 121 — the flap end-stop re-learn and the P2015/08213 fix check), EGR valve output test (2F,
  engine off — intentionally *blocked* in the simulator, whose engine always idles, to exercise the
  interlock UX).
- A routine may declare `vcdsGroup` (the VCDS measuring-block group it maps to, cross-reference
  only) and `unavailableReason`. When `unavailableReason` is set the UI leads with it and demotes
  start to "attempt anyway (unverified)" — the same honest pattern as `ServiceReset.obdUnreachable`.

## Confirming a routine on the real car (the placeholder problem)
The shipped routine IDs (e.g. Golf flap `0301`) are **illustrative** and the *mechanism* itself may
be wrong: VCDS drives the Golf flap adaptation as a measuring-block **Basic Settings on Group 121**
(label file `03L-906-022-CBA.CLB`, component "Intake Manifold Runner/Motor (V157)"), which on this
PQ35 car most likely rides on **VW TP2.0 / KWP** — a generic ELM327 cannot drive it and the app's
TP2.0 transport is not built yet. Crucially, VCDS hides the raw bus request behind its label file,
so the Basic-Settings screen does **not** reveal the actual `31 01 <id>` / KWP sequence.

To capture the real sequence: run the in-app **Bus Sniffer** (`ATMA` monitor) while VCDS performs
the Group 121 basic setting, read off the frames on `7E0→7E8` (or the TP2.0 channel), then set the
profile routine's transport/`id` and — if the ECU demands it — a `security: { level, seedToKey }`.
Until then the app runs the flow in the simulator and, on the real car, reports exactly why the ECU
refused (`describeRoutineFailure`).

## Simulator
`2F` echoes positive (`6F`); `31` already echoed positive; live DIDs reuse the profile's seeded
extended PIDs. The whole start → live values → stop loop runs risk-free, including the blocked-
interlock path.

## Acceptance
- Golf simulator: DPF regen passes interlocks (sim idles at ~820 rpm, 0 km/h), starts, streams
  live values, stops cleanly. The V157 flap adaptation leads with its `unavailableReason` and its
  start is demoted to "attempt anyway (unverified)"; if attempted it still runs risk-free in the
  simulator (position/potentiometer live DIDs). The EGR output test is blocked with the honest
  "engine must be OFF" message. Locked (default): no start control reachable.
- Passat/Punto: honest unavailability note.
