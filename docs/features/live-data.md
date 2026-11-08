# Feature: live-data

Stream and display live engine parameters (Mode 01 PIDs).

## UI

- **DashboardScreen** — a grid of **gauges / value cards** (RPM, speed, coolant, MAP/boost, IAT,
  load, voltage, …). Uses `react-native-svg` gauges from `shared/ui`.
- Per-card unit + min/max; smooth updates.
- Every supported sensor grouped by system is the separate **Sensor readings** screen
  ([sensor-readings](./sensor-readings.md)) until plan 07 folds it in here as an "All sensors" view.

## hooks

- `useLiveData(pids?)` (`hooks/useLiveData.ts`) — subscribes to the shared live snapshot
  (`values`, `polling`) and, while mounted, **registers the screen's PID interest** on
  `liveDataStore` via `acquire(id, pids)`; unmounting releases it. With `pids` it registers exactly
  that set (the Dashboard passes its visible items plus the fuel-economy PIDs); without it, the
  **effective PID set** `session.effectivePids(profile.supportedPids)` — the ECU's supported-PID
  bitmap intersected with the profile list (for `generic`, just what the ECU reports). It does not
  spawn a poll loop of its own, and there is no service layer in this slice.

## model

- `liveDataStore` (`model/liveDataStore.ts`, Zustand, not persisted):
  - `values: Record<string, LiveValue>`, where `LiveValue` is `{ pid, name, unit, value, ts }`
    from `DiagnosticSession`;
  - `polling: boolean`;
  - `registrations: Record<string, string[]>`, the PID interest per subscriber id;
  - `setValues`, `setPolling`, `acquire(id, pids)` (returns an idempotent release) and
    `release(id)`.

  EngineHost writes `values` and `polling`; screens only read them.

- `dashboardLayoutStore` (`model/dashboardLayoutStore.ts`, persisted as `bolid.dashboard-layout`,
  version 1): per-profile **Customize** overrides — an explicit order and a hidden set keyed by a
  stable item id. The ordering / visibility math is pure in `model/dashboardLayout.ts`
  (`orderItems`, `visibleItems`, `moveInOrder`, `toggleInSet`), unit-tested.

## Behavior

- **The single poll loop lives in the app-wide `EngineHost`** (mounted once in `_layout.tsx`, see
  [engine-host](./engine-host.md)), not in this feature. It polls the demand-driven union of: PIDs
  registered by mounted screens, PIDs enabled alert rules reference, and (while recording) the trip
  PID set. Exactly one sweep per interval
  (`pollIntervalMs` from settings) regardless of how many screens are mounted; an empty union with
  no recording idles with no bus traffic. Timing is period-not-gap (the sweep's elapsed time is
  subtracted from the interval), so a slow **K-line** sweep that exceeds the interval simply runs
  back to back and the bus sets the pace.
- Each sweep is `session.pollOnce(pids)`: on **CAN** Mode 01 PIDs are batched up to six per request
  (a chunk that cannot be parsed falls back to one-by-one reads); on K-line every PID is read
  singly.
- Only PIDs the ECU reports as supported are polled (the effective PID set). A PID that gives no
  answer in a sweep is simply absent from that sweep's snapshot; it is not dropped from later
  sweeps.

## Acceptance

- Against the simulator, shows realistic idle values for each example car (e.g. Golf RPM ~820).
- Only renders PIDs the (simulated or real) ECU reports as supported.
- Remains responsive on a slow (K-line) link.
