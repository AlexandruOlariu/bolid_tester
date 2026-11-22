# Feature: trip-recording

Record a drive as a typed **time-series** of live PIDs (plus DTC snapshots), persist it on the
device, replay it, and export it. This turns the live snapshot into durable history — distinct from
the Settings **adapter I/O log**, which is raw bytes for debugging, not decoded data for analysis.

## What it records

- A **session header**: start/end time, selected profile, VIN, negotiated protocol.
- A **sample stream**: for each poll tick, a timestamped row of the effective PID set's decoded
  values (the same snapshot the dashboard renders).
- **Markers**: DTC read/clear events and threshold-alert events (see [`alerts.md`](./alerts.md)) are
  stamped onto the timeline.
- An optional **GPS track**: a coarse foreground GPS trace (`expo-location`, ~5 s / ~25 m per fix)
  captured alongside the samples while recording. Absent when the module or permission is unavailable —
  recording is never blocked.

## UI

- **TripScreen** — a record/stop control with a live "N samples" indicator, plus the list of saved
  trips (date, duration, sample count, distance in km if speed was logged, marker count). Each row
  has **Open** (goes to the **Trip detail** screen, `/trip-detail?id=<trip id>` — see below),
  **Share CSV** (OS share sheet), and **Delete** (removes the summary and its CSV). The list
  survives app restart.
- **Per-car filter** (plan 06): once trips from more than one car exist, chips above the list
  ("All cars (N)", then one per car with its count) filter it. A trip records the active car as
  `TripSummary.vehicleId` (registry or garage id); trips recorded before the garage existed have
  none and group by `header.profileId` (the profile that was selected — every trip has always
  recorded it), only a summary with neither lists under **Unknown car**, and a deleted garage
  car's trips list under **Removed car**.
  When the filtered car loses its last trip (or only one car is left, which hides the chips) the
  filter falls back to **All cars**, so the list never sticks on an empty filter.
- Everything is shown in metric units (km, km/h, rpm, L/h) — the app is metric only.

## Trip detail (plan 17)

`ui/TripDetailScreen.tsx`, hidden route `/trip-detail` (`src/app/trip-detail.tsx`, title "Trip"),
reading the trip id from `useLocalSearchParams<{ id }>()`. It reads the trip's CSV once
(`loadTrip`) and shows, top to bottom:

- **Stats cards** — duration, samples, OBD distance (km, integrated from `010D`), GPS distance (km).
  When the CSV is gone the cards fall back to the stored summary.
- **GPS vs OBD** card (only when the trip has a track) — both distances, the delta in % (OBD
  relative to GPS), both average speeds, and a plain verdict with a note (`gpsVsObd` in obd-core
  `analysis/track.ts`):

  | Verdict                         | Rule                                | Note shown                                                 |
  | ------------------------------- | ----------------------------------- | ---------------------------------------------------------- |
  | **Distances agree** (`ok`)      | delta under 3 % either way          | the speedometer reading looks right                        |
  | **Worth a check** (`check`)     | delta under 8 % either way          | usually a tyre size or speedometer offset                  |
  | **Mismatch** (`mismatch`)       | delta 8 % or more either way        | odometer or sensor issue — compare with a second trip      |
  | **Not enough data** (`unknown`) | fewer than 2 fixes, or no speed PID | needs at least two GPS fixes and the vehicle speed reading |

  The 3 % / 8 % constants (`GPS_OBD_OK_PCT`, `GPS_OBD_CHECK_PCT`) are provisional until one real
  Golf trip (known-good odometer) has been compared — see the plan's deferred section.

- **GPS track map** (`ui/TrackMap.tsx`). **Decision: an SVG polyline, no map tiles.**
  `react-native-maps` would need a Google Maps API key and a config plugin, add a native dependency
  to every build and pull tiles over the network; the need is "see the shape of the drive and where
  speed / RPM spiked", not navigation. So the track is drawn with `react-native-svg` (already
  installed) on a plain themed background (`$color2`), sized to the container width at 3:2:
  - an equirectangular projection fitted into the box with 16 px padding, longitude scaled by
    cos(mid-latitude) so shapes keep their aspect, north up (`projectTrack`);
  - one line per segment (stroke 4, round caps), coloured by the chosen **overlay** — a segmented
    control **Speed · RPM · Fuel · None**. Fixed metric buckets on a 5-step palette from the app
    accent (`#2bb673`) to red (`#f85149`): speed km/h [0,30) [30,60) [60,90) [90,130) 130+; RPM
    [0,1500) [1500,2500) [2500,3500) 3500+; fuel rate L/h by this trip's quartiles, rounded to the
    legend's 0.1 L/h and kept only when distinct (a steady fuel rate — every value equal, or a spread
    under 0.1 L/h — is one middle-colour bucket labelled with its value, never "all high"). A segment with
    no value draws grey (`colourSegments`); a legend of chips follows the overlay (`legendFor`,
    plus "No data" when a value is missing). Speed comes from the GPS fix (m/s → km/h) and falls
    back to `010D`; RPM is `010C`, fuel rate `015E` — each from the OBD sample nearest in time
    (`alignSamplesToTrack`, binary search, a tie picks the earlier sample);
  - start (green) and end (red) markers, a scale bar (100 m, 200 m, 500 m, 1 km, 2 km, 5 km … — the
    longest that fits a third of the width, `scaleBar`) and an "N ↑" north arrow;
  - **tap** near the track (within 24 px, `nearestPoint`) → a card with that fix's time (clock and
    `+m:ss` since the first fix), km/h, rpm and L/h. No pinch / pan in v1.

  A tiled map could later be layered behind the same `TrackMap` component if ever wanted.

- **Speed over time** (`ui/SpeedStrip.tsx`) — an SVG polyline of `speedProfile` (from `010D`,
  falling back to GPS speed; at most 300 points) with km/h and time axis labels.
- **Empty states** — a trip with no track (recorded before GPS existed — no `#TRACK` section — or
  without permission) shows "No GPS track for this trip." plus the stats that exist; a lone fix
  says it is not enough to draw; no samples on file shows "No samples on file for this trip."; an
  unknown id says the trip was not found. Nothing crashes on an old trip.
- **"simulated GPS"** badge when the track came from the simulator's synthetic loop
  (`TripSummary.syntheticTrack`, see GPS track below).

## hooks / feature API (`hooks/useTripRecorder.ts`)

- `useTripRecorder()` — a no-op kept for screen API stability; sample accumulation is owned app-wide
  by `EngineHost` (see Behavior).
- `stopRecording()` — stops the GPS capture and attaches its track (if any), builds the finished trip,
  writes `trip-<id>.csv` to `documentDirectory`, computes stats, and records the **summary** in
  `tripStore` (with `syntheticTrack: true` when the track was the simulator's).
- `loadTrip(header)` — reads the trip's CSV **once** and returns `{ samples, track }` (`fromCsv` +
  `trackFromCsv`); empty arrays when the file is missing/unreadable (best-effort, logged with
  `context: { phase: 'csv-read' }`). Used by the Trip detail screen.
- `loadTripSamples(header)` — `(await loadTrip(header)).samples`.
- `deleteTrip(id)` — deletes the CSV (`deleteAsync`, `idempotent: true`, best-effort with `logError`)
  then drops the summary from the store.
- `shareTrip(header)` — opens the OS share sheet (`expo-sharing`) for the trip's CSV.

Native modules (`expo-file-system/legacy` / `expo-sharing`) are loaded via variable specifiers so
the project builds and unit-tests without them present — the same dependency-tolerant pattern as
`useDtcExport` / `useErrorLogExport`. The file system is the **legacy** entry point: on this Expo
SDK the root `expo-file-system` has no `documentDirectory`, so the CSV would never be written on a
device. The backup ([backup](./backup.md)) reads and writes the same `trip-<id>.csv` files.

## GPS track (`api/trackRecorder.ts`)

- `startTrackCapture()` — wired to the **Record** button. Dynamically imports `expo-location` (variable
  specifier, mirroring `shared/notify`), requests **foreground** permission, and `watchPositionAsync`
  at balanced accuracy (~5 s / ~25 m), accumulating `TrackPoint[]` (`{ t, lat, lon, speed }`, speed in
  m/s or `null`).
- `stopTrackCapture()` — wired into `stopRecording()`; stops the watcher and returns the accumulated
  track, which is attached to the `Trip` **before** `toCsv` so it round-trips.
- **Degrades to no track** on a missing module, denied permission, or a watcher error: a single
  warning is logged (`logError`) and recording continues unaffected — the trip simply carries no track.
- **Synthetic GPS in the simulator** (plan 17): when `settingsStore.adapterSource === 'mock'`,
  `startTrackCapture()` touches no location service. It pushes a fix at the start and then every
  5 s along a deterministic closed loop — origin 44.4268 N, 26.1025 E, a 2 km rounded rectangle
  parameterised by distance (`syntheticLoopPoint(distanceM)` in obd-core `analysis/track.ts`) —
  advancing by the live `010D` speed (`liveDataStore`, 40 km/h when absent) times the elapsed time;
  the fix's `speed` is that value in m/s. Each step is taken as the **straight line** from the last
  fix (`syntheticLoopAdvance`), so where a 5 s step cuts one of the loop's 60 m-radius corners the
  GPS distance still equals the distance driven and the GPS-vs-OBD check reads `ok` at any steady
  speed (with arc-length steps a steady 90 km/h read over 3 % short). One lap is 2 km — about 3 min
  at 40 km/h; a shorter recording draws part of the loop (a 60 s one at 40 km/h is the first
  straight and a corner). `stopTrackCapture()` closes the track with a final fix at
  the stop time, so GPS and OBD distances cover the same span. `isSyntheticTrack()` reports whether
  the running (or last returned) capture was synthetic; `stopRecording` stores it on the summary
  and the detail screen badges the track "simulated GPS". The real-adapter path is unchanged.

## model (`model/tripStore.ts`)

- The **in-progress** recording (`samples`, `markers`) lives in memory only — a transient firehose
  that becomes a CSV on stop.
- What **persists** across launches is a lightweight `TripSummary[]` (`{ header, stats, markerCount,
vehicleId?, syntheticTrack? }`
  — NOT the samples), via the shared file storage under key `bolid.trips`. The full sample grid is
  read back from `trip-<id>.csv` on demand. This keeps the persisted JSON small regardless of drive
  length, and file I/O stays out of the store (no native imports).
- Persist writes are **debounced ~500 ms** (`debouncedStorage`) so a burst of adds/removes rewrites
  the file once, not once per mutation. Accepted loss window: up to ~500 ms of the most-recent list
  state on a hard kill (a just-finished trip re-derives nothing, but its summary could be lost — the
  CSV is already on disk regardless).

## CSV (`shared/obd-core/analysis/trip.ts`)

- `toCsv(trip)` — `t_ms,iso` prefix + one column per PID (union, sorted); empty cell = `null`. When the
  trip has a GPS track, a `#TRACK` section (`t_ms,iso,lat,lon,speed`) is appended after the samples.
- `fromCsv(csv)` — the inverse for the value grid (header + markers are not in the CSV; they live in
  the summary); it stops at the `#TRACK` marker, so the sample grid round-trips byte-for-byte and a
  track-less trip produces the exact old format. A header-only document yields `[]`.
- `trackFromCsv(csv)` — recovers the GPS track from the `#TRACK` section (`[]` for an old-format CSV).
- `tripStats(trip)` gains a `gps` block when a track is present: GPS distance (`trackDistanceKm`,
  haversine), GPS average speed, OBD average speed (integrated from `010D`), and their delta. Persisted
  in the trip summary, so the detail view's fallback reads it without the CSV. All unit-tested.
- `obdDistanceKmFromSamples(samples)` — the `010D` integration behind `tripStats().distanceKm`,
  exported so `gpsVsObd` uses exactly the same distance.
- `analysis/track.ts` — the pure trip-detail helpers: `trackBounds`, `projectTrack`, `scaleBar`,
  `nearestPoint`, `alignSamplesToTrack`, `colourSegments`, `legendFor`, `gpsVsObd`, `speedProfile`,
  `syntheticLoopPoint` (all covered by `track.test.ts`).

## Behavior

- **Sample accumulation is hosted app-wide by `EngineHost`** (mounted once in `_layout.tsx`): while
  `tripStore.recording`, each poll sweep appends a sample and the trip's effective PID set is added to
  the poll union — so a trip records fully even after the Trip screen unmounts and with no live screen
  open.
- Recording works identically against **BLE** and the **simulator**, since both feed the same session
  snapshot — so trips can be produced and replayed with no hardware.
- Recording survives PID poll failures: a missing PID logs as `null` for that tick rather than
  aborting the trip.

## AI agent

- AI agent: `list_trips`, `read_trip`, `read_fuel_economy` — `agent/agentTools.ts` contributes the
  three tools and the `trips` and `fuel_economy` skills to the [AI agent](./ai-diagnose.md#agent).
  All are always offered and read only the **active car's** trips (`tripCarKey(t) ===
getActiveProfile().id`, garage-aware); an empty list says `No trips recorded for this car.`
  - `list_trips` — the newest 10 trips (`LIST_TRIPS_MAX`), one line each:
    `<id> <yyyy-mm-dd hh:mm> <min> min, <km> km, max coolant <°C>, max rpm <rpm>, <L/100 km>`, then
    `… (N older trips)`. The average L/100 km is the stored `stats.fuel` when present, else
    `tripFuelAverage` over the trip's CSV samples with the car's fuel type (`no fuel data` when the
    trip logged neither `015E` nor `0110`). No adapter time (`costMs` 0).
  - `read_trip {id, pids?}` — per PID min / avg / max (default `0105`, `010C`, `010B`, `010D`, those
    the trip logged; a requested PID it did not log reads `not logged`), and on the coolant line
    the minutes from the first sample ≤ 40 °C to the first ≥ 80 °C (`warm-up 9 min`, `did not
reach 80 °C in N min`, or `started warm`). `id: "latest_cold"` picks the newest of this car's
    last 20 trips whose first `0105` sample is ≤ 40 °C. `data: { header, samples }` (for the
    cooling playbook). A foreign or missing id: `Trip <id> not found for this car.`; a
    `loadTripSamples` throw becomes an error digest; a trip whose CSV is gone says its samples
    were not saved.
  - `read_fuel_economy` — one live poll of `015E` / `0110` / `010D` through the read-only facade:
    instant L/100 km while moving, L/h at standstill (`fuelEconomyFromValues`, fuel rate preferred
    over the MAF estimate), then the last 5 trips' averages with their distance.

## Acceptance

- A simulator drive can be recorded, persisted, and its summary reopened after app restart; opening a
  trip lazy-loads its samples from the CSV; sharing exports the CSV; deleting removes both the summary
  and the CSV file.
- Exported CSV round-trips (`fromCsv(toCsv(t))` recovers the samples).
- A recorded GPS track round-trips through the CSV (`trackFromCsv(toCsv(t))`); a trip recorded without
  GPS is byte-for-byte the old format. A missing `expo-location` or denied permission degrades to a
  track-less trip without blocking recording.
- A simulator trip opens on Trip detail with a "simulated GPS" badge and an `ok` GPS-vs-OBD verdict
  at any steady speed; one recorded for a full lap (about 3 min at 40 km/h, 37 fixes) draws the
  closed loop; switching the overlay recolours the segments and
  updates the legend; a tap on the track shows time, km/h and rpm; a trip without a `#TRACK`
  section opens with "No GPS track" and its stats.
