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
- `startGuidedRoutine` — enter diagnostic session, then `31 01 <id>` or `2F … 03`.
- `stopGuidedRoutine` — best-effort `31 02` / `2F … 00`; never throws (stop must always be safe).
- `guidedRoutineResults` — `31 03 <id>` (31-routines only).

## Feature
- `routineService` — fail-closed interlock checks from standard Mode 01 (RPM/speed — works on any
  car) plus `checkInterlocksDuringRun` (switches to the functional address and back around the
  reads); start/stop with `ATSH`/`ATCRA` addressing (**both** restored via
  `session.resetAddressing()`), keep-alive, live-value reads of the routine's `liveDids`.
- `useRoutines()` — one routine at a time; a single periodic tick drives keep-alive → live
  values → interlock re-check (deterministic ordering, auto-stop + explicit message on
  violation); unmount stops any active routine; unlock switch gates every start; interlock
  failures render as an explicit "blocked" list, not an error.
- **RoutinesScreen** — unlock switch, per routine: description, two-step confirm ("Check
  interlocks & start"), live values + stop while running.
- Profiles gain `routines?: GuidedRoutine[]`. The Golf ships: stationary DPF regen (31, requires
  idle + stationary), intake flap adaptation (31, idle), EGR valve output test (2F, engine off —
  intentionally *blocked* in the simulator, whose engine always idles, to exercise the interlock UX).

## Simulator
`2F` echoes positive (`6F`); `31` already echoed positive; live DIDs reuse the profile's seeded
extended PIDs. The whole start → live values → stop loop runs risk-free, including the blocked-
interlock path.

## Acceptance
- Golf simulator: DPF regen and flap adaptation pass interlocks (sim idles at ~820 rpm,
  0 km/h), start, stream live values, stop cleanly. The EGR output test is blocked with the
  honest "engine must be OFF" message. Locked (default): no start control reachable.
- Passat/Punto: honest unavailability note.
