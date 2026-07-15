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
  trips (date, duration, sample count, distance if speed was logged, marker count). Each row has
  **Open** (lazy-loads the samples from the CSV and shows how many were read), **Share CSV** (OS
  share sheet), and **Delete** (removes the summary and its CSV). The list survives app restart.
- When a trip has a **GPS track**, its opened detail additionally shows the GPS distance and the
  OBD-vs-GPS average-speed delta (a classic odometer/clone sanity check).
- Displayed distances and speeds honour the Settings **units** choice (metric/imperial), converted at
  display time via [`shared/lib/units.ts`](../../src/shared/lib/units.ts); the stored data stays
  canonical metric.

## hooks / feature API (`hooks/useTripRecorder.ts`)
- `useTripRecorder()` — a no-op kept for screen API stability; sample accumulation is owned app-wide
  by `EngineHost` (see Behavior).
- `stopRecording()` — stops the GPS capture and attaches its track (if any), builds the finished trip,
  writes `trip-<id>.csv` to `documentDirectory`, computes stats, and records the **summary** in
  `tripStore`.
- `loadTripSamples(header)` — lazy-loads a trip's samples from its CSV (`fromCsv`); returns `[]` when
  the file is missing/unreadable (best-effort, logged).
- `deleteTrip(id)` — deletes the CSV (`deleteAsync`, `idempotent: true`, best-effort with `logError`)
  then drops the summary from the store.
- `shareTrip(header)` — opens the OS share sheet (`expo-sharing`) for the trip's CSV.

Native modules (`expo-file-system` / `expo-sharing`) are loaded via variable specifiers so the
project builds and unit-tests without them present — the same dependency-tolerant pattern as
`useDtcExport` / `useErrorLogExport`.

## GPS track (`api/trackRecorder.ts`)
- `startTrackCapture()` — wired to the **Record** button. Dynamically imports `expo-location` (variable
  specifier, mirroring `shared/notify`), requests **foreground** permission, and `watchPositionAsync`
  at balanced accuracy (~5 s / ~25 m), accumulating `TrackPoint[]` (`{ t, lat, lon, speed }`, speed in
  m/s or `null`).
- `stopTrackCapture()` — wired into `stopRecording()`; stops the watcher and returns the accumulated
  track, which is attached to the `Trip` **before** `toCsv` so it round-trips.
- **Degrades to no track** on a missing module, denied permission, or a watcher error: a single
  warning is logged (`logError`) and recording continues unaffected — the trip simply carries no track.

## model (`model/tripStore.ts`)
- The **in-progress** recording (`samples`, `markers`) lives in memory only — a transient firehose
  that becomes a CSV on stop.
- What **persists** across launches is a lightweight `TripSummary[]` (`{ header, stats, markerCount }`
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
  in the trip summary, so the detail view reads it without re-loading the track. All unit-tested.

## Behavior
- **Sample accumulation is hosted app-wide by `EngineHost`** (mounted once in `_layout.tsx`): while
  `tripStore.recording`, each poll sweep appends a sample and the trip's effective PID set is added to
  the poll union — so a trip records fully even after the Trip screen unmounts and with no live screen
  open.
- Recording works identically against **BLE** and the **simulator**, since both feed the same session
  snapshot — so trips can be produced and replayed with no hardware.
- Recording survives PID poll failures: a missing PID logs as `null` for that tick rather than
  aborting the trip.

## Acceptance
- A simulator drive can be recorded, persisted, and its summary reopened after app restart; opening a
  trip lazy-loads its samples from the CSV; sharing exports the CSV; deleting removes both the summary
  and the CSV file.
- Exported CSV round-trips (`fromCsv(toCsv(t))` recovers the samples).
- A recorded GPS track round-trips through the CSV (`trackFromCsv(toCsv(t))`); a trip recorded without
  GPS is byte-for-byte the old format. A missing `expo-location` or denied permission degrades to a
  track-less trip without blocking recording.
