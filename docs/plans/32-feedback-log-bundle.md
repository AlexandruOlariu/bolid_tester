# Plan 32 — In-app feedback and the redacted log bundle

**Size:** S–M (½–1 day) · **Depends on:** nothing (plan 31 reuses `scrubText`; whichever lands
first owns `src/shared/lib/scrub.ts`) · **Roadmap:** v1.0 "In-app feedback / log bundle"

## Goal

One tap in More → **Report a problem** builds a **redacted** bundle (error log, adapter I/O log,
app/device info, active vehicle, last module-scan report), lets the user add a description, and
hands it to the share sheet, an email draft or a prefilled GitHub issue. Nothing identifies the
car or the adapter unless the user chooses to keep it.

## Why

Today a user has to find More → Error log → Export, then separately Settings → Adapter log →
Export as replay fixture, and still cannot describe the problem. The maintainer gets two files
with no device info. `useErrorLogExport` (`src/features/error-log/hooks/useErrorLogExport.ts`)
already shows the file-write + share pattern; `errorsToJson` (`src/shared/lib/errorLog.ts`),
`adapterLogSnapshot()` (`src/shared/state/adapterLog.ts`, 300-entry ring buffer) and
`formatAutoScanReport(scan)` (`src/features/module-scan/api/scanReport.ts`) already produce the
pieces.

## Read first

- `src/features/error-log/{hooks/useErrorLogExport.ts, ui/ErrorLogScreen.tsx, index.ts}`.
- `src/shared/lib/errorLog.ts` (`LoggedError`, `errorsToJson`, `formatErrorsForExport`).
- `src/shared/state/adapterLog.ts` (`LogEntry`, `adapterLogSnapshot`, `ADAPTER_LOG_CAPACITY`).
- `src/shared/state/sessionStore.ts` (`deviceId`, `deviceName`, `info: SessionInfo` with
  `protocol`, `version`, `vin`, `supportedPids`, `calibrationId`).
- `src/features/vehicle-select/model/vehicleStore.ts` (`selectedProfileId`), after plan 06
  `getActiveProfile()`.
- `src/features/module-scan/model/scanHistoryStore.ts` (`scans[0]`, `SavedScan`),
  `src/features/module-scan/api/scanReport.ts` (`formatAutoScanReport`).
- `src/features/more/ui/MoreScreen.tsx` (`ENTRIES`; after plan 07 `more/model/sections.ts` → Tools).
- `expo-constants` is installed (56.0.20, transitive via expo-router) but **not** a direct
  dependency — add it to `package.json` (`npx expo install expo-constants`) before importing
  `Constants.expoConfig?.version`. `expo-device`/`expo-application` are not installed; use
  `Platform.OS`, `Platform.Version` and `Constants` only.
- Repository: `https://github.com/AlexandruOlariu/bolid_tester` (issue URL target).

## Design

### Pure core `src/shared/lib/feedbackBundle.ts` (core tsconfig scope, tested)

```ts
export interface BundleInput {
  description: string;                       // user text (may be empty)
  app: { version: string; build?: string; adapterSource: 'mock' | 'ble'; platform: string; osVersion: string; locale?: string };
  vehicle: { profileId: string; name: string; vin: string | null; protocol?: string; supportedPidCount?: number };
  adapter: { deviceId: string | null; deviceName: string | null; version?: string };
  errors: LoggedError[];                     // newest first, already capped at 500 by the store
  adapterLog: LogEntry[];                    // chronological snapshot (≤ 300)
  lastScanReport?: string | null;            // formatAutoScanReport(scans[0]) or null
  keepIdentifiers?: boolean;                 // default false → redact
}
export interface FeedbackBundle { createdAt: number; redacted: boolean; app: …; vehicle: …; adapter: …; errors: LoggedError[]; adapterLog: LogEntry[]; lastScanReport: string | null; description: string }
export function redactBundle(input: BundleInput): FeedbackBundle;   // applies the rules below unless keepIdentifiers
export function bundleToJson(b: FeedbackBundle): string;           // pretty JSON, deterministic key order
export function bundleToMarkdown(b: FeedbackBundle, opts?: { maxErrors?: number; maxLogLines?: number }): string;  // human summary for an issue body: header table, description, last 10 errors, last 40 adapter lines in a code block, scan report collapsed in <details>
export function issueUrl(b: FeedbackBundle, repo = 'AlexandruOlariu/bolid_tester'): string;  // https://github.com/<repo>/issues/new?title=…&body=… — body truncated to 6 000 chars with a note "full bundle attached separately"
export function mailtoUrl(b: FeedbackBundle, to: string): string;  // subject + short body (no logs — mail clients choke); user attaches the file from the share sheet
```

Redaction rules (`redacted: true`): VIN → `***` + last 5 (also inside `errors[].message`,
`errors[].context` values, `adapterLog[].text` — the `0902` VIN frames contain the ASCII hex; mask
the ASCII when the decoded 17 chars match the VIN), `adapter.deviceId` MAC/UUID → masked
(`AA:BB:CC:**:**:**` / `<device-id>`), `adapter.deviceName` kept (model-ish names like `IOS-Vlink`
are not personal — but drop it if it equals a user-set phone name pattern? keep simple: keep),
`description` untouched, URLs in error context (`baseUrl`) → `<url>`, any `apiKey` context key
removed. Implement via the shared `scrubText` from `src/shared/lib/scrub.ts` (plan 31) — if plan 31
has not landed, create that file here with the rules listed in plan 31 and the same tests.

### Hook `src/features/feedback/hooks/useFeedbackBundle.ts`

Collects the `BundleInput` from stores (`useErrorLogStore.getState().errors`,
`adapterLogSnapshot()`, `useSessionStore.getState()`, active profile, `useScanHistoryStore.getState().scans[0]`,
`useSettingsStore.getState().adapterSource`, `Constants.expoConfig?.version`, `Platform`),
calls `redactBundle`, writes `bolid-feedback-<stamp>.json` and `.md` to `documentDirectory`
(tolerant imports exactly as `useErrorLogExport`), and exposes:

```ts
{ build(description: string, keepIdentifiers: boolean): Promise<FeedbackBundle>;
  shareJson(): Promise<string | null>; shareMarkdown(): Promise<string | null>;
  openIssue(): Promise<void>;    // Linking.openURL(issueUrl(bundle))
  email(): Promise<void>;        // Linking.openURL(mailtoUrl(bundle, FEEDBACK_EMAIL)) — FEEDBACK_EMAIL from app.json extra.feedbackEmail, omitted ⇒ button hidden
  busy: boolean; sizeBytes: number | null }
```

### Screen `src/features/feedback/ui/FeedbackScreen.tsx` (route `/feedback`, hidden tab)

1. Title "Report a problem" · subtitle "Share what happened and the app's logs — identifiers are
   removed unless you choose to keep them."
2. `Input multiline` "What were you doing? What did you expect?" (≤ 2 000 chars).
3. Checklist of what the bundle contains with live counts: `N errors`, `M adapter log lines`,
   `app vX.Y.Z · Android 14`, `vehicle: <name> (VIN hidden)`, `last module scan: yes/no`.
4. Toggle **Keep VIN and adapter address** (default off) with the hint "Only turn this on if the
   maintainer asked for them."
5. Buttons: **Share bundle (JSON)**, **Share summary (Markdown)**, **Open GitHub issue**,
   **Email** (if configured). After a share, a small "Thanks — bundle saved to the app folder"
   line with the file name.
6. Footer: link to the privacy policy (plan 08) and the sentence "Nothing is sent until you choose
   where to share it."

Entry points: More → Tools → **Report a problem** (icon `MessageSquareWarning` from lucide — verify
it exists in `lucide-react-native` 1.17; fallback `Bug`); the error-log screen header gets a
**Report** button navigating to `/feedback`; `RootErrorBoundary` fallback text already points to
More → Error log — change it to "Try again, or report it from More → Report a problem".

### Dev-only helper

Settings → Developer: **Preview feedback bundle** opens `/feedback` with the bundle pre-built and
shows `sizeBytes` so size regressions are visible (the adapter log of a 10-minute sniff can be
large — the ring buffer caps it at 300 lines, so expect < 200 KB).

## Steps

1. `scrub.ts` (if absent) + tests; `feedbackBundle.ts` + tests.
2. `npx expo install expo-constants`; `useFeedbackBundle.ts`; `FeedbackScreen.tsx`; route
   `src/app/feedback.tsx`; `_layout.tsx` hidden tab; More entry; Error-log header button;
   boundary copy.
3. `docs/features/feedback.md` (new spec), `docs/features/error-log.md` (relationship),
   `docs/features/more.md`.
4. `npm run ci`.

## Simulator

Works fully in simulator mode (errors can be provoked by connecting with the ignition-off scenario
or the **Send test error** dev button; the adapter log fills from any simulator session; a module
scan on the Golf simulator populates `scans[0]`). Nothing hardware-specific.

## Tests

- `feedbackBundle.test.ts`: redaction of VIN in `vehicle.vin`, in an error message and in an
  adapter-log `49 02 …` ASCII frame; MAC masking; `apiKey` context key dropped; `keepIdentifiers:
true` leaves everything; `bundleToJson` is stable (same input → same string); `bundleToMarkdown`
  caps errors/log lines and includes the `<details>` block only when a scan report exists;
  `issueUrl` encodes the title/body and stays under 8 000 chars for a 500-error bundle; `mailtoUrl`
  contains no log lines.
- `scrub.test.ts` as in plan 31.
- Plan 10 UI test: `FeedbackScreen.test.tsx` renders counts from seeded stores and disables share
  buttons while `busy`.

## Docs

- New `docs/features/feedback.md` (UI / hooks / api / model / Behavior / Acceptance / Redaction
  table).
- `docs/features/error-log.md`, `docs/features/more.md`, privacy policy ("Sharing a problem report").

## Acceptance

- [ ] Simulator Golf connected, one injected error: More → Report a problem shows `1 error`, the
      adapter log count, `vehicle: VW Golf Plus 2009 (VIN hidden)`; **Share bundle (JSON)** opens the
      share sheet; the JSON contains `***03398` and no full VIN, no `http` URL.
- [ ] Toggle **Keep VIN and adapter address** → the JSON contains the full VIN; `redacted: false`.
- [ ] **Open GitHub issue** launches the browser on `github.com/AlexandruOlariu/bolid_tester/issues/new`
      with the title and the Markdown summary prefilled.
- [ ] `RootErrorBoundary` copy points to the new screen.
- [ ] `npm run ci` green.

## Out of scope

Uploading bundles to a server (there is none); attaching files to the GitHub issue automatically
(the API needs auth; the user attaches the shared file manually).
