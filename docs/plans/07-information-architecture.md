# Plan 07 — Information architecture: More, Settings, Live

**Size:** M (1 day) · **Depends on:** plans 04 and 06 · **Roadmap:** v0.3 "Information
architecture", "Dashboard presets"

## Goal

More becomes a grouped, searchable hub with experimental tools visibly segregated; Settings
separates user preferences from developer/simulator controls and removes the dead imperial unit path (metric only); the standalone Sensor readings screen folds into the Live tab as an "All sensors" view.

## Why

`MoreScreen.tsx` is a flat list of 22 entries where Coding sits next to Maintenance log.
`SettingsScreen.tsx` mixes the simulator with the theme and carries a dead imperial code path (`settingsStore.units`, `shared/lib/units.ts`, conversions in Dashboard and Trips) that no Settings control ever exposed. The app is **metric only** by decision (2026-11-08), so the path is deleted rather than surfaced. `sensor-readings`
duplicates Live with no store, hook or spec.

## Read first

- `src/features/more/ui/MoreScreen.tsx` (`ENTRIES`, `Entry`), `src/features/more/api/updates.ts`.
- `src/features/settings/ui/SettingsScreen.tsx` (section helpers), `src/shared/state/settingsStore.ts`.
- `src/features/live-data/ui/DashboardScreen.tsx` (customise mode, `GAUGES`, `FuelEconomyCard`),
  `hooks/useLiveData.ts`, `src/features/sensor-readings/ui/SensorReadingsScreen.tsx` (`GROUPS`).
- `src/app/_layout.tsx` hidden routes; `src/app/sensor-readings.tsx`.
- `src/features/onboarding/model/onboardingStore.ts` (`reset` for "Show hints again").
- `docs/features/{more.md, settings.md, live-data.md}`.

## Design

### More

`src/features/more/model/sections.ts` (pure, tested):

```ts
export interface MoreEntry {
  route: string;
  title: string;
  subtitle: string;
  icon: IconName;
  experimental?: boolean;
  keywords?: string[];
}
export interface MoreSection {
  id: 'diagnose' | 'drive' | 'ownership' | 'workshop' | 'tools';
  title: string;
  blurb?: string;
  entries: MoreEntry[];
}
export const MORE_SECTIONS: MoreSection[];
export function filterSections(sections: MoreSection[], query: string): MoreSection[]; // case-insensitive over title/subtitle/keywords; empty query → all
```

Grouping:

| Section                                                                                                            | Entries                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Diagnose                                                                                                           | Diagnose (AI), Used-car inspection, History                                                                      |
| Drive                                                                                                              | Charts, Performance, Trips, Alerts                                                                               |
| Ownership                                                                                                          | Maintenance log, Battery & charging, DPF / regen, VIN decoder, Notifications                                     |
| Workshop 🧪 (blurb: "Talks to control modules beyond the engine. CAN cars only; addresses are confirmed per car.") | Module scan, Adaptations, Routines & output tests, Coding, Service reset, Bus sniffer — all `experimental: true` |
| Tools                                                                                                              | Adapter health, Error log, Check for updates (special row)                                                       |

`MoreScreen.tsx`: a search `Input` at the top (placeholder "Search tools…"), sections rendered with
`SectionLabel`-style headers, the 🧪 badge (`Text` chip "experimental") on flagged rows, and the
same `accessibilityLabel` pattern. Icons: keep the current lucide mapping in a `Record<IconName,
Icon>` inside the UI file so the model stays icon-free (and testable in node).

### Settings

Order and content:

1. **General** — Theme (existing); Language
   (placeholder until plan 11; omit now).
2. **Connection** — Auto-reconnect (existing); Poll interval (moved here).
3. **AI assistant** — existing `AiSection`.
4. **Notifications** — link row → `/notifications` (prefs live there).
5. **Developer & simulator** — collapsed by default (`useState(false)`, header shows "Show"):
   Adapter source, Simulated vehicle, Injected DTCs (+ Custom), Adapter log + Export fixture + Clear,
   **Show hints again** (`useOnboardingStore.getState().reset()`), **Reset all app data** (iterates
   the persisted stores' `persist.clearStorage()` — list them explicitly: settings, vehicle, garage,
   history, errors, maintenance, alerts, notifications, trips, scan history, onboarding, dashboard
   layout — with `Alert.alert` double confirm). The simulator banner (plan 01) remains the always-on
   indicator.
6. **About** — version (`Constants.expoConfig?.version`), build (`Constants.expoConfig?.extra?.build`
   if present), links to the docs repo; this row doubles as the place for the privacy policy (plan
   08).

### Metric only — delete the imperial path

The app is metric only. Remove, do not hide:

- `src/shared/lib/units.ts` and `units.test.ts`: delete (`UnitSystem`, `CONVERSIONS`, `convert`, `convertValue`, `displayUnit`). Plan 11 adds locale number formatting in a new `format.ts`; nothing else needs this module.
- `src/shared/state/settingsStore.ts`: remove `UnitSystem`, `units`, `setUnits` and the `units` key in `partialize`; `migrateSettings` (plan 01) drops a stale `units` key from persisted blobs.
- `src/features/live-data/ui/DashboardScreen.tsx`: `FuelEconomyCard`, `GaugeItem` and the value-card helper render canonical values and unit labels directly (`g.unit`, `v.unit`); remove the `units` selector.
- `src/features/trip-recording/ui/TripScreen.tsx`: render km and km/h directly; remove the selector.
- `docs/features/settings.md`: replace "Units (metric default)" with "Metric only — no unit conversion layer".
- Acceptance: `grep -rn "UnitSystem\|imperial\|displayUnit\|convertValue" src` returns nothing.

### Live tab: fold Sensor readings

- `DashboardScreen` gets a two-segment switch under the title: **Dashboard** | **All sensors**
  (local `useState`, persisted in `dashboardLayoutStore` as `view: 'dashboard' | 'sensors'` per
  profile — optional; default dashboard).
- Move `GROUPS` and the grouped rendering into `src/features/live-data/ui/SensorGroups.tsx`; the
  injection-DID block moves with it (it reads `profile.extendedPids` with `category 'injection'`).
  `useLiveData()` with no PID argument registers the effective set when the sensors view is shown
  (the dashboard view keeps its explicit visible-PID registration).
- Delete `src/features/sensor-readings/`, `src/app/sensor-readings.tsx`, the `_layout.tsx` hidden
  route, the More entry; add a `sensor-readings → live-data` alias in `featureDocsSync.test.ts` only
  if a doc with that name was created by plan 04 (otherwise nothing).

### Dashboard presets (roadmap item, same area)

`dashboardLayout.ts`: `presetFor(fuel: Fuel): ProfileLayout` — diesel: RPM, speed, coolant gauges;
cards boost (010B), oil temp (015C), MAF (0110), fuel rate (015E), voltage; petrol: RPM, speed,
coolant; cards STFT/LTFT (0106/0107), timing (010E), MAP/MAF, voltage, fuel level (012F); hybrid:
petrol set + voltage first. Applied when a profile has no saved layout (`EMPTY_LAYOUT` today).
Pure + tested.

## Steps

1. `more/model/sections.ts` + `sections.test.ts`; rewrite `MoreScreen.tsx`.
2. `SettingsScreen.tsx` sections incl. Developer collapse, Show hints again, Reset all app
   data, About.
3. Delete the imperial path (units.ts + test, settingsStore fields, Dashboard/Trip selectors, docs).
4. `live-data/ui/SensorGroups.tsx`; segment in `DashboardScreen`; remove the slice/route/entry.
5. `dashboardLayout.presetFor` + test; use in `DashboardScreen` when no layout saved.
6. Docs; `npm run ci`.

## Tests

- `sections.test.ts`: every hidden route in `_layout.tsx` (hard-code the list in the test and keep
  it in sync) appears in exactly one section except the two reachable from Info (`/extended`,
  `/vin-decode` is in Ownership — adjust the exception list to what is true); `filterSections('dpf')`
  returns only Ownership with the DPF entry; empty query returns all.
- `dashboardLayout.test.ts`: `presetFor('diesel')` lists `010B` before `0106`; petrol includes
  `0106`; unknown fuel → `EMPTY_LAYOUT`.
- Metric only: the grep in the design section is empty; `units.test.ts` is deleted with its module; `npm run typecheck:app` proves no caller remains.

## Docs

- `docs/features/more.md`: sections, search, experimental badge.
- `docs/features/settings.md`: new order, metric-only note, Developer section, Reset all app data (list of
  stores cleared), About.
- `docs/features/live-data.md`: "All sensors" view, presets by fuel.
- Remove `docs/features/sensor-readings.md` if it exists; update `docs/phase2-mobile-app.md` map.

## Acceptance

- [ ] More shows five sections; typing `cod` filters to Coding (Workshop) only; Workshop rows carry
      the experimental chip.
- [ ] No imperial code remains (grep above is empty); Dashboard and Trips still show km/h, °C, km and L/100km.
- [ ] Developer section collapsed on open; **Show hints again** brings back the first-run card;
      **Reset all app data** returns the app to a fresh state (BLE default, no garage, no history).
- [ ] Live → **All sensors** shows grouped cards; `/sensor-readings` no longer exists; no More
      entry for it.
- [ ] A new petrol user vehicle (plan 06) with no saved layout shows fuel trims on the dashboard.
- [ ] `npm run ci` green.
