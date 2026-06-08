---
id: passat-b55-19tdi
name: VW Passat B5.5 1.9 TDI AVB
expectedProtocol: ISO_14230_4_KWP_FAST
vin: WVWZZZ3BZ4E342958
engineCode: AVB
supportedPidCount: 9
extended: false
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

## On-car checklist (mirrored into `testChecklist`)

1. Connect over BLE, ignition on. Expect a brief `BUS INIT` / `SEARCHING...`.
2. Confirm protocol shows **KWP2000 (fast)** or **ISO 9141-2**.
3. Read live data slowly: RPM (~850 idle), coolant, MAP/boost under load, IAT, voltage.
4. Some PIDs may show "not supported" — that is expected; only the bitmap-supported ones appear.
5. Read VIN (Mode 09 may be unsupported on this ECU); if present, confirm it matches
   `WVWZZZ3BZ4E342958`.
6. Read engine DTCs; the 2025-05-17 VCDS scan had no engine faults.

## Notes

Treat slow responses and missing PIDs as **normal** for this car. If engine RPM/coolant/DTCs read and
clear, the app is working correctly on K-line.
