# Plan 06 — Garage (multiple cars) and learned profiles

**Size:** L (2–3 days) · **Depends on:** plan 05 (`make` on profiles) · **Roadmap:** v0.3
"Garage", "Learn this car"

## Goal

Users keep **several cars** in the app, create a car **from a live connection** (VIN, protocol,
supported-PID bitmap, calibration id) or manually, and every per-car store (history, scans,
maintenance, dashboard layout) follows the active car. Built-in registry profiles remain the
curated, documented tier; user vehicles inherit from one of them.

## Why

`src/features/vehicle-select/model/vehicleStore.ts` holds one `selectedProfileId` over the
hard-coded `VEHICLE_PROFILES`. Adding a car means TypeScript + Markdown + a sync test. A generic
diagnostics app must work for a car it has never seen and remember it.

## Read first

- `src/shared/vehicles/{index.ts, types.ts, vinSuggest.ts, generic.ts}`; `vehicle-docs-sync.test.ts`.
- `src/features/vehicle-select/{model/vehicleStore.ts, ui/VehicleSelectScreen.tsx}`.
- Every `getVehicleProfile(` call site (`grep -rn "getVehicleProfile(" src --include=*.ts*`):
  `EngineHost.tsx`, `useLiveData.ts`, `dtcService.ts`, `DashboardScreen.tsx`,
  `SensorReadingsScreen.tsx`, `FaultCodesScreen.tsx`, module-scan / adaptations / routines /
  coding / service-reset / dpf / extended-pids hooks — list them all before starting.
- `src/shared/state/historyStore.ts` (`HistoryVehicle`, `historyVehicleKey`),
  `src/features/module-scan/model/scanHistoryStore.ts` (uses `HistoryVehicle`),
  `src/features/live-data/model/dashboardLayoutStore.ts` (keyed by profile id),
  `src/features/maintenance/model/maintenanceStore.ts` (**not** keyed per vehicle today),
  `src/features/trip-recording/model/tripStore.ts`.
- `src/shared/obd-core/obd/vinDecode.ts` (`decodeVin`) for default names.
- `src/shared/state/persistStorage.ts`; `docs/features/vehicle-select.md`; `docs/vehicles/README.md`.

## Design

### Types (`src/shared/vehicles/userVehicle.ts`, pure)

```ts
export interface LearnedIdentity {
  protocol: ProtocolId;
  supportedPids: string[]; // observed Mode 01 set (from SessionInfo.supportedPids)
  vin: string | null;
  calibrationId: string | null;
  adapterVersion?: string;
  learnedAt: number;
}
export interface UserVehicle {
  id: string; // `user:${uuid}` — never collides with registry ids
  name: string; // "Dacia Logan 2015"
  year?: number;
  fuel: Fuel;
  make?: DtcMake; // plan 05
  /** Registry profile to inherit everything else from (extended PIDs, modules, routines…). */
  baseProfileId: string; // default 'generic'
  learned?: LearnedIdentity;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}
/** Build a runtime VehicleProfile for a user vehicle: identity fields from the user record, observed PIDs/protocol when learned, everything else from the base profile. Pure. */
export function buildUserProfile(user: UserVehicle, base: VehicleProfile): VehicleProfile;
/** Pure extraction from a live SessionInfo. */
export function learnedFromSessionInfo(info: SessionInfo): LearnedIdentity;
/** Default display name from a VIN ("Volkswagen 2009") or "My car". */
export function defaultVehicleName(vin: string | null): string;
export const isUserVehicleId = (id: string) => id.startsWith('user:');
```

`buildUserProfile` rules: `id = user.id`; `name`, `year ?? base.year`, `fuel`, `make ?? base.make`;
`expectedProtocol = learned?.protocol ?? base.expectedProtocol`; `supportedPids =
learned?.supportedPids ?? base.supportedPids`; `vinPatterns = learned?.vin ? [learned.vin.slice(0, 8)] :
base.vinPatterns`; `dtcModes = base.dtcModes`; `knownFaults` omitted; `notes = user.notes ?? ''`;
`testChecklist = []`; all experimental arrays (`extendedPids`, `modules`, `adaptations`, `routines`,
`codingModules`, `codingPresets`, `serviceReset`, `moduleSensors`, `mode06Tests`,
`gatewayInstallList`) copied from `base` **only when `base.id !== 'generic'`** (they are per-car
illustrative data; a user who picks the Golf as base knowingly opts in).

### Store (`src/shared/state/garageStore.ts`, persisted `bolid.garage` v1)

```ts
interface GarageState {
  vehicles: UserVehicle[];
  add: (v: Omit<UserVehicle, 'id' | 'createdAt' | 'updatedAt'>) => UserVehicle;
  update: (id: string, patch: Partial<Omit<UserVehicle, 'id' | 'createdAt'>>) => void;
  remove: (id: string) => void;
  setLearned: (id: string, learned: LearnedIdentity) => void;
}
```

Lives in `shared/state` (not the feature) because EngineHost and services resolve profiles.

### Resolution

`src/shared/vehicles/resolve.ts` (pure): `resolveProfile(id: string, userVehicles: UserVehicle[]):
VehicleProfile` → registry hit, else user vehicle via `buildUserProfile(user,
getVehicleProfile(user.baseProfileId))`, else `generic`.

App-level helpers in `src/features/vehicle-select/api/activeProfile.ts`:

```ts
export function getActiveProfile(): VehicleProfile; // non-hook: vehicleStore + garageStore
export function useActiveProfile(): VehicleProfile; // hook, memoised on the two stores
```

Replace every `getVehicleProfile(useVehicleStore.getState().selectedProfileId)` with
`getActiveProfile()` and every hook-side pair with `useActiveProfile()`. `vehicleStore.select(id)`
accepts user ids. `vehicleLabel(profile)` keeps working (name + year).

### Learn this car (`src/features/vehicle-select/api/learnVehicle.ts`)

```ts
/** Requires a connected session. Creates a user vehicle from SessionInfo (or updates `existingId`), selects it, returns it. */
export function learnFromConnectedCar(opts: {
  existingId?: string;
  baseProfileId?: string;
}): UserVehicle | null;
```

Uses `useSessionStore.getState().info`; `name = defaultVehicleName(info.vin)`; `fuel` from base;
`make` from `decodeVin(vin).manufacturer` mapping (VW/Audi/Seat/Skoda → `'vag'`, Fiat/Alfa/Lancia →
`'fiat'`, else undefined).

### VIN auto-select

On connect (`connectionService.connectInternal` after `setConnected`), if `settings.autoSelectByVin`
(new boolean, default `true`, persist version 3 — reuse plan 01's `migrateSettings`) and
`info.vin` equals a garage vehicle's `learned.vin`, call `useVehicleStore.getState().select(id)` and
`logError`-free info toast via `notify({ category: 'connection', severity: 'info', title: 'Car
recognised', body: name })`. Registry suggestion (`suggestProfilesForVin`) stays as today for
built-ins.

### Per-car stores

- `maintenanceStore` → v2: `{ byVehicle: Record<string, { entries, odoKm, kmPerYear }> }`; `migrate`
  moves v1 data under the key of the currently selected vehicle at migration time (read
  `useVehicleStore.getState().selectedProfileId`; if unavailable use `'generic'`). Hook
  `useMaintenance` reads the active key. Key = `historyVehicleKey({ id, vin })` so a learned VIN and
  a later re-learn share data.
- `dashboardLayoutStore`: already keyed by profile id — user ids work; no change.
- `historyStore`, `scanHistoryStore`: already `HistoryVehicle`-keyed (VIN first) — pass
  `{ id: profile.id, label: vehicleLabel(profile), vin }`; no shape change.
- `tripStore`: add `vehicleId?: string` to `TripSummary` (optional, old trips show under "Unknown
  car"); filter chip on the Trips screen.

### UI (`VehicleSelectScreen.tsx`)

Sections: **My garage** (user vehicles: name, year, fuel chip, VIN suffix, protocol if learned;
long-press or ⋯ → Edit / Delete with `Alert.alert` confirm), **Built-in profiles** (existing cards).
Top actions: **Add from connected car** (disabled with hint when not connected) and **Add manually**.
`VehicleEditorSheet.tsx`: name, year (numeric), fuel segmented, base profile picker (registry list),
notes; Save → `garageStore.add/update`. Copy under the garage header: "Cars you add here are
remembered on this phone. Built-in profiles are curated and documented."

### Export (small, in scope) / Import (out of scope)

`garageStore` → **Share garage as JSON** button in the editor sheet footer (same export pattern).
Import needs `expo-document-picker`; roadmap v0.3 "Profile import / export" — leave a stub note.

## Steps

1. `userVehicle.ts` + tests; `resolve.ts` + tests; `garageStore.ts` + test (node-safe like other stores).
2. `activeProfile.ts`; migrate all call sites; `npm run typecheck:app`.
3. `learnVehicle.ts`; `connectionService` VIN auto-select + setting; `settingsStore` v3.
4. `maintenanceStore` v2 + migration test; `tripStore.vehicleId`.
5. `VehicleSelectScreen` sections, `VehicleEditorSheet`, export.
6. Docs; `npm run ci`.

## Simulator

`buildScenario(profileId)` only knows registry ids. In `connectionService` simulator branch, when
the selected vehicle is a user vehicle, build the scenario from its `baseProfileId` and override
`vin` with `learned?.vin` and `supportedPids` with `learned?.supportedPids` when present
(`buildScenario(base, { vin, supportedPids })`). Test: a user vehicle learned from the Golf
simulator reconnects in the simulator with the same VIN and PID set.

## Tests

- `userVehicle.test.ts`: `buildUserProfile` inherits experimental arrays from a non-generic base,
  not from generic; learned PIDs override base; `vinPatterns` from VIN; `learnedFromSessionInfo`
  copies fields; `defaultVehicleName('WVWZZZ1KZ9W903398')` contains "Volkswagen" and "2009".
- `resolve.test.ts`: registry id, user id, unknown id → generic.
- `garageStore.test.ts`: add returns `user:` id; update bumps `updatedAt`; remove.
- `maintenanceStore.test.ts`: v1 blob migrates under the selected key.
- `connectionService` is RN-bound; keep the VIN auto-select decision in a pure
  `pickVehicleForVin(vin, vehicles, profiles)` with a test.

## Docs

- `docs/features/vehicle-select.md`: garage, learn, editor, auto-select, export.
- `docs/vehicles/README.md`: "User vehicles vs registry profiles" (sync test applies to registry
  only; how a user vehicle inherits a base).
- `docs/features/maintenance-log.md`: per-car logbook + migration.
- `docs/architecture.md`: `garageStore` in the state list.

## Acceptance

- [ ] Simulator (Golf) connected → Vehicle → **Add from connected car** creates "Volkswagen 2009 ·
      03398", selected; Live shows the Golf PID set; Faults history groups under its VIN.
- [ ] Disconnect, switch Settings simulated vehicle to Punto, connect → the Punto VIN does not
      auto-select the Golf user car; adding it creates a second garage entry.
- [ ] Maintenance entries added while car A is active are not shown for car B; an upgrade from a
      v1 maintenance file keeps the old entries under the car that was selected.
- [ ] Deleting a garage car that is selected falls back to `generic` and keeps history (history is
      VIN-keyed, not deleted).
- [ ] `npm run ci` green; no remaining direct `getVehicleProfile(useVehicleStore…)` call sites
      (`grep` returns none).
