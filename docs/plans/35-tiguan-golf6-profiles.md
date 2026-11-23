# Plan 35 — Two more registry cars: Tiguan 2.0 TDI and Golf 6 1.4 TSI

**Size:** S (½ day) · **Depends on:** — · **Roadmap:** registry growth (no roadmap item yet; add one)

## Goal

The registry gains two **thin** profiles, written from registration data only (a registration
certificate for the Tiguan, a vehicle-history report for the Golf):

| Id                  | Car                             | Engine                           | Fuel   |
| ------------------- | ------------------------------- | -------------------------------- | ------ |
| `tiguan-2014-20tdi` | VW Tiguan (5N), model year 2014 | 2.0 TDI **CFFD**, 81 kW / 110 cp | diesel |
| `golf-6-2010-14tsi` | VW Golf 6 (5K), model year 2010 | 1.4 TSI **CAXA**, 90 kW / 122 cp | petrol |

Both engine codes are confirmed by the owner. A connected Tiguan is suggested its profile by VIN; a
connected Golf 6 is offered its profile and the Golf Plus side by side (they share a VIN prefix).
Both get the VAG fault-code texts and can be picked in the simulator.

## Why

The owner has access to two more VAG cars but **only their registration data**: no VCDS scans, no
OBD2 exports, no on-car session yet. The project's evidence rule
([CONTRIBUTING.md → Evidence levels](../../CONTRIBUTING.md#3-evidence-levels)) says per-car data
comes from proof, so these profiles carry what a certificate can prove and nothing else.

## Approaches considered

- **A. Thin profile, like the Punto (chosen).** Identity, expected protocol, expected Mode 01 PIDs,
  VIN prefix, `make: 'vag'`, on-car checklist. Nothing invented; the real PID bitmap is discovered
  at connect anyway. Cost: the Tiguan has no DPF screen and neither car has a module scan until an
  on-car session.
- **B. Thin + a shared read-only diesel pack.** Move the Golf Plus `extendedPids` into a shared
  module and reuse it on the Tiguan. Rejected for now: those DIDs are illustrative even on the Golf
  Plus, and this would copy unverified values to a car where they cannot be checked.
- **C. Full copy of the Golf Plus profile.** Rejected: it would ship coding, adaptation and routine
  writes with unconfirmed addressing for a car the owner does not own.

## Inputs (all resolved)

| Car    | Source                               | What it gave                                                                                        |
| ------ | ------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Tiguan | Registration certificate             | 5N, VIN prefix `WVGZZZ5N`, model year 2014 (first registered 2013-12), 1968 cm³, 81 kW, diesel, DPF |
| Golf 6 | Vehicle-history report (carVertical) | VIN prefix `WVWZZZ1K`, model year 2010, built 2010-01, 1.4 l petrol, 90 kW, code `CAX…`             |

Engine codes CFFD and CAXA are confirmed by the owner. The history report lists the Golf's body as
an estate; body style does not change the diagnostics, so the profile does not assert one.

## Privacy rules for this plan

- The Tiguan belongs to someone else; the Golf 6 is treated the same way. **No full VIN, plate
  number, owner name or address** from either document goes into the repo, a commit message, a test
  or a fixture. Only the first 10 VIN characters are used.
- Front-matter `vin:` is omitted in both docs. Profiles carry VIN **prefixes** only.
- Simulator sample VINs are synthetic (serial `000001`), never the real ones.

## Read first

- `docs/contributing/vehicle-profile.md`, `docs/vehicles/README.md` — the two-file rule and schema.
- `docs/vehicles/fiat-punto-2008-12.md` + `src/shared/vehicles/fiat-punto-2008-12.ts` — the thin
  template to copy.
- `src/shared/vehicles/golf-plus-2009-20tdi.ts` — the PID set the Tiguan borrows; its `vinPatterns`.
- `src/shared/vehicles/vinSuggest.ts` + `vinSuggest.test.ts`.
- `src/features/vehicle-select/ui/VehicleSelectScreen.tsx` (lines ~185–260, the recognition card)
  and `VehicleSelectScreen.test.tsx`; `docs/features/vehicle-select.md`.
- `src/shared/obd-core/transport/scenarios.ts` (`SAMPLE_VINS`, `SAMPLE_CALIDS`) and
  `simFixtures.ts` (one `sim-*.json` set per registry profile).
- `src/shared/vehicles/vehicle-docs-sync.test.ts` — what the docs must satisfy.

## Deliverables

### 1. `tiguan-2014-20tdi`

`src/shared/vehicles/tiguan-2014-20tdi.ts`, exported as `tiguan2014`:

```ts
export const tiguan2014: VehicleProfile = {
  id: 'tiguan-2014-20tdi',
  name: 'VW Tiguan 2014 2.0 TDI 81 kW',
  year: 2014,
  engine: '2.0 TDI CFFD, 81 kW / 110 cp',
  fuel: 'diesel',
  make: 'vag',
  expectedProtocol: 'ISO_15765_4_CAN_11_500',
  vinPatterns: ['WVGZZZ5N'],
  supportedPids: [
    '0104',
    '0105',
    '010B',
    '010C',
    '010D',
    '010F',
    '0110',
    '0111',
    '011F',
    '0121',
    '0131',
    '0133',
    '0142',
    '0146',
    '015C',
    '015E',
  ],
  dtcModes: ['03', '07'],
  notes: '…',
  testChecklist: [
    /* mirrored from the doc */
  ],
};
```

- `supportedPids` is the Golf Plus set (same 2.0 TDI common-rail family); the doc says "expected by
  analogy, unverified".
- `dtcModes` leaves out `0A` until a car answers it.
- **No** `knownFaults`, `extendedPids`, `boost`, `modules`, `moduleSensors`, `codingModules`,
  `codingPresets`, `serviceReset`, `routines`, `adaptations`, `gatewayInstallList`.

`docs/vehicles/tiguan-2014-20tdi.md`, copied from the Punto doc. Front-matter:

```yaml
---
id: tiguan-2014-20tdi
name: VW Tiguan 2014 2.0 TDI 81 kW
expectedProtocol: ISO_15765_4_CAN_11_500
supportedPidCount: 16
extended: false
make: vag
engineCode: CFFD
validatedOn:
observedProtocol:
---
```

Sections: intro (5N body, VIN prefix `WVGZZZ5N…`, model year 2014, first registered 2013-12,
1968 cm³, 81 kW, particulate filter, factory-homologated tow bar; "written from the registration
certificate, not yet seen by the app"), Protocol, Live data we surface, Fault codes, Extended PIDs
("None defined"), On-car checklist, Validated on the car (placeholder row), Notes.

On-car checklist (doc and `testChecklist`):

1. Connect with ignition on; confirm the negotiated protocol is CAN 11/500.
2. Read VIN (Mode 09) and confirm it matches the registration certificate.
3. Start the engine; read idle live data: RPM, coolant, MAP, MAF, voltage (~14 V).
4. Compare the discovered PID list with the 16 expected; note every difference.
5. Read DTCs (Mode 03/07); note whether Mode 0A answers.

### 2. `golf-6-2010-14tsi`

`src/shared/vehicles/golf-6-2010-14tsi.ts`, exported as `golf6Tsi`:

```ts
export const golf6Tsi: VehicleProfile = {
  id: 'golf-6-2010-14tsi',
  name: 'VW Golf 6 2010 1.4 TSI 90 kW',
  year: 2010,
  engine: '1.4 TSI CAXA, 90 kW / 122 cp',
  fuel: 'petrol',
  make: 'vag',
  expectedProtocol: 'ISO_15765_4_CAN_11_500',
  vinPatterns: ['WVWZZZ1K'],
  supportedPids: [
    '0104',
    '0105',
    '0106',
    '0107',
    '010B',
    '010C',
    '010D',
    '010E',
    '010F',
    '0111',
    '011F',
    '0121',
    '0131',
    '0133',
    '0142',
  ],
  dtcModes: ['03', '07'],
  notes: '…',
  testChecklist: [
    /* mirrored from the doc */
  ],
};
```

- `supportedPids` (15) is the Punto petrol set without fuel level, plus the distance / baro PIDs
  the Golf Plus reports. The CAXA is MAP-based, so no `0110` (MAF). "Expected, unverified."
- Same omissions as the Tiguan.

`docs/vehicles/golf-6-2010-14tsi.md`: front-matter as above with `supportedPidCount: 15`,
`engineCode: CAXA`. Checklist as the Tiguan's, with step 2 checking the VIN against "the car's
documents" (there is no registration certificate for this car) and step 3 reading fuel trims (near
0 %) and timing advance instead of MAF.

### 3. VIN suggestion: a tie shows every candidate

The Golf 6 and the Golf Plus share the VIN prefix `WVWZZZ1K`. Today
`VehicleSelectScreen` shows only `suggestProfilesForVin(...)[0]`, so a Golf 6 would be offered the
Golf Plus profile (registry order).

- Patterns: both profiles declare only the family prefix, `vinPatterns: ['WVWZZZ1K']` (the Golf
  Plus unchanged). A VIN prefix cannot tell the two models apart: the model-year character does not
  identify the model (the Golf Plus was built about 2005–2014, the Golf 6 about 2008–2013).
- `vinSuggest.ts`:
  - `suggestProfilesForVin` keeps its signature; per profile it now records the **longest**
    matching pattern (not the first), so pattern order inside a profile does not matter.
  - New `topVinSuggestions(vin, profiles): VinSuggestion[]` — the suggestions tied for the longest
    `matchedPattern` (empty when none).
- `VehicleSelectScreen.tsx`: replace the single `suggestion` with
  `topVinSuggestions(vin, VEHICLE_PROFILES)`; render **one recognition card per candidate** (same
  `match.profile` / `match.profileA11y` strings, no new i18n keys); show none when a garage car
  matches or when the selected profile is already one of the candidates.
- Grep for other `suggestProfilesForVin` callers and move any `[0]` use to `topVinSuggestions`.

Result: every `WVWZZZ1K…` VIN ties, and the Vehicle screen shows both recognition cards (Golf Plus
first, registry order); the user picks. The Tiguan (`WVGZZZ5N`) is unaffected.

**Changed in review.** The first version added the model-year letter to each Golf pattern
(`WVWZZZ1K` + `Z9` / `ZA`) so each sample VIN got only its own profile; review dropped it, because
both models span several model years, so the letter matched the owner's two cars, not the models.

### 4. Registry and simulator

- `src/shared/vehicles/index.ts`: import both and append to `VEHICLE_PROFILES`
  (`[generic, golfPlus2009, fiatPunto2008, passatB55, tiguan2014, golf6Tsi]`).
- `scenarios.ts`:
  - `SAMPLE_VINS`: `'tiguan-2014-20tdi': 'WVGZZZ5NZEW000001'`,
    `'golf-6-2010-14tsi': 'WVWZZZ1KZAW000001'` (synthetic serials).
  - `SAMPLE_CALIDS`: `'SIM-CFFD-01'` and `'SIM-CAXA-01'` — visibly synthetic; the real ECU part
    numbers are unknown.
- `npm run fixtures:sim` — records `fixtures/<id>/sim-{connect,faults,clear}.json` for both ids
  (with no `knownFaults` they use `SIM_FALLBACK_STORED_DTCS`).

### 5. Tests

- `vinSuggest.test.ts`: Tiguan VIN → `tiguan-2014-20tdi`; the Golf Plus and the Golf 6 sample VINs
  (and `WVWZZZ1KZCW000001`) → both, Golf Plus first, via `topVinSuggestions`;
  `suggestProfilesForVin(...)[0]` for the Golf Plus sample VIN is still the Golf Plus; longest
  pattern wins regardless of order (synthetic profiles); no match → empty.
- `VehicleSelectScreen.test.tsx`: `VEHICLE_PROFILES` length 4 → 6; the simulated Golf Plus renders
  two cards (Golf Plus, Golf 6) and tapping one selects that profile and hides both.
- `vehicle-docs-sync`, `sim-fixtures.freshness` and `fixtures.replay` cover the new ids on their own.

### 6. Docs

- `docs/vehicles/README.md`: "three cars" → five; add both to **Example cars**, marked "from
  registration data, not validated on the car".
- `README.md` (lines ~47, ~222) and `docs/README.md` (lines ~35, ~62): the three validated cars stay
  "the owner's own"; add one sentence that two more profiles exist from registration data.
- `docs/features/vehicle-select.md`: the registry suggestion shows one card per tied candidate.
- `docs/features/settings.md` (~line 157): the simulator picker list.
- `docs/implementation-log.md` entry; `docs/roadmap.md` item; a row for plan 35 in
  `docs/plans/README.md`.
- `graph.py build`. No new concept (`concept:vehicle-profiles` covers it).

## Steps

1. Baseline: `npm run ci` green.
2. Tiguan: doc, profile, registry line, `SAMPLE_VINS` / `SAMPLE_CALIDS`; `npm test -- vehicle-docs-sync`.
3. Golf 6: same.
4. VIN suggestion change + its tests.
5. `npm run fixtures:sim`; `npm test -- sim-fixtures fixtures.replay`.
6. Docs, `npm run format`, `graph.py build`, `npm run validate:contrib`, `npm run ci`.

## Deferred until an on-car session

Per car, by the procedure in [testing.md → Recording results](../testing.md#recording-results):

- Connect; export the `connect` and `faults` fixtures; fill `validatedOn` / `observedProtocol` and
  the "Validated on the car" table. A car fixture carries the VIN: for a car that is not the
  owner's, get that owner's agreement before committing it.
- Replace `supportedPids` (and `supportedPidCount`) with the observed set; add `0A` to `dtcModes`
  if it answers.
- Record the engine ECU part number and put the real calibration id in `SAMPLE_CALIDS`.
- Then decide, with evidence in hand: `boost` ranges (both cars are turbocharged; without `boost`
  the agent's boost skill stays hidden), the Tiguan DPF pack (approach B), and `modules`.
- `knownFaults` only from a real scan of that car.

## Acceptance

- [ ] Both profiles appear on the Vehicle screen and in the simulator picker; the simulated Tiguan
      suggests its own profile at connect.
- [ ] Any `WVWZZZ1K…` VIN (the simulated Golf Plus and Golf 6 included) shows two suggestion cards,
      Golf Plus first; tapping one selects it and hides both.
- [ ] Neither profile declares any experimental array, `boost` or `knownFaults`.
- [ ] `git grep` for either car's real VIN serial, and for the Tiguan's plate and owner name,
      returns nothing.
- [ ] `npm run ci` green (includes `vehicle-docs-sync`, `sim-fixtures.freshness`, `validate:contrib`).
