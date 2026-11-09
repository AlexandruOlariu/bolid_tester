# Vehicle Registry

Vehicles are **data**, not code paths. The engine is generic; a _profile_ tells the app what to
expect for a given car (likely protocol, which live PIDs to surface, whether experimental extended
PIDs apply, and an on-car test checklist). **The three cars here are examples** — add as many as you
like.

## Profile schema

Each profile is described by one Markdown file in this folder **and** mirrored by one typed object in
`src/shared/vehicles/`. The Markdown is **authoritative**; the code must match it (enforced by the
`vehicle-docs-sync` test, which reads the YAML front-matter below).

Front-matter (machine-readable, checked by the sync test):

```yaml
---
id: <kebab-case-id> # unique; matches the TS profile id and file name
name: <human name>
expectedProtocol: <ProtocolId> # e.g. ISO_15765_4_CAN_11_500, ISO_14230_4_KWP_FAST, ISO_9141_2, AUTO
supportedPidCount: <number> # length of the supportedPids list in the TS profile
extended: <true|false> # whether the profile declares experimental extended (Mode 22) PIDs
validatedOn: <YYYY-MM-DD> # optional; empty until the first on-car session
observedProtocol: <ProtocolId> # optional; what the adapter negotiated on the car
---
```

`validatedOn` and `observedProtocol` stay empty until the car is driven, and are filled together
from the same session. Once set, `observedProtocol` must equal `expectedProtocol` (the sync test
checks it): when the car disagrees, the doc and then the profile are corrected to the observation.

## Validated on the car

Every vehicle doc carries this section (the sync test fails without it), filled after each on-car
session by the procedure in [testing.md → Recording results](../testing.md#recording-results):

```markdown
## Validated on the car

| Date                | App build | Adapter | Flow | Result | Fixture |
| ------------------- | --------- | ------- | ---- | ------ | ------- |
| _not yet validated_ |           |         |      |        |         |
```

One row per flow. The last column names the committed car fixture
(`src/shared/obd-core/transport/fixtures/<id>/<flow>.json`, file name or link). The sync test
requires every car fixture (`meta.source: 'car'`) under the vehicle's folder to be listed, and every
listed file to exist. **Simulator fixtures (`sim-*.json`) are not validation:** they are recorded
from the simulator to prove the pipeline and never appear in this table. See
[simulator.md → Replay fixtures](../simulator.md#replay-fixtures).

The TS `VehicleProfile` type (see `src/shared/vehicles/types.ts`):

```ts
type VehicleProfile = {
  id: string;
  name: string;
  year: number;
  engine: string;
  fuel: 'diesel' | 'petrol' | 'lpg' | 'hybrid' | 'other';
  make?: 'vag' | 'fiat' | 'generic'; // manufacturer DTC table for P1xxx-style codes (see below)
  expectedProtocol: ProtocolId; // hint only; the adapter still auto-detects
  supportedPids: Pid[]; // Mode 01 PIDs we surface for this car
  dtcModes: DtcMode[]; // which DTC services to read (03/07/0A)
  extendedPids?: ExtendedPid[]; // experimental Mode 22 reads (flagged)
  notes: string;
  testChecklist: string[]; // mirrored from the doc's "On-car checklist"
};
```

### `confirmed` — evidence that an item was checked on the car

Every per-car item a profile declares — `extendedPids`, `modules`, `routines`, `adaptations`,
`codingModules`, `codingPresets`, `moduleSensors`, `loginCodes` and `serviceReset` — may carry
`confirmed?: Confirmation` ([plan 25](../plans/25-post-capture-confirmation.md);
`src/shared/obd-core/confirmation.ts`):

```ts
confirmed: {
  on: '2026-11-20', // ISO date, YYYY-MM-DD
  source: 'sniffer-capture', // | 'on-car' | 'vcds-log'
  fixture: 'docs/captures/golf-plus-2009-20tdi-group121-2026-11-20.csv', // the evidence
  note: 'VCDS Basic Settings Group 121 ON → 31 01 0301',
}
```

`experimental` keeps its meaning (non-standard, per-car data); `confirmed` records **where the
proof lives**. The screens show one badge per item (`VerificationBadge`, `verificationState` in
`src/shared/vehicles/confirmation.ts`): green **Standard OBD2** when `experimental: false`, blue
**Confirmed <date> (<source>)** when `confirmed` is set, amber **Illustrative — not yet confirmed on
this car** otherwise.

**The evidence rule** (enforced by `vehicle-docs-sync.test.ts` through `confirmationProblems`):
`on` is a `YYYY-MM-DD` date, and `fixture`, when set, is a repo-relative path under
`src/shared/obd-core/transport/fixtures/` (a plan-02 car fixture) or `docs/captures/` (a sniffer
capture, see [captures](../captures/README.md)) **that exists**. A bogus path fails CI. Confirmation
is always a reviewed, hand-made profile edit — the analyzer never promotes findings by itself.

### `make` — manufacturer fault-code texts

`make` picks the manufacturer table the [DTC database](../features/fault-codes.md#dtc-database)
uses for manufacturer-specific codes (P1xxx, P3000–P33FF, B1/B2, C1/C2, U1/U2): `'vag'` for VW
group cars (Golf, Passat), `'fiat'` for Fiat / FGA (Punto). Leave it out for the generic profile or
a make without a table — those codes then show the range description. Generic SAE codes read the
same for every make.

## The `generic` profile

There is always a built-in **`generic`** profile (`id: generic`). It declares **no** `supportedPids`
and `expectedProtocol: AUTO`; the app discovers everything from the car's supported-PID bitmaps at
runtime. Use it for any car without a dedicated profile.

## User vehicles vs registry profiles

The profiles in this folder are the **registry**: curated, documented, versioned with the app and
checked by the `vehicle-docs-sync` test. Users do not need one to diagnose their car. Since
[plan 06](../plans/06-garage-learned-profiles.md) they keep their own cars in **My garage**
(Vehicle screen), either learned from a live connection or entered by hand — see
[vehicle-select](../features/vehicle-select.md#garage-cars-and-learned-profiles).

- A garage car (`UserVehicle`, `src/shared/vehicles/userVehicle.ts`) has a `user:` id, a name,
  optional year / make / notes, a fuel and a **`baseProfileId`** — the registry profile it inherits
  from (`generic` by default). When learned it also stores the observed protocol, Mode 01 PID set,
  VIN and calibration id.
- At runtime `buildUserProfile(car, base)` produces an ordinary `VehicleProfile`: identity from the
  car, protocol and PIDs from the learned data when present, everything else from the base. The
  per-car experimental arrays (Mode 22 PIDs, modules, coding, adaptations, routines, service reset,
  module sensors, Mode 06, gateway list) are inherited **only from a non-generic base**; known faults
  and the on-car checklist never are. Modules the user added from **Discover modules**
  (`UserVehicle.modules`, plan 25) are merged over the base's list on any base.
- Garage cars live on the phone (`bolid.garage`) and have **no Markdown here**. The sync test applies
  to the registry only; nothing in this folder changes when a user adds a car.
- When a user's car deserves curated data (extended PIDs, modules, a fault history), it graduates
  into the registry by the steps below; sharing a learned profile as a starting point is
  [plan 13](../plans/13-profile-labelpack-import-export.md).

## How to add a vehicle

1. Copy an existing `vehicles/<car>.md`, set the front-matter and write the sections.
2. Add a matching typed profile in `src/shared/vehicles/<car>.ts` and register it in
   `src/shared/vehicles/index.ts`.
3. Make `supportedPidCount` in the front-matter equal `supportedPids.length` in the TS profile.
4. Run `npm test` — the `vehicle-docs-sync` test confirms the doc and code agree.
5. (Optional) Add the car to the simulator scenarios so it can be exercised without hardware.

## Example cars

- [`golf-plus-2009-20tdi.md`](./golf-plus-2009-20tdi.md) — modern CAN diesel (the easy case).
- [`fiat-punto-2008-12.md`](./fiat-punto-2008-12.md) — Grande Punto petrol on CAN.
- [`passat-b55-19tdi.md`](./passat-b55-19tdi.md) — older K-line diesel (the hard case).
