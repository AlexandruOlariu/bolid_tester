# Plan 17 — Trip detail: GPS polyline, overlays, GPS-vs-OBD check

**Size:** M (1–1½ days) · **Depends on:** nothing (16 links into it) · **Roadmap:** v0.4 "Trip
detail map"

## Goal

A trip opens on its own screen: the GPS track drawn as a polyline coloured by speed (or RPM, or
fuel rate), start/end markers, a scale bar, the GPS-vs-OBD distance and speed comparison with a
plain verdict, and a speed-over-time strip. Fully usable in the simulator through a synthetic
track, so no car is needed to build or test it.

## Why

`TripScreen.tsx` opens a trip inline and prints "Loaded N samples" plus two GPS lines. The track is
already recorded and round-trips through the CSV (`#TRACK` section) but is never drawn. The
GPS-vs-OBD comparison exists (`TripGpsStats.speedDeltaKmh`) but has no interpretation.

## Read first

- `src/shared/obd-core/analysis/trip.ts`: `TrackPoint { t, lat, lon, speed (m/s | null) }`, `Trip`,
  `TripSample`, `TripHeader`, `TripStats`, `TripGpsStats`, `haversineKm`, `trackDistanceKm`,
  `trackAverageSpeedKmh`, `tripStats`, `toCsv`, `fromCsv`, `trackFromCsv`, the private
  `obdDistanceKm(trip)`.
- `src/features/trip-recording/{api/trackRecorder.ts (startTrackCapture / stopTrackCapture /
isTrackCapturing, 5 s / 25 m cadence), hooks/useTripRecorder.ts (stopRecording, loadTripSamples,
deleteTrip, shareTrip; CSV at `${documentDirectory}trip-<id>.csv`), model/tripStore.ts
(TripSummary, `trips`), ui/TripScreen.tsx}`.
- `src/shared/ui/Gauge.tsx` (how `react-native-svg` is used today), `package.json`
  (`react-native-svg` 15.15.4 installed; `react-native-maps` **not** installed).
- `src/features/live-data/model/liveDataStore.ts` (`values['010D']` for the synthetic track speed).
- `src/shared/state/settingsStore.ts` (`adapterSource`), `src/app/_layout.tsx` hidden routes.
- `docs/features/trip-recording.md`.

## Design

### Map rendering decision: SVG polyline, no map tiles

`react-native-maps` needs a Google Maps API key and a config plugin on Android, adds a native
dependency to every build, and pulls tiles over the network. The product need is "see the shape of
the drive and where speed/RPM spiked", not street navigation. Decision: draw the track with
`react-native-svg` (already installed) on a plain themed background with a scale bar and a north
arrow. Zero keys, offline, deterministic, trivially unit-testable (pure projection). A tiled map can
be layered later behind the same `TrackMap` component if ever wanted.

### Pure helpers (`src/shared/obd-core/analysis/track.ts`, exported from `obd-core/index.ts`)

```ts
export interface Bounds {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}
export interface ProjectedPoint {
  x: number;
  y: number;
  i: number;
} // i = index into the track
export function trackBounds(track: TrackPoint[]): Bounds | null;
/** Equirectangular projection fitted into width×height with padding; preserves aspect (lon scaled by cos(latMid)); y flipped so north is up. */
export function projectTrack(
  track: TrackPoint[],
  width: number,
  height: number,
  padding?: number,
): ProjectedPoint[];
/** Metres per pixel at the fitted scale and a "nice" scale-bar length (100 m, 200 m, 500 m, 1 km, 2 km, 5 km). */
export function scaleBar(
  bounds: Bounds,
  width: number,
  padding?: number,
): { metresPerPx: number; barMetres: number; barPx: number };

export type OverlayChannel = 'speed' | 'rpm' | 'fuelRate' | 'none';
export interface TrackSegment {
  from: ProjectedPoint;
  to: ProjectedPoint;
  value: number | null;
  colour: string;
}
/** Nearest sample (by time, binary search) for each track point → channel value: speed from the GPS fix (m/s→km/h) with fallback to 010D; rpm = 010C; fuelRate = 015E. */
export function alignSamplesToTrack(
  track: TrackPoint[],
  samples: TripSample[],
  channel: OverlayChannel,
): (number | null)[];
/** Fixed buckets (metric): speed km/h [0,30) [30,60) [60,90) [90,130) 130+; rpm [0,1500) [1500,2500) [2500,3500) 3500+; fuelRate L/h quartiles of the trip. 5-step palette from the app accent (#2bb673) to red (#f85149); null → grey. */
export function colourSegments(
  points: ProjectedPoint[],
  values: (number | null)[],
  channel: OverlayChannel,
): TrackSegment[];
export function legendFor(
  channel: OverlayChannel,
  values: (number | null)[],
): { label: string; colour: string }[];

export interface GpsObdCheck {
  gpsKm: number;
  obdKm: number | null;
  deltaPct: number | null;
  gpsAvgKmh: number | null;
  obdAvgKmh: number | null;
  verdict: 'ok' | 'check' | 'mismatch' | 'unknown';
  note: string;
}
/** |delta| < 3 % → ok; < 8 % → check ("tyre size / speedo offset"); ≥ 8 % → mismatch ("odometer or sensor issue — compare with a second trip"); no OBD speed or < 2 fixes → unknown. */
export function gpsVsObd(
  track: TrackPoint[],
  samples: TripSample[],
  durationMs: number,
): GpsObdCheck;
/** Downsampled (max 300 points) speed-over-time series for the strip chart: { t, kmh }[] from 010D, falling back to GPS speed. */
export function speedProfile(
  samples: TripSample[],
  track: TrackPoint[],
  maxPoints?: number,
): { t: number; kmh: number }[];
```

Export `obdDistanceKm` from `trip.ts` (rename to `obdDistanceKmFromSamples(samples: TripSample[])`
and keep the old private name as a one-line wrapper) so `gpsVsObd` reuses the same integration.

### Loading a whole trip

`useTripRecorder.ts`: add `loadTrip(header: TripHeader): Promise<{ samples: TripSample[]; track:
TrackPoint[] }>` that reads the CSV once and runs both `fromCsv` and `trackFromCsv`; `loadTripSamples`
becomes `(await loadTrip(h)).samples`. Same error handling (`logError({ source: 'trip-recording',
context: { phase: 'csv-read' } })`).

### Synthetic track in the simulator (so the map is demoable without a car)

`trackRecorder.ts`: when `useSettingsStore.getState().adapterSource === 'mock'`,
`startTrackCapture()` starts a **synthetic** generator instead of `expo-location`: every 5 s push a
point along a deterministic closed loop (origin 44.4268 N, 26.1025 E; a 2 km rounded rectangle
parameterised by cumulative distance), advancing by `speedKmh / 3.6 * 5` metres where `speedKmh` is
the live `010D` value from `useLiveDataStore.getState().values` (default 40 when absent); `speed`
field = that value in m/s. Expose `isSyntheticTrack()` for the UI badge "simulated GPS". Pure part
`syntheticLoopPoint(distanceM): { lat, lon }` lives in `track.ts` and is tested.

### UI

- New hidden route `/trip-detail` (`src/app/trip-detail.tsx`, `Tabs.Screen name="trip-detail"
options={{ href: null, title: 'Trip' }}`), screen `src/features/trip-recording/ui/TripDetailScreen.tsx`
  reading `useLocalSearchParams<{ id: string }>()`; `TripScreen` rows get **Open** →
  `router.push({ pathname: '/trip-detail', params: { id } })` (remove the inline expand).
- `ui/TrackMap.tsx`: `Svg` sized to the container width (`onLayout`) with 3:2 aspect; background
  `$color2`; one `Line` per `TrackSegment` (stroke 4, round caps); `Circle` start (green) and end
  (red); scale bar + "N ↑" text; legend chips below; channel segmented control Speed · RPM · Fuel ·
  None; tap on the map → nearest projected point (within 24 px) shows a tooltip card (time, km/h,
  rpm, L/h). No gestures beyond tap in v1.
- Stats cards: duration, samples, OBD distance, GPS distance, delta % with verdict colour and
  `note`; speed strip (`SpeedStrip.tsx`, SVG polyline of `speedProfile`, metric axis labels).
- Empty states: no track → "No GPS track for this trip" + the stats that exist; no samples → the
  existing message.
- `TripScreen.tsx`: drop the `convert` import and `units` usage; format `km` and `km/h` directly
  (`toFixed(2)` / `toFixed(1)`), matching plan 07's metric-only decision.

## Steps

1. `track.ts` + `track.test.ts`; export `obdDistanceKmFromSamples`.
2. `loadTrip`; synthetic track generator + `isSyntheticTrack`.
3. `TrackMap.tsx`, `SpeedStrip.tsx`, `TripDetailScreen.tsx`, route, `TripScreen` changes.
4. Docs; `npm run ci`.

## Simulator

Settings → Simulator → Trips → Record for 60 s with Live open (speed varies in the Golf scenario) →
Stop → Open: a loop-shaped track coloured by speed, "simulated GPS" badge, GPS-vs-OBD verdict `ok`
(both derive from the same speed), speed strip with ~12 points.

## Tests

- `track.test.ts`: `projectTrack` fits a 2-point track to the padded box and flips y (north up);
  `scaleBar` picks `500 m` for a ~2 km-wide bounds at 320 px; `alignSamplesToTrack` picks the
  nearest sample by time (before/after ties → earlier); `colourSegments` yields n−1 segments and
  grey for null; `gpsVsObd` verdicts at 2 %, 5 %, 12 % and `unknown` with one fix; `speedProfile`
  caps at `maxPoints`; `syntheticLoopPoint(0)` equals `syntheticLoopPoint(loopLength)` within 1 m.
- `trip.test.ts`: `obdDistanceKmFromSamples` equals the previous `tripStats().distanceKm` on the
  existing fixture.
- `trackRecorder.test.ts` (exists): add "mock adapter source → synthetic points advance with
  speed; real source path unchanged".

## Docs

- `docs/features/trip-recording.md`: Trip detail section (map decision, overlays, verdict rules,
  synthetic GPS in the simulator, `loadTrip`); remove the units sentence.
- `docs/simulator.md`: synthetic GPS track note.

## Acceptance

- [ ] Simulator trip with ≥ 10 fixes renders a closed loop; switching the overlay recolours
      segments and updates the legend.
- [ ] Tap on the track shows a tooltip with time, km/h, rpm.
- [ ] GPS-vs-OBD card shows both distances, delta %, and a verdict with the note.
- [ ] A trip recorded before this change (no `#TRACK` section) opens with "No GPS track" and the
      stats; nothing crashes.
- [ ] `TripScreen` no longer imports `@/shared/lib/units`; `npm run ci` green.

## Out of scope

Map tiles / street names; gestures (pinch/pan) on the map; exporting the map as an image; GPX
export (could reuse `track` in a later item).

## Deferred until an on-car session

Validating the 3 % / 8 % thresholds against the Golf (known-good odometer) — adjust the constants
in `track.ts` after one real recorded trip; everything else is simulator-complete.
