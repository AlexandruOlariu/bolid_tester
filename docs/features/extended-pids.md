# Feature: extended-pids (experimental, flagged)

Profile-driven **manufacturer-specific** reads via **Mode 22** (UDS `readDataByIdentifier`). **VAG is
the first example.** This is opt-in and clearly marked experimental.

> ⚠️ **Experimental.** Manufacturer DIDs are **not standardized**. The example DIDs shipped in the
> profiles are **illustrative** and must be **confirmed on the real car** before the values are
> trusted. The simulator returns canned values so the feature can be exercised end-to-end without
> hardware.

## Applicability
- Only **CAN/UDS-capable** cars can answer Mode 22. In our examples that means the **Golf Plus 2009**.
- The **Passat B5.5** and older **Punto** are **K-line/KWP2000** — Mode 22 does **not** apply; their
  profiles declare no extended PIDs. (Genuine VAG extra data there needs VCDS-style measuring blocks,
  which a generic ELM327 cannot read.)

## UI
- **ExtendedPidsScreen** — only shown when the active profile declares `extendedPids` **and** the link
  is CAN. Each row: a **select toggle** (for logging), name, value, an "experimental / unverified"
  badge, and the raw DID + response.
- **Measuring-block log** card — start/stop a recording of the selected DIDs over time (see below).
- Arriving from a fault-code **Guide** deep-link (`/extended?dids=1708,1701`) pre-selects and reads
  those DIDs, and highlights their rows ("from guide"). See [fault-codes](./fault-codes.md).

## Measuring-block logging (6b.6)
VCDS's "Log" button for module DIDs. While on the screen, tick the DIDs to record, press **Start
log**, and the app samples the selected DIDs once per second, buffering `{t, did, name, value, unit}`
rows at **module scope** (`api/measuringLog.ts`) so a long recording never re-renders the list — only
a small sweep counter updates. **Stop & share CSV** writes the log to `documentDirectory` and opens
the OS share sheet via the same dependency-tolerant `expo-file-system` / `expo-sharing` pattern the
DTC export and trip recorder use.
- **CSV columns:** `timestamp_iso, epoch_ms, did, name, value, unit`. Rows are sorted by time then
  DID; a null value (no data that sweep) is an empty field. The builder (`buildMeasuringLogCsv`) is
  pure and unit-tested.
- Recording ends on **Stop**, on screen unmount, or when the session drops (disconnect).
- **Live plot (deferred):** feeding extended values into the live charts was intentionally skipped —
  `liveDataStore.setValues` replaces the whole value map each poll and the poll loop decodes Mode 01
  PIDs only, so Mode 22 DIDs cannot flow into charts without changing `live-charts`/`engine-host`
  beyond a trivial additive change. The CSV log covers the "record over time" need instead.

## hooks
- `useExtendedPids()` — reads the profile's `extendedPids`, issues the Mode 22 requests, exposes
  values + raw frames, and the profile's DID definitions (`pids`) for the selectable list.
- `useMeasuringLog()` — owns the recording lifecycle: the 1 s sweep, the module-level row buffer, and
  the CSV write + share on stop.

## api (service layer)
- `extendedPidService` — optionally sets a CAN RX filter (`ATCRA`), sends `22 <DID>`, parses the `62`
  response per the profile's decoder.
- `api/measuringLog.ts` — the pure `buildMeasuringLogCsv(rows)` builder plus the module-level row
  buffer (`resetMeasuringLog` / `appendMeasuringRow` / `getMeasuringLog` / `measuringLogSize`).

## model
- `extendedStore` (Zustand): `values`, `rawFrames`, `enabled`.

## Behavior
- Hidden entirely unless the profile opts in and the protocol is CAN.
- Every value is labeled experimental; raw frames are always shown for debugging/confirmation.

## Acceptance
- For the Golf simulator, the seeded experimental DID returns a plausible value with the
  "unverified" badge.
- Never offered for the Passat/Punto profiles.
