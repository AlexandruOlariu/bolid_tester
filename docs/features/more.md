# Feature: more

The **More** tab: the hub that reaches every screen that is not a tab, plus **Check for updates**.
It owns no data; each entry routes to another feature's screen.

## UI

- **MoreScreen** (`ui/MoreScreen.tsx`, route `/more`, title "More", subtitle "Diagnostics,
  performance & tools") — one flat list built from the `ENTRIES` table (`route`, `title`,
  `subtitle`, `Icon`). Each row is a button labelled "_Title_. _Subtitle_" that calls
  `router.push(route)`. Order today:

  | Entry                   | Route              | Spec                                            |
  | ----------------------- | ------------------ | ----------------------------------------------- |
  | Diagnose (AI)           | `/ai-diagnose`     | [ai-diagnose](./ai-diagnose.md)                 |
  | History                 | `/history`         | [history](./history.md)                         |
  | Used-car inspection     | `/inspection`      | [used-car-inspection](./used-car-inspection.md) |
  | DPF / regen             | `/dpf`             | [dpf](./dpf.md)                                 |
  | Battery & charging      | `/battery`         | [battery-health](./battery-health.md)           |
  | Adapter health          | `/adapter-health`  | [adapter-health](./adapter-health.md)           |
  | VIN decoder             | `/vin-decode`      | [vin-decode](./vin-decode.md)                   |
  | Maintenance log         | `/maintenance`     | [maintenance-log](./maintenance-log.md)         |
  | Charts                  | `/charts`          | [live-charts](./live-charts.md)                 |
  | Performance             | `/performance`     | [performance-tests](./performance-tests.md)     |
  | Trips                   | `/trips`           | [trip-recording](./trip-recording.md)           |
  | Alerts                  | `/alerts`          | [alerts](./alerts.md)                           |
  | Sensor readings         | `/sensor-readings` | [sensor-readings](./sensor-readings.md)         |
  | Sensor tests            | `/sensors`         | [sensor-tests](./sensor-tests.md)               |
  | Module scan             | `/module-scan`     | [module-scan](./module-scan.md)                 |
  | Service reset           | `/service-reset`   | [service-reset](./service-reset.md)             |
  | Coding                  | `/coding`          | [coding](./coding.md)                           |
  | Adaptations             | `/adaptations`     | [adaptations](./adaptations.md)                 |
  | Routines & output tests | `/routines`        | [routines](./routines.md)                       |
  | Notifications           | `/notifications`   | [notifications](./notifications.md)             |
  | Bus sniffer             | `/sniffer`         | [can-sniffer](./can-sniffer.md)                 |
  | Error log               | `/error-log`       | [error-log](./error-log.md)                     |

- A last row, **Check for updates** ("Over-the-air app updates"), shows a spinner and "Checking…"
  while a check runs and ignores taps until it finishes.
- Not built yet (plan 07, [information architecture](../plans/07-information-architecture.md)):
  grouping into Diagnose · Drive · Ownership · Workshop · Tools, an **experimental** badge on the
  write-capable Workshop entries (module scan, adaptations, routines, coding, service reset), and a
  search field. Until then the gated screens carry their own warnings.

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

None. The entry table is a constant in `MoreScreen.tsx`.

## Hidden routes and where they are reached

`src/app/_layout.tsx` registers 23 hidden routes (`href: null`). 22 are More entries (above). The
remaining one, plus one that is also in More, are linked from the **Info** tab
([vehicle-info](./vehicle-info.md)) once a session is connected:

- `/extended` — **Extended PIDs (experimental)**, not in More; besides Info, a fault guide's
  **Related data** button (Faults row and DTC detail sheet) opens it with `?dids=…`;
- `/vin-decode` — **Decode VIN**, also a More entry.

## Acceptance

- Every hidden route in `_layout.tsx` is reachable from More or from Info (`/extended`,
  `/vin-decode`); nothing hidden is orphaned.
- Every row is an accessible button whose name starts with its title; tapping **Error log** pushes
  `/error-log` (`MoreScreen.test.tsx`).
- **Check for updates** in a build without `expo-updates` (tests, dev client) shows "Updates
  unavailable" and logs nothing; in a release build with a newer bundle it offers to restart into
  it.
