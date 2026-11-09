# Feature: vehicle-select

Choose the **active car**: a car from **My garage** (cars you added on this phone) or a **built-in
profile** (the curated registry, including **Auto / Generic**). Every per-car feature — live data,
fault codes, history, scans, maintenance, the dashboard layout, trips — follows the active car.
Garage cars and learned profiles landed with [plan 06](../plans/06-garage-learned-profiles.md).

## UI

- **VehicleSelectScreen** (`/vehicle`), top to bottom:
  - **Recognition cards** (only while connected): when the connected car's VIN matches a garage car
    that is not active, "The connected car is _name_ from your garage — tap to switch to it". When no
    garage car matches, the registry suggestion stays as before ("The connected car's VIN (…) matches
    _profile_ — tap to switch to that profile", `suggestProfilesForVin`). A garage match hides the
    registry suggestion.
  - **My garage** — the copy "Cars you add here are remembered on this phone. Built-in profiles are
    curated and documented.", then two actions:
    - **Add from connected car** — disabled (with the hint "Connect to a car first…") until a session
      is connected; creates a garage car from the live connection, selects it and opens Live. When
      the connected VIN already belongs to a garage car the button reads **Re-learn from connected
      car** (hint: "The connected car is already in your garage as _name_ — …") and re-learns that
      car in place (`learnFromConnectedCar({ existingId })`, name / fuel / notes kept) instead of
      adding a duplicate with the same VIN.
    - **Add manually** — opens the editor sheet empty.

    Then one card per garage car: name plus VIN suffix (`Volkswagen 2009 ·03398`), chips for year,
    fuel, the learned protocol (or "added by hand") and the learned PID count, "Based on _base
    profile_ · VIN …", notes, and **Edit** / **Delete** buttons (long-press also opens Edit).
    **Delete** asks first (`Alert.alert`): "_name_ is removed from your garage. Its history, scans
    and trips stay on this phone." Tapping a card selects it and opens Live.

  - **Built-in profiles** — the registry cards (name, expected protocol, "experimental" when the
    profile has Mode 22 reads, notes), unchanged.

- **VehicleEditorSheet** — name (required), year (numeric, 1980 to next year, or blank), fuel
  (Petrol / Diesel / LPG / Hybrid / Other), **base profile** (registry list, with the warning that a
  specific profile brings its experimental, car-specific tools), notes. **Save** →
  `garageStore.add` / `update`. Footer: **Share garage as JSON** (`bolid-garage-<stamp>.json` through
  the OS share sheet; `useGarageExport` wraps `api/garageExportFile.ts`, which writes through
  `expo-file-system/legacy` — the root module of this SDK has no `documentDirectory` — and logs a
  `vehicle-select/export` warning whenever nothing was written). Import is out of scope here (roadmap "Profile import /
  export", [plan 13](../plans/13-profile-labelpack-import-export.md)).

## Garage cars and learned profiles

A garage car is a `UserVehicle` (`src/shared/vehicles/userVehicle.ts`):
`{ id: 'user:<random>', name, year?, fuel, make?, baseProfileId, learned?, notes?, loginCodes?,
createdAt, updatedAt }`. `loginCodes` is the car's **code book** (plan 22): KWP module login codes
the user chose to remember on the [Adaptations](./adaptations.md#code-book) screen. `learned` is a `LearnedIdentity` read from the live `SessionInfo`
(`learnedFromSessionInfo`): protocol, the observed Mode 01 PID set, VIN, calibration id, adapter
version, `learnedAt`.

`buildUserProfile(user, base)` turns it into the runtime `VehicleProfile` every feature reads:

- identity from the user record — `id`, `name`, `year ?? base.year`, `fuel`, `make ?? base.make`,
  `notes ?? ''`, `baseProfileId: base.id`;
- `expectedProtocol` and `supportedPids` from `learned` when present, else from the base;
  `vinPatterns` = the learned VIN's first 8 characters, else the base's; `dtcModes` from the base;
- the per-car experimental arrays (`extendedPids`, `modules`, `adaptations`, `routines`,
  `codingModules`, `codingPresets`, `serviceReset`, `moduleSensors`, `mode06Tests`,
  `gatewayInstallList`, and any documented `loginCodes`) copied from the base **only when the base
  is not `generic`** — picking e.g. the Golf as base is an explicit opt-in to the Golf's
  illustrative data;
- never `knownFaults`; `testChecklist` is `[]`.

**Login codes in the editor.** Editing a garage car shows a **Login codes** section: one row per
module (address, purpose, the code masked as `•••••` with a **Show** / **Hide** toggle) and
**Delete**. A deletion takes effect on **Save** (Cancel keeps the code). A new car has no section —
codes are added only by ticking **Remember for this car** in the login sheet. A registry car's
remembered codes live in the login book (`bolid.loginBook`) instead and are forgotten from the
Adaptations screen. Persisted codes are sanitized on load (`sanitizeLoginCodes`). The garage JSON
export carries them.

Fault guides are curated per registry profile; a garage car uses its base profile's guides
(`curatedProfileId`).

## Learn this car

`learnFromConnectedCar({ existingId?, baseProfileId? })` (`api/learnVehicle.ts`) needs a connected
session (returns `null` otherwise). A new car gets `name = defaultVehicleName(vin)` ("Volkswagen
2009" from the maker and the model year `decodeVin` reads; the maker alone when the VIN carries no
year, as on many European VINs; "My car" for an unknown maker), `year` from the VIN when encoded,
`fuel` from the base (default base `generic`), and `make` from the VIN's maker (VW / Audi / SEAT /
Škoda → `vag`, Fiat / Alfa Romeo / Lancia → `fiat`, else none). It is added and selected. With
`existingId` the identity is re-learned in place and the name / fuel / notes are kept.

## Resolution — the active profile

`resolveProfile(id, garage)` (`src/shared/vehicles/resolve.ts`, pure): registry hit → that profile;
else a garage car → `buildUserProfile(car, getVehicleProfile(car.baseProfileId))`; else `generic`.
`src/shared/state/activeProfile.ts` wraps it for the app (it lives in shared state so a feature
reads the active car without importing this slice; `api/activeProfile.ts` here re-exports it):

- `getActiveProfile()` — non-hook (services, EngineHost's loop, event handlers);
- `useActiveProfile()` — hook, re-resolved when the selection or the garage changes.

Both share a one-entry cache, so they hand out the same object until something changes. No code
calls `getVehicleProfile(selectedProfileId)` directly any more. `vehicleLabel(profile)` keeps
working; a garage name that already contains its year is not suffixed again ("Volkswagen 2009", not
"Volkswagen 2009 (2009)").

## VIN auto-select

`settings.autoSelectByVin` (default on, Settings → "Recognise my cars by VIN", settings v4). On
every new connection EngineHost passes the `SessionInfo` VIN to `autoSelectGarageCarForVin(vin)`:
when it equals a garage car's learned VIN (`pickVehicleForVin`, case- and space-insensitive, the most
recently updated car on a tie) that car is selected and an info notification says "Car recognised ·
_name_" (only when the selection actually changed). Registry profiles are never auto-selected — they
stay a suggestion on this screen.

## Per-car data

- **History** and **module scans** are keyed by `HistoryVehicle` (`vin:<VIN>` first, else
  `id:<profile id>`); services pass `{ id: profile.id, label: vehicleLabel(profile), vin }`, so a
  garage car's checks group under its VIN.
- **Maintenance** keeps one logbook per car — see
  [maintenance-log](./maintenance-log.md#per-car-logbook).
- **Dashboard layout** is keyed by profile id; garage ids work unchanged.
- **Trips** record `vehicleId`; the Trips screen filters by car — see
  [trip-recording](./trip-recording.md).
- Deleting a garage car (`deleteGarageVehicle`) falls back to `generic` when it was selected, and
  resets Settings → Simulated vehicle to the registry profile it was simulating (its base) when it
  was the simulated car; it keeps all of the above (history is VIN-keyed, not deleted).
- **Replay-fixture export** (Settings) files a garage car under its base registry id
  (`fixtureVehicleId`), never a `user:` id, so the fixture fits `fixtures/<registry id>/`.

## Simulator

Settings → Simulated vehicle also lists the garage cars. A garage car is simulated from its base
profile with the learned VIN, PID set and calibration id on top (`simulatorSourceFor`), so a car
learned from the simulated Golf reconnects with the same VIN and PIDs and is auto-selected again.
See [simulator.md](../simulator.md).

## model

- `vehicleStore` (`src/shared/state/vehicleStore.ts`, Zustand, persisted `bolid.vehicle` v1):
  `selectedProfileId` (defaults to `generic`), `select(id)` — registry or `user:` ids.
  `model/vehicleStore.ts` re-exports it for the older call sites; new code imports the shared path.
- `garageStore` (`src/shared/state/garageStore.ts`, persisted `bolid.garage` v1): `vehicles`,
  `add` (returns the car with a `user:` id), `update` (bumps `updatedAt`), `remove`, `setLearned`.
  It lives in shared state because EngineHost and services resolve profiles. Rehydration drops
  records without a usable `user:` id, name or base, strips a malformed `learned` block (the car
  stays, unlearned), and keeps a car added during hydration, writing the merged list back.
- `model/vehicleDraft.ts` — the editor's form model: `validateDraft`, `draftToVehicle`
  (unit-tested in `vehicleDraft.test.ts`).

## Behavior

- The active profile is a **hint**: the adapter still auto-detects the protocol and the runtime
  bitmap still governs which PIDs appear (`session.effectivePids(livePidFilter(profile))`).
- The **generic** profile — and every garage car on the generic base, learned or added by hand —
  shows everything the car's supported-PID bitmap reports (`livePidFilter` → no filter); generic's
  own `supportedPids` is a placeholder, not a curated list.
- Garage cars are not documented registry profiles: the `vehicle-docs-sync` test covers the
  registry only. See [vehicles/README](../vehicles/README.md#user-vehicles-vs-registry-profiles).

## Acceptance

- Always offers Auto / Generic.
- Switching cars updates the dashboard's PID set without reconnecting.
- Simulator (Golf) connected → **Add from connected car** creates "Volkswagen 2009 ·03398", selected;
  Live shows the Golf PID set; Faults history groups under its VIN.
- A Punto connection does not auto-select the Golf garage car; adding it creates a second entry.
- Reconnecting the Golf with its garage car present offers **Re-learn from connected car**, which
  refreshes that car and never adds a second entry with the same VIN.
- Deleting the selected garage car falls back to `generic` and keeps its history; deleting the
  simulated garage car resets the simulated vehicle to its base profile.
- A car added by hand on the generic base polls every PID the ECU reports, like Auto / Generic.
