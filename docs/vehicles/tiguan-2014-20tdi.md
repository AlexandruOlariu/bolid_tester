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

# VW Tiguan 2014 — 2.0 TDI CFFD 81 kW / 110 cp (diesel)

A **Tiguan (5N body)**, VIN prefix `WVGZZZ5N…`, model year 2014 (first registered 2013-12). The
engine is a **2.0 TDI** diesel, 1968 cm³, 81 kW, with a particulate filter; the engine code
**CFFD** is confirmed by the owner. The registration certificate also lists a factory-homologated
tow bar.

This profile was **written from the registration certificate, not yet seen by the app**. Everything
below that a certificate cannot prove (protocol, PID list) is expected, not observed.

## Protocol

- **Expected:** `ISO_15765_4_CAN_11_500` (ELM327 protocol `6`), as on other VAG cars of this age.
- We still rely on **auto-detect** and record whatever the adapter negotiates; the profile's expected
  value is a hint and a sanity check.

## Live data we surface (`supportedPids`, 16)

Expected by analogy, unverified: the Golf Plus 2.0 TDI set (same common-rail diesel family). Diesel,
so no spark timing or classic lambda trims:

`0104` load · `0105` coolant · `010B` MAP (boost) · `010C` RPM · `010D` speed · `010F` intake air
temp · `0110` MAF · `0111` accelerator/throttle · `011F` run time · `0121` distance with MIL ·
`0131` distance since DTCs cleared · `0133` barometric · `0142` module voltage · `0146` ambient air ·
`015C` engine oil temp · `015E` engine fuel rate

> The real ECU's supported-PID **bitmap** is always authoritative at runtime; this list is what we
> expect and what the simulator emulates.

## Fault codes

- Read **stored** (Mode 03) and **pending** (Mode 07); clear with Mode 04. Permanent (Mode 0A) is
  not declared until a car answers it.
- `make: vag` selects the VAG manufacturer fault-code texts.
- Engine ECU only.

## Extended PIDs

None defined. Mode 22 (UDS) is not relied upon here; left to the generic flow.

## On-car checklist (mirrored into `testChecklist`)

1. Connect with ignition on; confirm the negotiated protocol is **CAN 11/500**.
2. Read VIN (Mode 09) and confirm it matches the registration certificate.
3. Start the engine; read idle live data: RPM, coolant, MAP, MAF, voltage (~14 V).
4. Compare the discovered PID list with the 16 expected; note every difference.
5. Read DTCs (Mode 03/07); note whether Mode 0A answers.

## Validated on the car

Filled in after each on-car session ([testing.md → Recording results](../testing.md#recording-results)).
One row per flow; the Fixture column names the committed car fixture in
`src/shared/obd-core/transport/fixtures/<id>/`. Simulator fixtures (`sim-*.json`) never count.

| Date                | App build | Adapter | Flow | Result | Fixture |
| ------------------- | --------- | ------- | ---- | ------ | ------- |
| _not yet validated_ |           |         |      |        |         |

## Notes

The profile is thin on purpose: no known faults, extended PIDs, boost ranges, modules, coding or
routines, because there is no scan of this car yet. They are added only from an on-car session.
The simulator's calibration id for this profile (`SIM-CFFD-01`) is synthetic; the real engine ECU
part number is not known.
