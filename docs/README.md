# Bolid Tester — Documentation

This `docs/` folder is the **source of truth** for the project. The application is
**documentation-driven**: every feature, vehicle, and behavior is specified here in Markdown first,
and the code is written to match. When something changes, the docs change first (or together).

## How the docs drive the project

- **Specs → code.** Each `features/*.md` maps 1:1 to a feature slice in `src/features/*`.
  Each `vehicles/*.md` maps 1:1 to a typed profile in `src/shared/vehicles/*`.
- **Docs are authoritative.** Where docs and code disagree, the docs win and the code is corrected.
  A lightweight test (`vehicle-docs-sync`) checks that every code profile has a matching
  `vehicles/*.md` and that key fields agree.
- **Implementation log.** After each chunk of work we record what was built in
  [`implementation-log.md`](./implementation-log.md).

## Index

| Doc | Purpose |
|-----|---------|
| [`PLAN.md`](./PLAN.md) | The overall implementation plan (approved). |
| [`architecture.md`](./architecture.md) | Layers, data flow, transport abstraction, feature-sliced layout. |
| [`obd2-reference.md`](./obd2-reference.md) | ELM327 AT commands, OBD2 modes/PIDs, DTC format, protocols. |
| [`adapter-vgate-icar-pro.md`](./adapter-vgate-icar-pro.md) | The Vgate iCar Pro BLE adapter: facts, BLE behavior, limits. |
| [`simulator.md`](./simulator.md) | The virtual ELM327 used for hardware-free development & tests. |
| [`testing.md`](./testing.md) | Automated tests + per-car on-vehicle manual checklists. |
| [`vehicles/`](./vehicles/) | The vehicle registry. The three example cars + how to add more. |
| [`features/`](./features/) | One spec per feature slice. |
| [`implementation-log.md`](./implementation-log.md) | Running record of what we implemented. |

## What this app is (and is not)

**Is:** a **generic OBD2 / EOBD diagnostics tool** for Android and iOS that talks to an
ELM327-compatible Bluetooth Low Energy adapter (the user's is a *Vgate iCar Pro Bluetooth 4.0*).
It reads live engine data, reads & clears engine fault codes, shows freeze-frame and readiness
monitors, and reads the VIN — for **any** OBD2-compliant car.

**Is not:** a full manufacturer-level tool (no VCDS/VAG-COM-style ABS/airbag/transmission/cluster
diagnostics). A generic adapter only reaches the engine/emissions ECU over standard OBD2. See
[`adapter-vgate-icar-pro.md`](./adapter-vgate-icar-pro.md) for the exact capabilities.

## The example cars

The three cars below are the user's **own cars**, used as **reference profiles** to validate that
the generic tool works on real, diverse hardware (modern CAN diesel, older petrol, older K-line
diesel). They are **examples**, not the app's fixed scope — see [`vehicles/`](./vehicles/).

- VW Golf Plus 2009, 2.0 TDI 81 kW / 109 cp, diesel, manual — expected **CAN** (ISO 15765-4).
- Fiat Grande Punto 1.2 2008, petrol, manual — expected **CAN** (ISO 15765-4).
- VW Passat B5.5, 1.9 TDI AVB-family, diesel, manual — expected **K-line KWP2000** (ISO 14230-4).
