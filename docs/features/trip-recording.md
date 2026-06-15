# Feature: trip-recording

Record a drive as a typed **time-series** of live PIDs (plus DTC snapshots), persist it on the
device, replay it, and export it. This turns the live snapshot into durable history — distinct from
the Settings **adapter I/O log**, which is raw bytes for debugging, not decoded data for analysis.

## What it records
- A **session header**: start/end time, selected profile, VIN, negotiated protocol, adapter version.
- A **sample stream**: for each poll tick, a timestamped row of the effective PID set's decoded
  values (the same snapshot the dashboard renders).
- **Markers**: DTC read/clear events and threshold-alert events (see [`alerts.md`](./alerts.md)) are
  stamped onto the timeline.

## UI
- **TripListScreen** — saved trips (date, duration, car, distance if speed was logged, # of alerts).
  Open / share / delete per row.
- **TripDetailScreen** — summary stats + the [`live-charts`](./live-charts.md) view bound to the
  recorded series instead of the live stream; a scrubber to replay.
- **Record control** — a record/stop affordance on the dashboard with an "is recording" indicator.

## hooks
- `useTripRecorder()` — start/stop; exposes recording status, elapsed time, sample count.
- `useTrips()` — list/load/delete persisted trips.
- `useTripReplay(tripId)` — drives the dashboard/charts from a stored trip (reuses the live-data
  rendering path).

## api (service layer)
- `tripService` — subscribes to the `DiagnosticSession` snapshot stream, appends ring-buffered
  samples, and on stop writes a compact trip record. Export to **CSV** (one column per PID) and
  **JSON** (full record incl. header + markers). No device I/O of its own.

## model
- `tripStore` (Zustand, persisted index) + on-disk trip blobs (e.g. `expo-file-system`). A trip:
  `{ id, header, samples: Sample[], markers: Marker[] }`.
- Sampling is decoupled from poll rate via a configurable record interval (downsample to keep blobs
  small on long drives).

## Behavior
- Recording works identically against **BLE** and the **simulator**, since both feed the same
  session snapshot — so trips can be produced and replayed with no hardware.
- Recording survives PID poll failures: a missing PID logs as `null` for that tick rather than
  aborting the trip.

## Acceptance
- A simulator drive can be recorded, persisted, reopened after app restart, replayed on the charts,
  and exported to CSV/JSON.
- Exported CSV round-trips (header + every recorded PID column present).
