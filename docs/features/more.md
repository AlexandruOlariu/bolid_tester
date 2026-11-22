# Feature: more

The **More** tab: the hub that reaches every screen that is not a tab, plus **Check for updates**.
It owns no data; each entry routes to another feature's screen.

## UI

- **MoreScreen** (`ui/MoreScreen.tsx`, route `/more`, title "More", subtitle "Diagnostics,
  ownership & workshop tools") — a **search field** (placeholder "Search tools…", label "Search
  tools") above five **sections** built from `MORE_SECTIONS` (`model/sections.ts`, plan 07). Each
  section has an upper-case green header; each row is a button labelled "_Title_. _Subtitle_" (with
  ". Experimental" appended on Workshop rows) that calls `router.push(route)`:

  | Section     | Entry                   | Route             | Spec                                            |
  | ----------- | ----------------------- | ----------------- | ----------------------------------------------- |
  | Diagnose    | Diagnose (AI)           | `/ai-diagnose`    | [ai-diagnose](./ai-diagnose.md)                 |
  |             | Used-car inspection     | `/inspection`     | [used-car-inspection](./used-car-inspection.md) |
  |             | History                 | `/history`        | [history](./history.md)                         |
  |             | Vehicle report          | `/report`         | [report](./report.md)                           |
  |             | Sensor tests            | `/sensors`        | [sensor-tests](./sensor-tests.md)               |
  | Drive       | Charts                  | `/charts`         | [live-charts](./live-charts.md)                 |
  |             | Performance             | `/performance`    | [performance-tests](./performance-tests.md)     |
  |             | Trips                   | `/trips`          | [trip-recording](./trip-recording.md)           |
  |             | Alerts                  | `/alerts`         | [alerts](./alerts.md)                           |
  | Ownership   | Maintenance log         | `/maintenance`    | [maintenance-log](./maintenance-log.md)         |
  |             | Battery & charging      | `/battery`        | [battery-health](./battery-health.md)           |
  |             | DPF / regen             | `/dpf`            | [dpf](./dpf.md)                                 |
  |             | VIN decoder             | `/vin-decode`     | [vin-decode](./vin-decode.md)                   |
  |             | Notifications           | `/notifications`  | [notifications](./notifications.md)             |
  | Workshop 🧪 | Module scan             | `/module-scan`    | [module-scan](./module-scan.md)                 |
  |             | Adaptations             | `/adaptations`    | [adaptations](./adaptations.md)                 |
  |             | Routines & output tests | `/routines`       | [routines](./routines.md)                       |
  |             | Coding                  | `/coding`         | [coding](./coding.md)                           |
  |             | Service reset           | `/service-reset`  | [service-reset](./service-reset.md)             |
  |             | Bus sniffer             | `/sniffer`        | [can-sniffer](./can-sniffer.md)                 |
  | Tools       | Adapter health          | `/adapter-health` | [adapter-health](./adapter-health.md)           |
  |             | Backup & restore        | `/backup`         | [backup](./backup.md)                           |
  |             | Error log               | `/error-log`      | [error-log](./error-log.md)                     |
  |             | Report a problem        | `/feedback`       | [feedback](./feedback.md)                       |
  |             | Check for updates       | — (action row)    | [release](../release.md)                        |

- **Workshop** — header "WORKSHOP 🧪" and the blurb "Talks to control modules beyond the engine.
  CAN cars only; addresses are confirmed per car." Every Workshop row (`experimental: true`) carries
  a yellow **experimental** chip next to its title; no other row does. The gated screens keep their
  own warnings and interlocks.
- **Search** — `filterSections(MORE_SECTIONS, query)`: case-insensitive; every word of the query
  must **start a word** of the row's title, subtitle or `keywords` (so `cod` finds Coding but not
  "Decode the VIN", and `dpf` finds only DPF / regen). A section with no matching row is hidden; a
  blank query shows everything; no match shows "No tools match “…”." Keywords add the words people
  search for (e.g. `vcds` → Module scan, `ota` → Check for updates).
- **Check for updates** ("Over-the-air app updates") is the last Tools row, an action instead of a
  route: it shows a spinner and "Checking…" while a check runs and ignores taps until it finishes.
- **Two columns on wide screens** (plan 21) — on a medium / expanded window (≥ 600 dp: a tablet,
  or a phone on its side) each section's rows sit two per row (`CardGrid`, cells
  `more-grid-<section>-cell`, `flexBasis 49%`) inside the centred, width-capped `Screen` column; a
  phone in portrait keeps one column. Search, headers and blurbs are unchanged.
- **Sensor readings** is no longer here: it is the **All sensors** view of the Live tab
  ([live-data](./live-data.md#all-sensors), plan 07).

## api

`api/updates.ts` — a thin, dependency-tolerant wrapper around `expo-updates` (EAS Update), loaded
with a variable specifier so tests and builds without the native module still work:

- `checkForUpdate(): Promise<'available' | 'up-to-date' | 'unavailable'>` — `unavailable` when the
  module is missing or `Updates.isEnabled === false` (Expo Go, **dev clients**, a build without an
  updates URL); otherwise `checkForUpdateAsync()` decides between `available` and `up-to-date`. A
  failing check logs `source: 'updates/check'` (warning) and returns `unavailable`. A missing module
  is an expected no-op and is not logged.
- `fetchAndReload(): Promise<boolean>` — `fetchUpdateAsync()`, then `reloadAsync()` only when the
  fetched bundle `isNew`; returns `false` when nothing was applied. Failures log `updates/fetch`.

The screen maps the result to an alert: **Update available** ("Download and restart now?", Later /
Update → `fetchAndReload()`), **Up to date**, or **Updates unavailable** ("Over-the-air updates are
not enabled in this build."). The app never checks on its own; release channels and the OTA
procedure are in [release.md](../release.md).

## model

`model/sections.ts` (pure, no React or icons, unit-tested in node):

- `MoreEntry` — `route` (or `null` with `action: 'check-updates'`), `title`, `subtitle`, `icon`
  (an `IconName`; `MoreScreen.tsx` maps it to a lucide component), `experimental?`, `keywords?`.
- `MoreSection` — `id` (`diagnose` · `drive` · `ownership` · `workshop` · `tools`), `title`,
  `blurb?`, `entries`.
- `MORE_SECTIONS`, `entryKey(entry)`, `entryMatches(entry, query)` and
  `filterSections(sections, query)`.

## Hidden routes and where they are reached

`src/app/_layout.tsx` registers 26 hidden routes (`href: null`). 24 are More entries (above), each in
exactly one section. The other two are reached elsewhere:

- `/extended` — **Extended PIDs (experimental)**, linked from the **Info** tab
  ([vehicle-info](./vehicle-info.md)) once a session is connected, and from a fault guide's
  **Related data** button (Faults row and DTC detail sheet) with `?dids=…`;
- `/trip-detail` — a trip's detail screen, opened by **Open** on a Trips row
  ([trip-recording](./trip-recording.md)).

`/vin-decode` is a More entry (Ownership) and is also linked from Info. `/feedback` (Tools) is also
opened by the **Report** button on the Error log screen and, in preview mode, from Settings →
Developer & simulator → **Preview feedback bundle**.

## Acceptance

- More shows five sections (Diagnose · Drive · Ownership · Workshop · Tools); every hidden route in
  `_layout.tsx` is in exactly one of them except `/extended` (Info) and `/trip-detail` (Trips);
  nothing hidden is orphaned (`model/sections.test.ts` checks its route list against the layout).
- Typing `cod` filters to Coding (Workshop) only, `dpf` to DPF / regen (Ownership) only; Workshop
  rows carry the experimental chip.
- Every row is an accessible button whose name starts with its title; tapping **Error log** pushes
  `/error-log` (`MoreScreen.test.tsx`).
- **Check for updates** in a build without `expo-updates` (tests, dev client) shows "Updates
  unavailable" and logs nothing; in a release build with a newer bundle it offers to restart into
  it.
