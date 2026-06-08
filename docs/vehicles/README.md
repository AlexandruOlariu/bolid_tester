# Vehicle Registry

Vehicles are **data**, not code paths. The engine is generic; a *profile* tells the app what to
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
id: <kebab-case-id>            # unique; matches the TS profile id and file name
name: <human name>
expectedProtocol: <ProtocolId>  # e.g. ISO_15765_4_CAN_11_500, ISO_14230_4_KWP_FAST, ISO_9141_2, AUTO
supportedPidCount: <number>     # length of the supportedPids list in the TS profile
extended: <true|false>          # whether the profile declares experimental extended (Mode 22) PIDs
---
```

The TS `VehicleProfile` type (see `src/shared/vehicles/types.ts`):

```ts
type VehicleProfile = {
  id: string;
  name: string;
  year: number;
  engine: string;
  fuel: 'diesel' | 'petrol' | 'lpg' | 'hybrid' | 'other';
  expectedProtocol: ProtocolId;       // hint only; the adapter still auto-detects
  supportedPids: Pid[];               // Mode 01 PIDs we surface for this car
  dtcModes: DtcMode[];                // which DTC services to read (03/07/0A)
  extendedPids?: ExtendedPid[];       // experimental Mode 22 reads (flagged)
  notes: string;
  testChecklist: string[];            // mirrored from the doc's "On-car checklist"
};
```

## The `generic` profile

There is always a built-in **`generic`** profile (`id: generic`). It declares **no** `supportedPids`
and `expectedProtocol: AUTO`; the app discovers everything from the car's supported-PID bitmaps at
runtime. Use it for any car without a dedicated profile.

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
