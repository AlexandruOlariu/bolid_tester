# Testing

Two layers: **automated** (no hardware, runs here and in CI) and **on-car manual** (the user, with
the real Vgate adapter).

## Automated (no hardware)

Run with `npm test` (Jest + ts-jest over the pure-TS core). Coverage:

- **PID decoders** — each Mode 01 decoder against known byte fixtures (RPM, coolant, speed, MAP, MAF,
  voltage, temps, %).
- **DTC parsing** — `01 33 → P0133`, `02 99 → P0299`, `41 01 → C0101`, `C3 00 → U0300`, padding
  `00 00 → none`; Mode 03/07/0A framing.
- **VIN assembly** — multi-frame `0902` → 17-char ASCII.
- **Readiness monitors** — `0101` → MIL, DTC count, ignition type, per-monitor supported/complete.
- **Freeze frame** — Mode 02 trigger DTC + captured PIDs (via the session integration).
- **ELM327 client** — command queueing (half-duplex), echo/whitespace/prompt stripping,
  `NO DATA`/`?`/`SEARCHING...` handling, timeouts.
- **Simulator** — supported-PID bitmaps match the scenario; live values in range; DTC inject/clear;
  VIN present/absent per scenario.
- **DiagnosticSession integration** — for the **generic** profile and **each example car**, run
  `connect → init → identify → poll → readDtcs → clearDtcs` against `MockTransport` and assert:
  - negotiated protocol matches the scenario,
  - the effective PID set equals the expected supported set,
  - injected DTCs read then clear,
  - VIN decodes (or is correctly reported absent).
- **vehicle-docs-sync** — every TS profile has a `docs/vehicles/<id>.md`; the doc front-matter
  `expectedProtocol` and `supportedPidCount` match the TS profile.

Also: `npm run typecheck` (core, `tsc --noEmit`), `npm run lint` (eslint), and
`npm run typecheck:app` (full RN app — run after installing deps). All of these run in CI
(`.github/workflows/ci.yml`) on every push.

## On-car manual checklists

Perform with the real adapter; each car's steps live in its profile doc and are mirrored into the
profile's `testChecklist`:

- **Golf Plus 2009 2.0 TDI** → [`vehicles/golf-plus-2009-20tdi.md`](./vehicles/golf-plus-2009-20tdi.md)
  (expect CAN, full data, VIN, DTC read/clear, try experimental Mode 22).
- **Fiat Grande Punto 1.2 2008** → [`vehicles/fiat-punto-2008-12.md`](./vehicles/fiat-punto-2008-12.md)
  (expect CAN; trims/timing; VIN available).
- **Passat B5.5 1.9 TDI** → [`vehicles/passat-b55-19tdi.md`](./vehicles/passat-b55-19tdi.md)
  (expect slow K-line, fewer PIDs; RPM/coolant/DTC read+clear is success).

### Recording results
After each real connection, update the car's doc with the **observed** protocol and any PID
availability surprises, then adjust the TS profile and re-run `npm test`. This keeps docs and code in
sync as we learn each car's real behavior.
