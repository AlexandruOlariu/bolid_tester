# Feature: report

The **unified vehicle report** ([plan 15](../plans/15-unified-vehicle-report.md)): one tap produces
**one shareable document** for the active car — identity, readiness and fault codes (with VAG
numbers and freeze frames), the latest module scan, the used-car inspection verdict, the battery
result, the AI summary and the maintenance due list — as **PDF** (via `expo-print`), **HTML** or
**Markdown**, from the OS share sheet. "Send it to my mechanic" is one file instead of five. Every
shared report is recorded in [history](./history.md) so the per-car timeline (plan 16) can list it.

Metric only: km, °C, V, %. Nothing is sent anywhere by the app; the share sheet is the user's choice.

## Where it lives

`src/features/report/` (route `/report`, hidden tab "Vehicle report"). The report reads seven stores
across six features, so this slice is a **sanctioned composition point** — the same rule as
[engine-host](./engine-host.md#the-composition-rule) — and the only place that composes them.
Nothing imports the report slice: the Faults screen's own report mapping lives in `@/shared/lib`.
The pure model and renderers are in `src/shared/lib/vehicleReport.ts` (core tsconfig, ts-jest) and
never import feature types.

Entry points:

- **More → Vehicle report** ("The whole car in one PDF to share").
- **Info → Full vehicle report** (also shown when not connected — the report works offline).
- **Faults → Full report** (under Export / Share report).

## UI

- **ReportScreen** (`ui/ReportScreen.tsx`):
  - **Preview card** — car label, a severity badge (OK / Attention / Urgent, colour-coded), the VIN,
    "Connected — identity from the live session." or "Not connected — identity and results from the
    last connection.", and the headline counts (e.g. "1 fault code · 9/12 modules answered, 4 module
    faults · inspection CAUTION · battery good · AI attention · 1 service item overdue").
  - **Sections** checklist — one row per section (accessibility role `checkbox`). A section with
    data is checked by default and can be unchecked to leave it out. A section with no data is
    disabled with "Not run yet" and a **Run now** link to its screen (`/faults`, `/module-scan`,
    `/inspection`, `/battery`, `/ai-diagnose`, `/maintenance`). Never-run sections are still
    _requested_, so the document lists them on a muted "Not run yet: …" line; an unchecked section
    is simply absent.
  - **Share PDF** (falls back to HTML with a "PDF unavailable" note when the build has no printer),
    **Share HTML**, **Share Markdown**; afterwards "Saved `<file>` — it is listed in History."

## hooks

- `useVehicleReport()` — reads `sessionStore` (info, device name), `dtcStore`, `scanHistoryStore`,
  `historyStore`, `inspectionStore`, `batteryStore`, `aiDiagnoseStore`, the active car's
  `maintenanceStore` bucket and the active profile (`useActiveProfile`, garage-aware), maps them via
  `collectReportSources`, and returns `{ identity, available, build(include, now?) }` (`available`
  is a `Record<ReportSectionId, boolean>`). `build` stamps `APP_VERSION` (`@/shared/lib/appInfo`).
- `useReportExport()` — `sharePdf(model)`, `shareHtml(model)`, `shareMarkdown(model)` → file URI or
  null, plus `busy`. Thin wrapper over `api/reportExport.ts`.

## api

- `api/sections.ts` (pure, unit-tested):
  - `faultsFromStores(dtc, info, label, { ts, adapter })` — the live read as a `DtcCheckReport`
    (alias of `dtcCheckFromRead` in `@/shared/lib/dtcReport`, which the Faults screen also uses —
    it replaced the screen's local `buildCheck`); `faultsFromHistory(entry)` for a saved check.
  - `scanFromSaved(scan)` — the UDS modules with `statusFlagText` per fault; answered / with-faults
    / total counts computed exactly like the `formatAutoScanReport` header; TP2.0 modules in
    `preUds` (native fault number, its text from the seed table, raw status).
  - `inspectionFrom`, `batteryFrom`, `aiFrom` (each `(report, ranAt)`) and `maintenanceFrom(items,
entries, odoKm, now)` (`computeDue`, sorted overdue → soon → ok → no record; null for an empty
    logbook).
  - `identityFrom(profile, info, deviceName, fallback)` — `PROTOCOL_LABELS`, `decodeVin`
    (manufacturer, country, model year, check digit where mandatory), ELM version, voltage, PID
    count, calibration ID; offline: VIN / protocol from the fallback and `lastSeenAt` (the newest
    time among the sections the report prints and the car's newest DTC / AI history entries).
  - `belongsToCar(vehicle, profileId, vin)` — a record carrying a VIN must match the car's VIN
    (`historyVehicleKey`); otherwise the profile id decides.
  - `collectReportSources(snapshot)` — the live in-memory results win, but only when they were
    produced for this car: `dtcStore.readFor` and the `ranFor` of the inspection, battery and AI
    stores (each stamped with `activeCarStamp()` — active profile + session VIN — when the result
    is published) must pass `belongsToCar`. Without a matching live result (offline, after a
    restart, after `dtcStore.clearResults()` emptied the list with no session — `lastReadAt` stays
    for the first-run card but `readFor` goes null — or with another garage car's results still in
    memory) the fault codes and the AI summary fall back to this car's newest `history` entry and
    inspection / battery are left out ("Not run yet"). The scan is always this car's newest saved
    scan. VIN: session → garage learned VIN → newest stored record. `availableSections(sources)`.
- `api/reportExport.ts`:
  - `loadReportModules()` — tolerant variable-specifier imports of `expo-file-system/legacy`,
    `expo-sharing` and `expo-print` (`Print: null` when printing is missing).
  - `exportVehicleReport(model, format, mods)` — writes `<reportFileStem>.<ext>` to the document
    directory (PDF: `Print.printToFileAsync({ html })`, then `moveAsync` to that name), records a
    `report` history entry, opens the share sheet (`application/pdf`, `text/html`,
    `text/markdown`). Null when nothing was written (no modules / directory / printer, or a write
    failure logged as `report/export`). A share-sheet rejection after the write (e.g. Android
    refusing a second concurrent share) is logged as a warning and still resolves the URI, so the
    screen's PDF → HTML fallback never writes and records a second copy.

## model (`src/shared/lib/vehicleReport.ts`)

- Types: `ReportIdentity` (plus `connected`, `lastSeenAt`), `ReportScan` / `ReportScanModule` (plus
  `preUds`), `ReportInspection`, `ReportBattery`, `ReportAi`, `ReportMaintenance`,
  `VehicleReportModel` (`generatedAt`, `appVersion`, `identity`, the six sections, `missing`),
  `ReportSectionId`, `VehicleReportInput`.
- `buildVehicleReport(input)` — keeps requested sections with data, drops unrequested ones, lists
  requested-but-empty ones in `missing` (document order).
- `reportSeverity(model)` — worst of: MIL on (urgent), inspection fail (urgent) / caution
  (attention), AI overall, a weak battery (attention), any overdue service item (attention).
- `renderReportHtml(model)` — self-contained HTML: the shared `REPORT_CSS` (lifted out of
  `dtcReport.ts` into `reportHtml.ts`; `buildDtcReportHtml` output is byte-identical) plus badge /
  chip rules; the fault section reuses `dtcCheckBodyHtml` (code tables with VAG numbers + freeze
  frames); `@media print` page breaks before Module scan and Maintenance; every string goes through
  `escHtml`.
- `renderReportMarkdown(model)` — identity in the header, one `## ` heading per present section,
  VAG numbers next to each code.
- `reportFileStem(model)` — `bolid-report-<VIN or profile id>-<yyyymmdd-hhmm>` (UTC, file-name
  safe).
- History: `ReportHistoryEntry` (`kind: 'report'`, `id`, `ts`, `vehicle`, `sections`, `format`:
  `pdf` / `html` / `md`, `fileName`) and `historyStore.addReportRun` (additive; persist version
  stays 2).

## Behavior

- Simulator: Golf with `P0299` injected → read Faults, run Module scan, Inspection, Battery, AI
  (local fallback), add one maintenance entry → all six sections enabled; the HTML has VAG `00665`
  for `P0299`, module address `01`, the inspection verdict and the due list.
- Not connected: builds from stored data (saved scans, history entries, the logbook, any results
  still in memory); the identity block says "not connected — details from the last connection
  (time)".
- A failed write or print is logged in the error log (`report/export`) and nothing is recorded.

## Tests

- `src/shared/lib/vehicleReport.test.ts` — `missing`, header badge (MIL → urgent colour, overdue →
  attention), file stem (VIN / profile id), one `## ` per section, `<script>` escaped, metric guard
  (no `mph` / `mi` / `°F`), offline "last connection".
- `src/shared/lib/vehicleReport.integration.test.ts` — simulated Golf + `P0299` through the core
  reads → all six sections, `00665`, module `01`, verdict, due list.
- `src/features/report/api/sections.test.ts` — scan counts match the `formatAutoScanReport` header,
  maintenance worst-first, identity online / offline, history fallback, car matching, an emptied
  live read falls back to history, another car's in-memory results are left out.
- `src/features/report/api/reportExport.test.ts` — PDF / HTML / Markdown with fake modules, no
  printer, no directory, failure logged, history recorded, a failing share sheet still resolves
  the file with one history entry.
- `src/features/report/ui/ReportScreen.test.tsx` — disabled "Not run yet" rows with a working Run
  now, offline HTML, six enabled sections after the simulator walk-through, Share PDF writes a
  `.pdf`, unchecking removes a section, PDF → HTML fallback, Markdown.

## Acceptance

- Simulator: after Faults + Inspection + Battery + AI + Module scan and one maintenance entry,
  Report shows six enabled sections; **Share PDF** opens the share sheet with a `.pdf`; **Share
  HTML** with a `.html`.
- Unchecking a section removes it from the document; a never-run section is disabled with a working
  "Run now" link.
- Not connected: the report still builds from stored data and says "last connection".
- History shows a "Vehicle report" entry with its sections and format.
- `grep -rn "mph\|°F" src/shared/lib/vehicleReport.ts` returns nothing.

## On-car pending

Eyeball the PDF of a real Golf scan with TP2.0 modules once (16 modules' layout on real data).
