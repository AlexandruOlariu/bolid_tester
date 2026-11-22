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

## Panels and keys (plan 14)

- A panel's `pids` are opaque live-value keys: a Mode 01 PID (`010C`) or an extended Mode 22 key
  (`22:1701`). The chart registers them with the poll loop itself (`useChartSeries` → `acquire`),
  so an extended DID keeps plotting with the Extended PIDs screen closed.
- **Add panel** opens a picker listing the effective Mode 01 PIDs (`session.effectivePids(...)`)
  and — on CAN with a profile that declares DIDs — every extended key, labelled `name (unit) · DID`
  (`chartKeyOptions`, `model/chartKeys.ts`, pure + tested). Up to four series per panel
  (`MAX_PANEL_SERIES`). Each panel has **Remove**.
- The panel header, stats lines and tap-inspect readout use `labelForLiveKey(key, extendedPids)`
  (`obd-core/obd/liveKeys.ts`) instead of raw keys: `Engine RPM (rpm)`, `DPF soot mass (calc.) (g)
· 1701`, `DID 1701` for a DID the active profile does not declare.
- A stale extended panel (e.g. the Golf's DID after switching to the Punto) stays on screen with
  "no data" but sends nothing: the poll loop keeps a DID only on CAN when the profile declares it.
- The Extended PIDs screen adds panels through **Chart this** / **Chart group**.
- The panel store lives in `src/shared/state/chartsStore.ts` (re-exported by
  `model/chartsStore.ts`): `panels`, `setPanels`, `setPanelPids`, `addPanel(pids, windowMs?)` (id
  `p<n>`, one past the highest in use; default window 60 s), `removePanel`. In memory only.

## Layout (plan 21)

- **Measured plot.** Each panel measures its plot area with `onLayout` and draws the SVG at that
  width (320 dp until the first layout); the height is `chartHeight(width)` = 3 : 8 of the width,
  capped at 220 dp (320 → 120, the old fixed size). The geometry is pure, in `api/chartGeometry.ts`:
  `toScreen(pts, w, h)` (time spans `[0, w]`, value `[h, 0]`), `msPerPx(windowMs, w)` (the drag-to-pan
  rate; the `PanResponder` reads the width from a ref like its other live inputs) and
  `chartHeight(w)`.
- **Side by side.** On medium / expanded windows (≥ 600 dp, `useLayoutClass`) the panels sit two
  per row (`testID="chart-panels-grid"`, each cell `flexBasis 49%`) and the screen uses the full
  width (`Screen wide`); on a phone in portrait they stack as before. Both layouts share one element
  tree (only the wrapper's direction and the cells' basis change), so rotating keeps every panel
  mounted with its zoom, pan and inspect state. A panel's action buttons wrap
  instead of overflowing a narrow half.
- **More panels.** Tablets have room for four or more: **Add panel** (the picker above) appends
  `p3`, `p4`, … like on a phone. Panels stay in memory only.

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
  (`seriesToCsv`, pure + tested; long format `pid,timestamp_iso,epoch_ms,value,label`) and sent via
  the OS share sheet (`expo-sharing`). `pid` is the live key (`010C`, `22:1701`); `label` is its
  human label (quoted when it contains a comma). Called without labels, `seriesToCsv` keeps the old
  four-column format. PNG export would require a new native dependency and is deferred; CSV
  is the share format for now.

## hooks

- `useChartSeries(pids, window, maxPoints?, endOffsetMs?)` — maintains a downsampled ring buffer per
  PID off the session snapshot; returns plot-ready series, per-series stats, and `oldestOffsetMs`
  (how far back data exists, for clamping the pan). `endOffsetMs` shifts the window end for pan/scrub.
  A value becomes a point only when its `ts` is newer than the buffer's last point
  (`ChartBuffer.pushIfNewer`): a re-render on pan / zoom, or a sweep that republishes a key's old
  value (Mode 01 failed while the extended DIDs answered), never adds a duplicate point or CSV row.
- `useChartExport()` — `shareCsv(baseName, series, labels?)` through `saveTextFile` (plan 28): the
  share sheet on a phone, a browser download on the web; null when there is nowhere to write.
- `useChartConfig()` — not built: panels live in the in-memory `chartsStore` (see model).

## api (service layer)

- No device I/O. A small `chartBuffer` util in the feature (or promoted to `shared/lib` if reused)
  ingests snapshots and decimates to a target point budget so charts stay smooth on long windows.

## model

- `chartsStore` (Zustand, shared, in memory — persistence is not built yet): panel definitions
  `{ id, pids, windowMs }`. Series buffers are
  ephemeral (not persisted) for the live view; trip view reads from `tripStore`.

## Behavior

- Uses an SVG charting approach consistent with the existing `react-native-svg` gauges (a light
  custom line renderer or a thin RN charting lib), so it works on device and in the simulator.
- Decimation keeps a fixed point budget regardless of window length → stable frame rate.

## Acceptance

- A panel plots at 320 × 120 until measured and then at its measured width (400 → 400 × 150,
  600 → 600 × 220); a 1280 dp window lays the default panels out side by side, a phone stacks them,
  and rotating a phone to landscape keeps the panels mounted (`ChartsScreen.test.tsx`); `chartGeometry.test.ts` covers `toScreen` / `msPerPx` / `chartHeight`.
- Golf simulator: **Add panel** → pick "DPF soot mass (calc.) (g) · 1701" → the line and its stats
  update every sweep without the Extended PIDs screen open (`ChartsScreen.test.tsx`).
- Punto simulator: the picker offers no DIDs; a stale `22:` panel sends no `22` request.
- CSV export of a mixed panel carries the key and the label of every row.
- In the simulator, coolant temperature plotted over time shows a rising warm-up curve.
- Two PIDs can be overlaid; switching to X–Y mode plots one against the other.
- The same panel renders a recorded trip with a working scrubber.
