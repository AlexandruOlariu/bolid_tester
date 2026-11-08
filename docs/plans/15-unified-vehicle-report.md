# Plan 15 — Unified vehicle report (PDF / HTML)

**Size:** M–L (1½–2 days) · **Depends on:** 05 (DTC descriptions), 06 (garage vehicle identity;
works with registry profiles until then) · **Roadmap:** v0.4 "Unified vehicle report"

## Goal

One tap produces **a single shareable document** for the active car: identity (profile or garage
vehicle, VIN decode), readiness, DTCs with VAG numbers, descriptions and freeze frames, the latest
module scan, the used-car inspection verdict, the battery result, the AI summary and the maintenance
due list. Shared as PDF (via `expo-print`) or HTML, from the share sheet. Every generated report is
recorded in history so the timeline (plan 16) can list it.

## Why

Today each feature exports its own fragment: `buildDtcReportHtml` (Faults), `formatAutoScanReport`
(module scan `.txt`), nothing for inspection / battery / AI / maintenance. "Send it to my mechanic"
means five files. Everything needed is already in stores; this plan composes it.

## Read first

- `src/shared/lib/dtcReport.ts` (`DtcCheckReport`, `DtcReportOptions`, `formatDtcReport`,
  `buildDtcReportHtml`, the private `esc`, `fmtTime`, `codeTable`, the inline CSS) and `dtcReport.test.ts`.
- `src/features/fault-codes/hooks/useDtcExport.ts` (`exportReport(baseName, body, { ext, mimeType,
dialogTitle })`), `src/features/fault-codes/ui/FaultCodesScreen.tsx` (`buildCheck()` — how the live
  read becomes a `DtcCheckReport`), `src/features/fault-codes/model/dtcStore.ts` (`DtcResult`).
- `src/features/module-scan/api/scanReport.ts` (`formatAutoScanReport`, `statusFlagText`) and
  `src/features/module-scan/model/scanHistoryStore.ts` (`SavedScan`, `SavedScanModule`,
  `SavedScanDtc`, `useScanHistoryStore.scans` newest-first).
- `src/features/inspection/model/inspectionStore.ts` (`report: InspectionReport | null`, `ranAt`);
  `src/shared/obd-core/analysis/inspection.ts` (`InspectionReport { verdict, score, checks }`,
  `InspectionCheck { id, label, status, detail }`, `Verdict`, `CheckStatus`).
- `src/features/battery-health/model/batteryStore.ts` (`report: BatteryReport | null` — **no
  `ranAt`**); `src/shared/obd-core/analysis/battery.ts` (`BatteryReport { restingV, crankingDipV,
chargingV, socPct, verdict, notes }`).
- `src/features/ai-diagnose/model/aiDiagnoseStore.ts` (`report: AiReport | null`, `ranAt`,
  `snapshot`); `AiReport { overall, summary, findings, actions, source, disclaimer }`.
- `src/features/maintenance/model/maintenanceStore.ts` (`items`, `entries`, `odoKm`, `kmPerYear`);
  `src/shared/obd-core/analysis/maintenance.ts` (`computeDue(items, entries, { odoKm, now })` →
  `DueInfo { itemId, name, status, dueInKm, dueInDays, lastOdoKm, lastDate }`).
- `src/shared/state/sessionStore.ts` (`info: SessionInfo`, `deviceName`), `SessionInfo { protocol,
voltage, version, supportedPids, vin, calibrationId }`; `PROTOCOL_LABELS` in
  `src/shared/obd-core/obd/protocols.ts`; `decodeVin` → `DecodedVin { manufacturer, country, region,
modelYear, wmi, checkDigit, validFormat }` in `src/shared/obd-core/obd/vinDecode.ts`.
- `src/shared/state/historyStore.ts` (`HistoryEntry` union, `addAiRun`/`addDtcCheck`, `MAX_HISTORY`,
  persist `version: 2`, the `merge`).
- `src/features/more/ui/MoreScreen.tsx` (entries), `src/features/vehicle-info/ui/VehicleInfoScreen.tsx`
  (where the entry button goes), `src/app/_layout.tsx` (hidden routes).
- `expo-constants@56.0.20` is installed (`Constants.expoConfig?.version`); **`expo-print` is not**.

## Design

### Where it lives — a `report` feature slice (decision)

A new slice `src/features/report/` with route `/report` (hidden `Tabs.Screen`), reachable from
More → Diagnose ("Vehicle report"), a button on the Info screen ("Full vehicle report") and a
"Full report" button next to "Share report" on Faults. Reason: the report reads seven stores across
six features; a dedicated slice is the one sanctioned composition point for that (same rule as
`engine-host`, which `docs/plans/README.md` already names as the exception). Putting it on the Info
screen would make `vehicle-info` import six features. The **pure model and renderers** live in
`src/shared/lib/vehicleReport.ts` so they are typechecked by the core tsconfig and unit-tested with
ts-jest; they never import feature types — the hook maps store shapes into the report's own
narrowed types (same pattern as `DtcCheckReport`).

### Pure model (`src/shared/lib/vehicleReport.ts`)

```ts
export interface ReportIdentity {
  label: string; // vehicleLabel(profile) or garage name
  vin: string | null;
  vinDecoded?: {
    manufacturer: string;
    country: string;
    modelYear: number | null;
    checkDigitOk: boolean | null;
  };
  profileId: string;
  year?: number;
  engine?: string;
  fuel?: string;
  protocol: string | null; // PROTOCOL_LABELS[...] or null when offline
  adapter: string | null; // deviceName
  elmVersion: string | null;
  voltage: number | null;
  supportedPidCount: number | null;
  calibrationId: string | null;
}
export interface ReportScanModule {
  address: string;
  name: string;
  state: string;
  partNumber?: string;
  systemName?: string;
  faults: { display: string; vagCode: string; description: string; statusText: string }[];
}
export interface ReportScan {
  ts: number;
  protocol: string;
  modules: ReportScanModule[];
  answered: number;
  withFaults: number;
  totalFaults: number;
}
export interface ReportInspection {
  ts: number | null;
  verdict: 'pass' | 'caution' | 'fail';
  score: number;
  checks: { label: string; status: 'pass' | 'warn' | 'fail' | 'info'; detail: string }[];
}
export interface ReportBattery {
  ts: number | null;
  restingV: number | null;
  crankingDipV: number | null;
  chargingV: number | null;
  socPct: number | null;
  verdict: string;
  notes: string[];
}
export interface ReportAi {
  ts: number | null;
  source: 'ai' | 'local';
  overall: 'ok' | 'attention' | 'urgent';
  summary: string;
  findings: { title: string; severity: string; detail: string; codes?: string[] }[];
  disclaimer: string;
}
export interface ReportMaintenance {
  odoKm: number | null;
  due: {
    name: string;
    status: 'ok' | 'soon' | 'overdue' | 'unknown';
    dueInKm: number | null;
    dueInDays: number | null;
    lastOdoKm: number | null;
    lastDate: number | null;
  }[];
}

export interface VehicleReportModel {
  generatedAt: number;
  appVersion: string | null;
  identity: ReportIdentity;
  faults: DtcCheckReport | null; // reuse: readiness + DTCs + freeze frames
  scan: ReportScan | null;
  inspection: ReportInspection | null;
  battery: ReportBattery | null;
  ai: ReportAi | null;
  maintenance: ReportMaintenance | null;
  /** Which sections were requested but had no data; rendered as a muted "not run yet" line. */
  missing: ReportSectionId[];
}
export type ReportSectionId = 'faults' | 'scan' | 'inspection' | 'battery' | 'ai' | 'maintenance';
export interface VehicleReportInput {
  identity: ReportIdentity;
  faults?: DtcCheckReport | null;
  scan?: ReportScan | null;
  inspection?: ReportInspection | null;
  battery?: ReportBattery | null;
  ai?: ReportAi | null;
  maintenance?: ReportMaintenance | null;
  include: ReportSectionId[];
  appVersion?: string | null;
  now?: number;
}

export function buildVehicleReport(input: VehicleReportInput): VehicleReportModel; // pure; fills `missing`
export function renderReportHtml(model: VehicleReportModel, opts?: { title?: string }): string; // self-contained HTML, inline CSS (copy dtcReport's stylesheet into a shared `REPORT_CSS` const and have buildDtcReportHtml use it too)
export function renderReportMarkdown(model: VehicleReportModel): string;
export function reportFileStem(model: VehicleReportModel): string; // `bolid-report-<vin-or-profile>-<yyyymmdd-hhmm>`
```

Rendering rules: section order as in the model; a severity badge in the header = worst of (MIL on,
inspection verdict, AI overall, any `overdue`); `@media print` page breaks before Scan and
Maintenance; every string through `esc`; numbers metric only (`km`, `°C`, `V`, `L/100km`).

### Section mappers (`src/features/report/api/sections.ts`)

Pure functions from store shapes to report types, so the hook stays thin:
`faultsFromStores(dtc: DtcResult, info, profileLabel)` (mirror `FaultCodesScreen.buildCheck`, then
delete that local copy and import this one), `scanFromSaved(scan: SavedScan)` (uses
`statusFlagText`), `inspectionFrom(report, ranAt)`, `batteryFrom(report, ranAt)`, `aiFrom(report,
ranAt)`, `maintenanceFrom(items, entries, odoKm, now)` (calls `computeDue`), `identityFrom(profile,
info, deviceName)` (calls `decodeVin` when `vin`).

`batteryStore` gains `ranAt: number | null` set by `setReport` (small edit in
`src/features/battery-health/model/batteryStore.ts`).

### Hook and UI (`src/features/report/`)

- `hooks/useVehicleReport.ts`: reads `useSessionStore`, `useDtcStore`, `useScanHistoryStore`
  (latest scan whose `vehicle` key matches the active car via `historyVehicleKey`),
  `useInspectionStore`, `useBatteryStore`, `useAiDiagnoseStore`, `useMaintenanceStore`, the active
  profile (`getVehicleProfile(selectedProfileId)` today; `getActiveProfile()` after plan 06);
  exposes `{ available: Record<ReportSectionId, boolean>, build(include): VehicleReportModel }`.
- `hooks/useReportExport.ts`: `sharePdf(model)` → `const Print = await import('expo-print' as string);
const { uri } = await Print.printToFileAsync({ html: renderReportHtml(model) });` then move/rename
  to `${documentDirectory}${reportFileStem(model)}.pdf` (`FileSystem.moveAsync`) and share with
  `mimeType: 'application/pdf'`; `shareHtml(model)` writes the HTML and shares `text/html`;
  `shareMarkdown(model)`. Tolerant imports, `logError({ source: 'report/export' })` on failure. When
  `expo-print` is missing (tests/web) `sharePdf` returns `null` and the UI falls back to HTML.
- `ui/ReportScreen.tsx`: section checklist (checked by default where `available`, disabled with
  "not run yet" otherwise, each with a "Run now" link to the owning screen), a preview card with the
  header badge + counts, buttons **Share PDF**, **Share HTML**, **Share Markdown**. Offline (not
  connected) still works from stored data; the identity block then says "last connection".
- `index.ts` exports `ReportScreen`.
- Routes/entries: `src/app/report.tsx`; `_layout.tsx` hidden `Tabs.Screen name="report"
options={{ href: null, title: 'Vehicle report' }}`; More entry (Diagnose section after plan 07,
  flat list before); Info screen button; Faults "Full report" button (`router.push('/report')`).

### History record

`historyStore.ts`: add `ReportHistoryEntry { kind: 'report'; id; ts; vehicle: HistoryVehicle;
sections: ReportSectionId[]; format: 'pdf' | 'html' | 'md'; fileName: string }` to the
`HistoryEntry` union and `addReportRun(e)`. Additive, persist `version` stays 2. `HistoryScreen`
(until plan 16 replaces it) renders a `ReportCard` and its type filter gains "Reports".

Install: `npx expo install expo-print` (no config plugin; iOS/Android native print to PDF).

## Steps

1. `vehicleReport.ts` types + `buildVehicleReport` + `renderReportMarkdown` + tests.
2. `renderReportHtml` (lift the stylesheet out of `dtcReport.ts` into `REPORT_CSS`; keep
   `buildDtcReportHtml` output byte-identical except for the CSS move — update its test if it
   snapshots CSS).
3. `features/report/api/sections.ts` + tests (pure); `batteryStore.ranAt`.
4. Hook, export hook, screen, route, entries; move `buildCheck` out of `FaultCodesScreen`.
5. `historyStore` report entries + `HistoryScreen` card/filter.
6. `npx expo install expo-print`; docs; `npm run ci`.

## Simulator

Golf simulator with injected `P0299`: run Faults, Module scan, Inspection, Battery, AI (local
fallback), add one maintenance entry → the report has all six sections. Integration test
`vehicleReport.integration.test.ts` under `src/shared/lib/` builds the model from fixture objects
(not stores) and asserts the HTML contains the VAG number `00665` for `P0299`, the scan module
address `01`, the inspection verdict and the due list.

## Tests

- `vehicleReport.test.ts`: `missing` lists sections requested without data; header badge picks
  the worst state (MIL on → `urgent` colour, `overdue` → at least `attention`); `reportFileStem`
  uses the VIN when present else profile id; Markdown has one `## ` per present section; HTML
  escapes `<script>` in a DTC description; HTML has no `mph`/`mi`/`°F` (metric guard).
- `sections.test.ts`: `scanFromSaved` counts (answered/withFaults/totalFaults) match
  `formatAutoScanReport`'s header for the same fixture; `maintenanceFrom` sorts worst-first.
- `dtcReport.test.ts` still green after the CSS lift.
- `historyStore.test.ts`: `addReportRun` prepends a `kind: 'report'` entry under the cap.

## Docs

- New `docs/features/report.md` (UI, hooks, api, model, Behavior, Acceptance).
- `docs/features/fault-codes.md` (buildCheck moved; "Full report" button),
  `docs/features/history.md` (report entries), `docs/features/battery-health.md` (`ranAt`),
  `docs/architecture.md` (report slice as a composition point), `docs/features/more.md` entry.

## Acceptance

- [ ] Simulator: after running Faults + Inspection + Battery + AI + Module scan and adding a
      maintenance entry, Report shows six enabled sections; **Share PDF** opens the share sheet with
      a `.pdf`; **Share HTML** with a `.html`.
- [ ] Unchecking a section removes it from the document; a never-run section is disabled with a
      working "Run now" link.
- [ ] Not connected: the report still builds from stored data and says "last connection" in the
      identity block.
- [ ] History shows a "Report" entry with the sections and format.
- [ ] `npm run ci` green; `grep -rn "mph\|°F" src/shared/lib/vehicleReport.ts` returns nothing.

## Out of scope

Per-car timeline listing of reports (plan 16 consumes `ReportHistoryEntry`); AI narrative
summarising the whole report (plan 19 multi-turn can be pointed at it later); hosted/cloud sharing.

## Deferred until an on-car session

Confirming the PDF renders the real Golf scan with TP2.0 modules (the simulator covers UDS + TP2.0
fixtures; layout with 16 modules should be eyeballed once on real data).
