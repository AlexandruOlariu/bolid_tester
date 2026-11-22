# Feature: history

The **per-car timeline** ([plan 16](../plans/16-per-car-timeline.md)): one chronological view of
everything that happened to a car — AI diagnoses, fault-code checks, saved module scans, trips,
maintenance entries, coding backups and generated vehicle reports — grouped by day, filterable by
car, kind and text, with deep links into the screen each item came from. Reachable from **More →
Diagnose → History** (`/history`, a hidden route). Title "History", subtitle "Everything that
happened to this car".

The timeline replaced the old History list (AI runs and fault-code checks only) on the same route
and slice: same mental model, more sources. The slice is therefore a **composition point** (see
[architecture](../architecture.md#ui-feature-sliced)): it reads the module-scan, trip, maintenance
and coding stores and renders the AI report through the ai-diagnose slice.

## Sources

Seven sources, each mapped to `TimelineItem`s by a pure adapter in
`src/features/history/api/timelineSources.ts`:

| Kind          | Store (key)                                       | Title                              | Subtitle                                             | Tone                                       | Tap                                                       |
| ------------- | ------------------------------------------------- | ---------------------------------- | ---------------------------------------------------- | ------------------------------------------ | --------------------------------------------------------- |
| `ai`          | `historyStore` (`bolid.history`)                  | "AI diagnosis · {verdict}"         | first line of the summary                            | ok / warn (needs attention) / bad (urgent) | opens the saved report in a sheet (`AiReportView`)        |
| `dtc`         | `historyStore`                                    | "Fault-code check"                 | "{stored} stored · {pending} pending · MIL {on/off}" | bad if MIL on, warn if any code, else ok   | none (covered by **Export**)                              |
| `scan`        | `scanHistoryStore` (`bolid.scans`)                | "Auto-scan · {n} faults"           | "{answered}/{modules} modules answered"              | warn if faults, else ok                    | `/module-scan?after=<id>&before=<previous same-car scan>` |
| `trip`        | `tripStore` (`bolid.trips`, newest 500)           | "Trip · {km} km" (one decimal)     | "{duration} · {samples} samples · GPS"               | neutral                                    | `/trip-detail?id=<trip id>`                               |
| `maintenance` | `maintenanceStore` (`bolid.maintenance`, per car) | "Service: {item name}" / "Service" | "{odometer} km · {note}"                             | ok                                         | `/maintenance`                                            |
| `backup`      | `carBackupStore` (`bolid.carBackups`)             | "Coding backup"                    | "{n} modules"                                        | neutral                                    | `/coding`                                                 |
| `report`      | `historyStore` (`ReportHistoryEntry`, plan 15)    | "Report ({PDF / HTML / Markdown})" | the section titles joined, or "Identity only"        | neutral                                    | re-shares the file, or explains it is gone                |

Details:

- **AI verdicts** read "healthy", "needs attention" and "urgent".
- A **fault-code check** without a MIL reading leaves "MIL …" out.
- A **scan** counts UDS modules that answered (`state: 'ok'`) plus, on a pre-UDS car, TP2.0
  modules that opened a channel (`ok` / `refused`); faults include the TP2.0 ones. The total leaves
  out the UDS results `skipped` (a full scan keeps every TP2.0 module a second time as a skipped UDS
  result) and the TP2.0 modules the gateway does not list (`not-installed`), so each fitted module
  counts once.
- A **trip** uses the OBD distance (`stats.distanceKm`), else the GPS distance, else reads just
  "Trip". Duration reads "45 s", "12 min" or "1 h 05 min"; "· GPS" when the trip has a track.
- A **maintenance** entry resolves `itemId` against the service catalogue; an unknown item reads
  "Service". A note shows its first line.

## Cars

Every item carries `vehicleKey` = `historyVehicleKey(vehicle)` (the VIN when known, else the car's
profile / garage id) and a chip label (`historyVehicleChipLabel`, with a VIN suffix when known).

- History entries, scans and backups store their own `vehicle`.
- Trips are keyed by `tripCarKey(trip)` (the garage / registry id the trip was recorded on) plus
  the header VIN; the label is the car's current name ("Removed car" / "Unknown car" as on Trips).
- Maintenance buckets are per car since plan 06: a `vin:<VIN>` bucket belongs to the garage car
  learned with that VIN, an `id:<id>` bucket to that profile. The parked v1 logbook
  (`legacy:v1`, only while the vehicle store hydrates) is not listed.

## The pure merge

`src/shared/lib/timeline.ts` imports nothing from state or features:

- `mergeTimeline(lists, filter?)` — flatten, filter (`kinds`, `vehicleKey` / `'all'`, `from` / `to`
  inclusive, `query` = case-insensitive substring of title or subtitle), dedupe by `id`
  (`${kind}:${sourceId}`, the first wins), sort newest first (stable).
- `groupByDay(items)` — by **local** calendar day (`YYYY-MM-DD`), newest day first.
- `summarizeTimeline(items)` — count per kind (every kind present).

## UI

- **Car chips** (shown with two or more cars): "All cars (n)" plus one chip per car with its count,
  across every source. A car whose items are all gone falls back to "All cars".
- **Kind chips**, multi-select: All · AI · Faults · Scans · Trips · Service · Backups · Reports,
  each with its count for the selected car. "All" clears the selection.
- **Filter** text input (accessibility label "Filter the timeline") over title and subtitle.
- **Day headers** in the device's date format; rows show an icon per kind (Sparkles,
  TriangleAlert, Network, Route, Wrench, KeyRound, FileText), a tone bar on the left, the time
  (and the car while "All cars" lists several), and a chevron when the row is tappable. Each row
  has an accessibility label (title, subtitle, time) and the button role when tappable.
- **Tap**: links go through `router.push` (`{ pathname, params }` when there are params); an AI
  row opens the report sheet; a report row re-shares its file (`api/reportFile.ts`: the file is
  `<documentDirectory><fileName>`, checked with `getInfoAsync`) or explains "File no longer on
  device". A failing share is logged as `history/reshare-report`.
- **Export** (while the list holds fault-code checks): the listed `dtc` items as the fault-code
  Markdown report (`formatDtcReport`, shared via `useDtcExport`).
- **Clear** (confirmed): empties `historyStore` only — AI diagnoses, fault-code checks and report
  records. The dialog says module scans, trips, service entries and coding backups are kept; they
  are deleted on their own screens.
- Empty states: "Nothing yet. …" with no items at all; "Nothing matches “…”." for a text filter;
  "No scans, trips for this car." style copy for a kind filter.

## What gets recorded in `historyStore`

- **AI diagnosis runs** — saved by `useAiDiagnose` after each run: vehicle, source (AI vs local),
  overall verdict, summary, finding count, and the full `AiReport` (the sheet re-opens it).
- **Fault-code checks** — saved by the fault-codes service (`dtcService.readAll`) on every read:
  vehicle, MIL state, stored/pending/permanent codes, and monitor-readiness counts.
- **Vehicle reports** (plan 15) — saved by the [report](./report.md) export each time a report is
  written and shared: the car, the sections it held, the format (`pdf` / `html` / `md`) and the
  file name.

The DTC read that happens _inside_ an AI run is part of that AI entry; only the dedicated **Fault
codes** screen creates `dtc` entries, so there is no double-logging. The other four sources are
recorded by their own features (module scan auto-saves each scan, trips on stop, maintenance on
add, coding on backup); the timeline only reads them.

## model

- `historyStore` (Zustand, **persisted** to `bolid.history` via `shared/state/persistStorage`):
  `entries: HistoryEntry[]` (a union of `AiHistoryEntry | DtcHistoryEntry | ReportHistoryEntry`)
  plus `addAiRun`, `addDtcCheck`, `addReportRun`, `remove`, `clear`. `ReportHistoryEntry` (plan 15)
  is `{ kind: 'report', id, ts, vehicle, sections: ReportSectionId[], format, fileName }`. Persist
  `version` 2. Lives in `shared/state` so any feature can record without depending on another
  feature.
- Persist writes are wrapped in **`debouncedStorage(fileStateStorage, 500)`**: a burst of
  adds/removes rewrites the JSON file once, ~500 ms after the last mutation (finding F7).
- A `merge` concatenates rehydrated + in-memory entries deduped by id and re-applies the cap, so an
  entry added during the async hydration window survives.
- A persist `migrate` (v1→v2) lifts older `vehicleLabel`-only entries into the `vehicle` shape.
- `hooks/useTimeline.ts` reads the five stores (history, scans, trips, maintenance, coding
  backups) and the garage, maps them through the adapters and merges them (memoised); it also
  hands the screen the history entries by id (AI sheet, report re-share, export).
- No new store and no persisted shape change in plan 16.

## AI agent

- AI agent: `read_history`, `history_compare` — `agent/agentTools.ts` contributes both tools and the
  `history` skill to the [AI agent](./ai-diagnose.md#agent). Both are always offered and read only
  the **active car's** records: a record's `vehicle.id` is `getActiveProfile().id`, or its VIN is the
  active garage car's learned VIN. Like the timeline they read other slices' stores (module-scan,
  trip-recording) and write nothing.
  - `read_history {limit?: 1..10}` — runs at triage with `{ limit: 5 }`, no adapter time. With no AI
    run, fault-code check or saved scan for the car: `No history for this car yet.` Otherwise: the
    newest `limit` AI runs (`<yyyy-mm-dd hh:mm> <overall>: <summary's first line ≤ 120 chars>`), the
    newest `limit` fault-code checks with their codes (`P0401, P2002 pending (MIL on)` or `no
codes`), then over those checks (oldest first) `Codes went away between <d1> and <d2> (cleared or
fixed)` for each check with codes followed by one without and `Recurring: P0401 (3 checks)` for
    each code in ≥ 2 checks, and last `Saved module scans: N (newest <date>)`. When that passes the
    1600-character digest cap, each of the four parts (AI runs, checks, patterns, scans line) gets
    a fair share of the room and is cut with `… (N more)`, so ten long AI runs never push the
    checks, patterns or scans line out.
  - `history_compare {pid}` — `costMs` 1000. Per trip of the car's newest 10 (`tripCarKey`), oldest
    → newest: `<date>: max <stats.max[pid]> / avg <mean of the trip CSV's samples> <unit>`
    (`not logged` when the trip did not record the PID, `avg n/a` when its CSV cannot be read), then
    one live read through the read-only facade: `Now: <value>`, `Now: no answer` or `Now: not
supported by this car`. No trips: `No trips recorded for this car.` before the live line.

## Retention

- `historyStore` is **capped at `MAX_HISTORY` (200)** newest entries; scans at 50, coding backups
  at 10; trips are not capped by their store, so the timeline reads the newest 500.

## Tests

- `src/shared/lib/timeline.test.ts` — sort, dedupe, kinds / car / time / text filters,
  `groupByDay` across local midnight, `summarizeTimeline`.
- `src/features/history/api/timelineSources.test.ts` — tone rules, the scan link's previous
  same-car `before`, trip title (one decimal, km), maintenance item names, backups.
- `src/features/history/api/reportFile.test.ts` — re-share, missing file, no sharing, failure log.
- `src/features/history/ui/HistoryScreen.test.tsx` — all seven sources on one day, day headers,
  kind / car / text filters, scan / trip / maintenance / backup links, the AI sheet, report
  re-share, Export, and Clear keeping the other sources.
- `src/features/module-scan/ui/ScanHistorySection.test.tsx` — the compare deep link.

## Acceptance

- The timeline lists items from all seven sources with their icons, newest first, grouped by day.
- The car chip filters every source; kind chips combine; the text filter narrows.
- Tapping a scan opens Module scan with Before / After preselected and the diff visible.
- Tapping an AI item opens its full report; tapping a report item re-shares the file or explains
  it is gone.
- Export still produces the fault-code Markdown; Clear only clears AI / fault-code / report entries.

Simulator walk-through: Golf simulator → run Diagnose (AI), read Faults, run Module scan twice
(inject a code in Settings → Developer & simulator, scan, clear it, scan again), record a 30 s trip,
add a maintenance entry, share a vehicle report → History shows at least seven items under today;
the second scan row opens Compare with the first scan as Before and the cleared fault listed.
