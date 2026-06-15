# Feature: live-charts

Plot live PIDs over **time** (line charts) alongside the gauges in [`live-data`](./live-data.md), and
render the same charts for a recorded [`trip`](./trip-recording.md). Gauges answer "what is it now?";
charts answer "how is it changing?" — warm-up curves, boost vs RPM, fuel-trim drift.

## UI
- **ChartsScreen** — one or more time-series panels. Each panel:
  - A PID picker (from the effective PID set) — single or a small multi-series overlay with a shared
    or dual Y-axis.
  - A rolling time window (e.g. last 30 s / 1 / 5 min) with auto-scaling Y.
  - Min / max / current readout per series.
- An **X–Y mode** for relationships (e.g. boost vs RPM) rather than vs time.
- Renders from the live stream, or — when opened from a trip — from the stored samples with a
  scrubber.

## hooks
- `useChartSeries(pids, window)` — maintains a downsampled ring buffer per PID off the session
  snapshot; returns plot-ready series + per-series stats.
- `useChartConfig()` — persisted panel/PID/window selections.

## api (service layer)
- No device I/O. A small `chartBuffer` util in the feature (or promoted to `shared/lib` if reused)
  ingests snapshots and decimates to a target point budget so charts stay smooth on long windows.

## model
- `chartsStore` (Zustand, persisted): panel definitions `{ pids, window, mode }`. Series buffers are
  ephemeral (not persisted) for the live view; trip view reads from `tripStore`.

## Behavior
- Uses an SVG charting approach consistent with the existing `react-native-svg` gauges (a light
  custom line renderer or a thin RN charting lib), so it works on device and in the simulator.
- Decimation keeps a fixed point budget regardless of window length → stable frame rate.

## Acceptance
- In the simulator, coolant temperature plotted over time shows a rising warm-up curve.
- Two PIDs can be overlaid; switching to X–Y mode plots one against the other.
- The same panel renders a recorded trip with a working scrubber.
