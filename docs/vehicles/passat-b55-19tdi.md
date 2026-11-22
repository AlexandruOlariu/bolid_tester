---
id: passat-b55-19tdi
name: VW Passat B5.5 1.9 TDI AVB
expectedProtocol: ISO_9141_2
vin: WVWZZZ3BZ4E342958
engineCode: AVB
supportedPidCount: 9
extended: false
validatedOn:
observedProtocol:
---

# VW Passat B5.5 — 1.9 TDI AVB-family (diesel)

The **hard case**, and the one to be most careful about. The B5.5 (2000–2005 facelift) 1.9 PD TDI
uses **K-line** for diagnostics: **ISO 14230-4 KWP2000 (fast init)**, sometimes ISO 9141-2. Diesel
EOBD became mandatory in the EU in 2004, so generic engine diagnostics are available but **thinner
and slower** than on CAN cars, and some Mode 01 PIDs may simply return `NO DATA`.

## Confirmed VCDS details

- **VIN:** `WVWZZZ3BZ4E342958`
- **Chassis:** `3B (3B - VW Passat B5, 1997 > 2005)`
- **Engine label:** `038-906-019-AVB.lbl`
- **Engine ECU:** `038 906 019 KC`
- **VCDS component:** `1,9l R4 EDC G000SG 4896`
- **Mileage at scan:** `234280 km`

## Protocol

- **Expected:** `ISO_14230_4_KWP_FAST` (ELM327 protocol `5`); fallback `ISO_9141_2` (`3`).
- K-line uses a slower init and lower throughput; the ELM327 may show `BUS INIT:` and `SEARCHING...`.
  The app uses longer timeouts here and polls fewer PIDs.

## Live data we surface (`supportedPids`, 9)

Conservative, realistic K-line diesel set:

`0104` load · `0105` coolant · `010B` MAP (boost) · `010C` RPM · `010D` speed · `010F` intake air
temp · `0111` accelerator/throttle · `011F` run time · `0142` module voltage

> No generic MAF/oil-temp/fuel-rate here via standard OBD2 — those live in **VAG measuring blocks**
> that a generic ELM327 cannot read. Genuine extra data needs VCDS-style tooling (out of scope).

## Fault codes

- Read **stored** (Mode 03) and **pending** (Mode 07); clear with Mode 04. The engine ECU answers
  generic powertrain DTCs.
- VCDS scan from 2025-05-17 showed **no engine ECU fault codes**.
- Non-engine VCDS module faults were present in HVAC, central convenience, and radio modules; a
  generic ELM327 app cannot read those modules.

## Extended PIDs

None. **Mode 22 (UDS) does not apply** to this K-line/KWP2000 ECU; VAG measuring-group blocks are not
accessible generically. This is the documented limit, not an app bug.

## Adaptations (illustrative KWP channel)

One **illustrative** KWP2000 adaptation channel is declared on the **engine ECU** (`address '01'`,
header `8101F1`): local identifier `2A` "Idle speed adaptation", 1 byte, × 10 rpm, bounds
800–1000 rpm, `transport: 'kwp'`, `login: true`, session `0x85`. It is a **placeholder** so the
whole login → backup → write → verify flow ([adaptations](../features/adaptations.md#kwp-login-plan-22))
runs in the simulator; the local id, scaling and bounds are unconfirmed until a capture of a VCDS
session on this ECU confirms them. It is not an extended PID, so the front matter is unaffected.
No login code ships — the owner enters it (code book); the in-app simulator accepts only its
placeholder `12345`.

The **KWP1281 limit** stands: the instrument cluster, comfort and climate modules speak KWP1281
(ISO 9141 byte-ACK), which a generic ELM327 cannot address, so no channels are declared for them
and the service reminder is reset with the dash-stalk procedure on the Service reset screen.

## Expected boost (agent)

`boost` in the profile: the expected MAP-minus-baro range the AI agent's MAP-only boost check
(`assessBoost`) judges against. Initial values, **not yet confirmed on the car** — the first on-car
session with the stationary rev hold confirms them and sets `boost.confirmed`.

| Reading                                     | Expected     |
| ------------------------------------------- | ------------ |
| Idle (~850 rpm), MAP − baro                 | −5 to 15 kPa |
| Stationary rev hold at 2500 rpm, MAP − baro | 5 to 60 kPa  |
| Lowest rpm that counts as the hold          | 2200 rpm     |

This ECU has no barometric PID (`0133`), so the check assumes 101.3 kPa and says so. More than
30 kPa over baro at idle points to a stuck VNT; a hold whose max rpm stays under 2200 rpm is not
judged. A pending `P0234` (overboost) is known on this car.

## On-car checklist (mirrored into `testChecklist`)

1. Connect over BLE, ignition on. Expect a brief `BUS INIT` / `SEARCHING...`.
2. Confirm protocol shows **KWP2000 (fast)** or **ISO 9141-2**.
3. Read live data slowly: RPM (~850 idle), coolant, MAP/boost under load, IAT, voltage.
4. Some PIDs may show "not supported" — that is expected; only the bitmap-supported ones appear.
5. Read VIN (Mode 09 may be unsupported on this ECU); if present, confirm it matches
   `WVWZZZ3BZ4E342958`.
6. Read engine DTCs; the 2025-05-17 VCDS scan had no engine faults.

## Validated on the car

Filled in after each on-car session ([testing.md → Recording results](../testing.md#recording-results)).
One row per flow; the Fixture column names the committed car fixture in
`src/shared/obd-core/transport/fixtures/<id>/`. Simulator fixtures (`sim-*.json`) never count.

| Date                | App build | Adapter | Flow | Result | Fixture |
| ------------------- | --------- | ------- | ---- | ------ | ------- |
| _not yet validated_ |           |         |      |        |         |

## Notes

Treat slow responses and missing PIDs as **normal** for this car. If engine RPM/coolant/DTCs read and
clear, the app is working correctly on K-line.
