# Contribute a vehicle profile

A registry profile tells the app what to expect from one car: the likely protocol, which live
values to show, its extended (manufacturer) values and modules, the faults it is known to report,
and an on-car checklist. It is **two files that must agree**: a Markdown doc (authoritative) and a
typed object. Ground rules, evidence levels and licensing: [CONTRIBUTING.md](../../CONTRIBUTING.md).
Schema reference: [vehicles/README.md](../vehicles/README.md).

You do not need a profile to diagnose a car (the `generic` profile discovers everything at
runtime). Add one when the car deserves curated data.

## Steps

1. **Pick the id.** Kebab-case, unique, `<make>-<model>-<year>-<engine>`, e.g.
   `skoda-octavia-2010-16tdi`. It is the doc's file name, the TS profile `id` and the fixtures
   folder name.
2. **Write the doc.** Copy [`docs/vehicles/fiat-punto-2008-12.md`](../vehicles/fiat-punto-2008-12.md)
   to `docs/vehicles/<id>.md` and fill the front-matter:

   ```yaml
   ---
   id: skoda-octavia-2010-16tdi
   name: Skoda Octavia II 2010 1.6 TDI
   expectedProtocol: ISO_15765_4_CAN_11_500
   supportedPidCount: 14
   extended: false
   make: vag
   engineCode: CAYC
   vin:
   validatedOn:
   observedProtocol:
   ---
   ```

   Do not put `# ...` comments in the front-matter: the parser keeps everything after the `:`, so a
   comment becomes part of the value and fails the checks. What each key means:
   - `id`: the file name without `.md`.
   - `expectedProtocol`: a `ProtocolId` from `src/shared/obd-core/obd/protocols.ts`.
   - `supportedPidCount`: `supportedPids.length` in the TS profile.
   - `extended`: `true` when the profile declares `extendedPids`, else `false`.
   - `make` (optional): `vag` or `fiat`, which picks the manufacturer fault-code table.
   - `engineCode` (optional).
   - `vin` (optional): leave it empty rather than publish a full VIN you do not own.
   - `validatedOn`: empty until the first on-car session.
   - `observedProtocol`: empty until then too; it is filled in together with `validatedOn`.

   Then the sections: Protocol, Live data we surface, Fault codes, Extended PIDs, **On-car
   checklist** (mirrored into `testChecklist`), **Validated on the car** (keep the
   `_not yet validated_` placeholder row until there is a car fixture) and Notes.

3. **Write the profile.** Add `src/shared/vehicles/<id>.ts` exporting a `VehicleProfile` (copy
   `fiat-punto-2008-12.ts`), and register it in `VEHICLE_PROFILES` in
   `src/shared/vehicles/index.ts`.
4. **Run the sync test** and the contribution checks:

   ```bash
   npm test -- vehicle-docs-sync
   npm run validate:contrib
   ```

5. **(Optional) Simulator.** `buildScenario('<id>')` already seeds the profile's PIDs, extended
   PIDs (`sampleResponse`), coding (`sampleCoding`) and `knownFaults`. Add hand-made seeds to
   `src/shared/obd-core/transport/scenarios.ts` only when the car needs more (see
   [simulator.md](../simulator.md)).

## Fields worth knowing

- **`knownFaults`** — faults this exact car has really reported (from a VCDS / OBD2 log), each
  `{ code, vagCode?, description, kind?, note? }`. They document the car and seed the simulator's
  fault store. Do not invent them: a known fault comes from a real scan.
- **`vinPatterns`** — VIN prefixes for the car family (e.g. `'WVWZZZ1K'`); at connect the app
  suggests the profile when the VIN matches. Use the manufacturer + model prefix, never a full VIN.
  Do not add the model-year character: it does not identify a model. Profiles that share a prefix
  are all suggested, and the user picks.
- **`make`** — picks the manufacturer fault-code table (`'vag'`, `'fiat'`) for P1xxx-style codes.
- **Per-car experimental arrays** (`extendedPids`, `modules`, `routines`, `adaptations`,
  `codingModules`, `codingPresets`, `moduleSensors`, `serviceReset`) — every entry is
  `experimental: true` and says "illustrative" in its comment until confirmed. Every extended PID
  needs a `sampleResponse`; every coding module a `sampleCoding`. Never target airbag,
  immobilizer, ABS writes or cluster mileage, and never add a `seedToKey`.
- **`confirmed`** — set on an item only in the pull request that commits its evidence (a replay
  fixture or a sniffer capture); see [evidence levels](../../CONTRIBUTING.md#3-evidence-levels).

## From a learned profile

A user's garage car (learned at connect, [plan 06](../plans/06-garage-learned-profiles.md)) can be
exported from **Vehicle → My garage → Export** as a `bolid.profile.v1` JSON file
([exchange-formats.md](../exchange-formats.md)). Attach it to a **Vehicle request** issue: it
carries the observed protocol, the Mode 01 PID set and the calibration id (strip the VIN first), and
a maintainer can turn it into a registry profile with the steps above. The file never contains code,
so the curated parts (extended PIDs, modules, coding) are still written by hand.
