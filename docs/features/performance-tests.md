# Feature: performance-tests

Measure vehicle performance from live OBD2 data: **0–100 km/h** (and 0–60 mph), custom speed
intervals, **standing ¼-mile / 60 ft**, and a **braking** test (e.g. 100–0 km/h distance/time). On
brand for "bolid" — a track/performance companion built on the existing poll loop.

> ⚠️ **For closed-course / track use.** The app must show a safety notice and require a passenger or
> a hands-free start. Results are estimates from ECU speed (and optional GPS); they are not
> certified instrumentation.

## Data sources
- **Primary:** vehicle speed PID `010D` (km/h, 1 Hz–ish from the ECU).
- **Optional GPS** (`expo-location`) for higher-rate speed/distance and to cross-check the ECU —
  fused when available, ECU-only otherwise (degrades gracefully).
- RPM `010C` for a shift/launch trace overlaid on the run.

## Tests
- **Acceleration:** 0→target (100 km/h, 60 mph, or custom), with split times (0–50, 50–100).
- **Distance:** 60 ft, ⅛-mile, ¼-mile elapsed time + trap speed.
- **Braking:** trigger above a start speed, measure time/distance to a stop (or to a target speed).
- **Rolling:** e.g. 80–120 km/h in-gear.

## UI
- **PerformanceScreen** — pick a test, see an **armed → launch-detected → running → result** state
  machine, a large live readout, and a result card (time, distance, trap speed, max accel).
- **Run history** — saved runs (reuses [`trip-recording`](./trip-recording.md) storage) with the
  speed/RPM trace on [`live-charts`](./live-charts.md); compare two runs.

## hooks
- `usePerformanceTest(config)` — arming, automatic launch detection (speed leaves 0 / crosses start
  threshold), high-rate sampling, and result computation; exposes the live state + final metrics.
- `usePerformanceHistory()` — list/compare/delete saved runs.

## api (service layer)
- `performanceService` — boosts the poll priority of `010D`/`010C` during a run, timestamps each
  sample, integrates speed→distance, and computes metrics. Optionally subscribes to GPS. No new
  device protocol — just scheduling + math on existing PIDs.

## model
- `performanceStore` (Zustand, persisted history): `{ type, config, samples, metrics }`.
- Config: units (km/h | mph), start/target thresholds, GPS on/off, rollout (1 ft) for drag times.

## Behavior
- Fully exercisable in the **simulator** by scripting a speed ramp scenario — arming, launch
  detection, and metric math all run with no hardware.
- Honest about sample rate: ECU speed is coarse (~1 Hz); the result card shows the effective sample
  rate and flags low-confidence runs. GPS, when present, tightens this.

## Acceptance
- A simulated 0→100 km/h ramp produces a plausible time with 0–50 / 50–100 splits.
- A run is saved, reopened, and its speed/RPM trace renders on the charts.
- With GPS disabled, the feature still produces a result from ECU speed alone.
