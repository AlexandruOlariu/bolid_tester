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

## Interactions
Gestures use the built-in React Native Gesture Responder System (`PanResponder`) — **no new
dependency**:
- **Pinch to zoom** the time window between **10 s and 10 min** (two-finger distance scales
  `windowMs`; fingers apart = zoom in).
- **Drag to pan** the window's end back/forward through the buffer (one-finger horizontal drag →
  `endOffsetMs`, clamped to the data actually held; a **Back to live** button resets it).
- **Tap to inspect** — a near-stationary tap snaps to the nearest sample in the already-decimated
  series and shows its exact value + time, with a marker on the line.

Gesture inputs live in refs and `setState` is time-throttled (~30 Hz) so panning/zooming stays smooth.
`chartBuffer.window(windowMs, end)` already accepts an end time (pan); `chartBuffer.bounds()` exposes
the buffered time span so the pan can be clamped.

## Sharing
- **Share window (CSV)** — the current window's decimated series is written to a CSV file
  (`seriesToCsv`, pure + tested; long format `pid,timestamp_iso,epoch_ms,value`) and sent via the OS
  share sheet (`expo-sharing`). PNG export would require a new native dependency and is deferred; CSV
  is the share format for now.

## hooks
- `useChartSeries(pids, window, maxPoints?, endOffsetMs?)` — maintains a downsampled ring buffer per
  PID off the session snapshot; returns plot-ready series, per-series stats, and `oldestOffsetMs`
  (how far back data exists, for clamping the pan). `endOffsetMs` shifts the window end for pan/scrub.
- `useChartExport()` — `shareCsv(baseName, series)`; dependency-tolerant no-op without
  file-system/sharing (tests, web).
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
