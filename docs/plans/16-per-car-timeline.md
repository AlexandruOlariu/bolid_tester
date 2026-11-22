# Plan 16 — Per-car timeline

**Size:** M (1–1½ days) · **Depends on:** 15 (report entries), 06 (per-car maintenance and garage
keys; degrades to "all cars" for maintenance until then) · **Roadmap:** v0.4 "Per-car timeline"

## Goal

One chronological view per car that merges AI runs, fault-code checks, saved module scans, trips,
maintenance entries, coding backups and generated reports, grouped by day, filterable by type and
car, with deep links: a scan opens the before/after compare pre-selected, a trip opens its detail
(plan 17), an AI run re-opens its report, a report re-shares its file.

## Why

History (`src/features/history/ui/HistoryScreen.tsx`) shows only AI runs and DTC checks. Scans live
under Module scan, trips under Trips, maintenance under its own screen — the owner cannot answer
"what happened to this car in October?" without visiting five screens.

## Read first

- `src/shared/state/historyStore.ts` (`HistoryVehicle`, `historyVehicleKey`,
  `historyVehicleChipLabel`, `AiHistoryEntry`, `DtcHistoryEntry`, and plan 15's `ReportHistoryEntry`).
- `src/features/history/ui/HistoryScreen.tsx` (chips, `AiCard`, `DtcCard`, export via
  `useDtcExport` + `formatDtcReport`), `src/features/history/index.ts`.
- `src/features/module-scan/model/scanHistoryStore.ts` (`SavedScan { id, ts, vehicle, protocol,
modules, tp20 }`), `src/features/module-scan/api/scanDiff.ts` (`diffScans(a, b): ScanDiff`,
  `ScanDiff.totals`), `src/features/module-scan/ui/ScanHistorySection.tsx` (`CompareSection` holds
  `beforeId`/`afterId` in local state, defaults `scans[1]`/`scans[0]`), `ModuleScanScreen.tsx` line
  ~232 where `<ScanHistorySection />` is rendered (no route params read today).
- `src/features/trip-recording/model/tripStore.ts` (`TripSummary { header: TripHeader, stats,
markerCount }`; `TripHeader { id, startedAt, endedAt, profileId, vin, protocol }`).
- `src/features/maintenance/model/maintenanceStore.ts` (`entries: LogEntry[]`, `items`; `LogEntry {
id, itemId, date, odoKm, note? }` — **no vehicle key until plan 06**).
- `src/features/coding/model/carBackupStore.ts` (`CarBackup { id, ts, vehicle, protocol, modules }`).
- `src/app/_layout.tsx` (`/history` hidden route), `src/features/more/ui/MoreScreen.tsx` entry.

## Design

### Decision: the timeline **replaces** the History screen

Same slice (`src/features/history`), same route `/history`, title stays "History" (subtitle
"Everything that happened to this car"). Reasons: it is the same mental model with more sources;
`featureDocsSync` keeps `history.md`; no new route. The old AI/DTC cards become item renderers.
The slice becomes a composition point (reads module-scan, trip, maintenance, coding stores) —
document it alongside `engine-host` and `report` in `docs/architecture.md`.

### Pure merge (`src/shared/lib/timeline.ts`)

```ts
export type TimelineKind = 'ai' | 'dtc' | 'scan' | 'trip' | 'maintenance' | 'backup' | 'report';
export interface TimelineItem {
  id: string; // `${kind}:${sourceId}` — unique across sources
  kind: TimelineKind;
  ts: number;
  vehicleKey: string; // historyVehicleKey(...) computed by the caller
  vehicleLabel: string;
  title: string; // e.g. "Fault-code check", "Auto-scan: 2 faults", "Trip · 23.4 km"
  subtitle?: string; // one line of detail
  tone: 'ok' | 'warn' | 'bad' | 'neutral';
  /** Opaque navigation target the UI resolves (route + params). */
  link?: { route: string; params?: Record<string, string> };
  /** Source record id for renderers that need the full object (AI report, scan). */
  sourceId: string;
}
export interface TimelineDay {
  day: string /* YYYY-MM-DD local */;
  items: TimelineItem[];
}
export interface TimelineFilter {
  kinds?: TimelineKind[];
  vehicleKey?: string | 'all';
  from?: number;
  to?: number;
  query?: string;
}
export function mergeTimeline(items: TimelineItem[][], filter?: TimelineFilter): TimelineItem[]; // flatten, filter, dedupe by id, sort ts desc
export function groupByDay(items: TimelineItem[], tz?: 'local'): TimelineDay[];
export function summarizeTimeline(items: TimelineItem[]): Record<TimelineKind, number>;
```

`timeline.ts` imports nothing from state or features; the caller supplies `TimelineItem[]` per
source via adapters.

### Adapters (`src/features/history/api/timelineSources.ts`, pure)

`fromHistory(entries: HistoryEntry[])`, `fromScans(scans: SavedScan[])`, `fromTrips(trips:
TripSummary[], labelFor: (profileId, vin) => string)`, `fromMaintenance(entries: LogEntry[], items:
ServiceItem[], vehicle: HistoryVehicle)`, `fromBackups(backups: CarBackup[])`. Rules:

| Source        | title                              | subtitle                                             | tone                               | link                                                                                                                                                            |
| ------------- | ---------------------------------- | ---------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ai`          | "AI diagnosis · {overall}"         | summary (1 line)                                     | by overall                         | opens an in-screen sheet with the embedded `AiReport` (reuse `ReportView`-style rendering; export `AiReportView` from ai-diagnose `ui/` through its `index.ts`) |
| `dtc`         | "Fault-code check"                 | "{stored} stored · {pending} pending · MIL {on/off}" | bad if MIL, warn if codes, else ok | none (export stays)                                                                                                                                             |
| `scan`        | "Auto-scan · {totalFaults} faults" | "{answered}/{modules} modules answered"              | warn if faults else ok             | `/module-scan?after=<id>&before=<prevSameCarId>`                                                                                                                |
| `trip`        | "Trip · {distanceKm} km"           | "{duration} · {sampleCount} samples{ · GPS}"         | neutral                            | `/trip-detail?id=<header.id>` (plan 17)                                                                                                                         |
| `maintenance` | "Service: {item.name}"             | "{odoKm} km{ · note}"                                | ok                                 | `/maintenance`                                                                                                                                                  |
| `backup`      | "Coding backup"                    | "{modules.length} modules"                           | neutral                            | `/coding`                                                                                                                                                       |
| `report`      | "Report ({format})"                | sections joined                                      | neutral                            | re-share if the file still exists (`FileSystem.getInfoAsync`), else "file no longer on device"                                                                  |

Trip vehicle key: `historyVehicleKey({ id: header.profileId, vin: header.vin, label })`.
Maintenance before plan 06: key = `id:<selectedProfileId>` at render time (all entries); after plan
06 use the store's per-vehicle key.

### Deep link into the scan compare

`ScanHistorySection.tsx`: `CompareSection` accepts `initialBeforeId?: string; initialAfterId?: string`
and seeds its state from them; `ScanHistorySection` reads `useLocalSearchParams<{ before?: string;
after?: string }>()` from `expo-router` and passes them. The timeline adapter picks `before` as the
previous scan with the same `vehicleKey`.

### UI (`src/features/history/ui/HistoryScreen.tsx` rewrite)

- Car chips (existing logic, now across all sources), kind chips (All · AI · Faults · Scans · Trips ·
  Service · Backups · Reports) multi-select, a text `Input` filter over title/subtitle.
- Day headers (`TimelineDay.day` formatted `toLocaleDateString()`), items as compact rows: icon by
  kind (lucide: Sparkles, TriangleAlert, Network, Route, Wrench, KeyRound, FileText), tone bar on the
  left, chevron when `link`.
- Row tap → `router.push({ pathname: link.route, params: link.params })` or opens the AI sheet.
- Keep **Export** (DTC Markdown of the filtered `dtc` items) and **Clear history** (clears
  `historyStore` only; explain it does not delete scans/trips).
- Empty state copy per filter.

### Store additions

None required. Optional perf: `useMemo` over the five store slices; sources are already capped
(history 200, scans 50, backups 10; trips unbounded — cap the adapter input to the newest 500).

## Steps

1. `timeline.ts` + `timeline.test.ts`.
2. `timelineSources.ts` + tests (fixtures for each store shape).
3. `CompareSection` initial ids + params; export `AiReportView` from ai-diagnose.
4. Rewrite `HistoryScreen.tsx`; keep export/clear; a11y labels on rows.
5. Docs; `npm run ci`.

## Simulator

Golf simulator: run AI, Faults, Module scan twice (inject then clear a code between), record a
30 s trip, add a maintenance entry, generate a report → the timeline shows ≥ 7 items on today's
date; the second scan row deep-links into compare with the first scan preselected and shows the
cleared fault.

## Tests

- `timeline.test.ts`: sort desc; dedupe by id; `kinds` filter; `vehicleKey` filter; `query` matches
  title or subtitle case-insensitively; `groupByDay` splits across local midnight (fixed timestamps
  built with `new Date(y, m, d, h)`); `summarizeTimeline` counts.
- `timelineSources.test.ts`: tone rules (MIL → bad; faults → warn); scan link picks the previous
  same-car scan as `before`; trip title uses `stats.distanceKm` with 1 decimal and "km"; maintenance
  title resolves `itemId` → item name, unknown item → "Service".
- `scanDiff` untouched; `ScanHistorySection` prop seeding covered by plan 10 UI tests later.

## Docs

- `docs/features/history.md`: rewrite as the timeline spec (sources table, filters, deep links,
  what Clear deletes).
- `docs/features/module-scan.md`: `before`/`after` route params.
- `docs/architecture.md`: history as a composition slice.

## Acceptance

- [ ] Timeline lists items from all seven sources with correct icons, newest first, grouped by day.
- [ ] Car chip filters every source; kind chips combine; text filter narrows.
- [ ] Tapping a scan opens Module scan with Before/After preselected and the diff visible.
- [ ] Tapping an AI item opens its full report; tapping a report item re-shares the file or
      explains it is gone.
- [ ] Export still produces the DTC Markdown; Clear only clears AI/DTC/report entries.
- [ ] `npm run ci` green.

## Out of scope

Trip detail screen (plan 17); per-vehicle maintenance keys (plan 06); editing items from the
timeline.

## Deferred until an on-car session

None — every source is reproducible in the simulator.
