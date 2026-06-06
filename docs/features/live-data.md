# Feature: live-data

Stream and display live engine parameters (Mode 01 PIDs).

## UI
- **DashboardScreen** — a grid of **gauges / value cards** (RPM, speed, coolant, MAP/boost, IAT,
  load, voltage, …). Uses `react-native-svg` gauges from `shared/ui`.
- Per-card unit + min/max; smooth updates.

## hooks
- `useLiveData()` — subscribes to the session's live snapshot; returns the latest typed values and
  staleness.
- `usePidPolling(pids)` — controls which PIDs are polled and the interval.

## api (service layer)
- `liveDataService` — given the active profile and the car's supported-PID bitmap, computes the
  **effective PID set** (intersection of profile `supportedPids` and what the ECU reports; for
  `generic`, just what the ECU reports) and drives the session's round-robin poll loop.

## model
- `liveDataStore` (Zustand): `values: Record<Pid, { value, unit, ts }>`, `polling: boolean`.

## Behavior
- Poll PIDs round-robin as fast as the link allows. **CAN** cars poll quickly; **K-line** cars
  (Passat) poll slowly and with fewer PIDs — the loop adapts to response latency.
- A PID that returns `NO DATA` is dropped from the rotation and marked unsupported.
- Values older than a threshold are shown as stale.

## Acceptance
- Against the simulator, shows realistic idle values for each example car (e.g. Golf RPM ~820).
- Only renders PIDs the (simulated or real) ECU reports as supported.
- Remains responsive on a slow (K-line) link.
