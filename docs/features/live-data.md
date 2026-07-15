# Feature: live-data

Stream and display live engine parameters (Mode 01 PIDs).

## UI
- **DashboardScreen** — a grid of **gauges / value cards** (RPM, speed, coolant, MAP/boost, IAT,
  load, voltage, …). Uses `react-native-svg` gauges from `shared/ui`.
- Per-card unit + min/max; smooth updates.

## hooks
- `useLiveData()` — subscribes to the shared live snapshot and, while mounted, **registers the
  screen's PID interest** (its effective PID set) on `liveDataStore` via `acquire(id, pids)`. It no
  longer spawns a poll loop of its own.
- `usePidPolling(pids)` — controls which PIDs are polled and the interval.

## api (service layer)
- `liveDataService` — given the active profile and the car's supported-PID bitmap, computes the
  **effective PID set** (intersection of profile `supportedPids` and what the ECU reports; for
  `generic`, just what the ECU reports) and drives the session's round-robin poll loop.

## model
- `liveDataStore` (Zustand): `values: Record<Pid, { value, unit, ts }>`, `polling: boolean`.

## Behavior
- **The single poll loop lives in the app-wide `EngineHost`** (mounted once in `_layout.tsx`), not in
  this feature. It polls the demand-driven union of: PIDs registered by mounted screens, PIDs enabled
  alert rules reference, and (while recording) the trip PID set. Exactly one sweep per interval
  regardless of how many screens are mounted; an empty union with no recording idles with no bus
  traffic. Timing is period-not-gap (the sweep's elapsed time is subtracted from the interval).
- Poll PIDs as fast as the link allows. **CAN** cars poll quickly; **K-line** cars (Passat) poll
  slowly and with fewer PIDs — the loop adapts to response latency.
- A PID that returns `NO DATA` is dropped from the rotation and marked unsupported.
- Values older than a threshold are shown as stale.

## Acceptance
- Against the simulator, shows realistic idle values for each example car (e.g. Golf RPM ~820).
- Only renders PIDs the (simulated or real) ECU reports as supported.
- Remains responsive on a slow (K-line) link.
