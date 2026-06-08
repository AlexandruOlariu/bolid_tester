---
id: fiat-punto-2008-12
name: Fiat Grande Punto 1.2 2008 (petrol)
expectedProtocol: ISO_15765_4_CAN_11_500
supportedPidCount: 13
extended: false
---

# Fiat Grande Punto 1.2 2008 — petrol, manual

A **Grande Punto (199 body)** small petrol car — confirmed by the VIN prefix `ZFA199…`
(`ZFA19900000438592`). By 2008 the EU 1.2 Punto is the Grande Punto, which uses
**CAN (ISO 15765-4)** — so it behaves much like the Golf reference rather than the older K-line
Puntos. The engine is the **1.2 8v FIRE** (engine code **199A4.000**, 48 kW / 64 cp), which is
**MAP / speed-density (no MAF sensor)**.

## Protocol

- **Expected:** `ISO_15765_4_CAN_11_500` (ELM327 protocol `6`).
- We still rely on **auto-detect** and record whatever the adapter negotiates; the profile's expected
  value is a hint and a sanity check.

## Live data we surface (`supportedPids`, 13)

Petrol exposes fuel trims and timing; the 1.2 8v reports MAP rather than MAF:

`0104` load · `0105` coolant · `0106` short-term fuel trim B1 · `0107` long-term fuel trim B1 ·
`010B` MAP · `010C` RPM · `010D` speed · `010E` timing advance · `010F` intake air temp ·
`0111` throttle · `011F` run time · `012F` fuel level · `0142` module voltage

## Fault codes

- Read **stored** (Mode 03) and **pending** (Mode 07); clear with Mode 04. Permanent (0A) is often
  absent on this EU generation, so it is not declared.
- Engine ECU only.

## Extended PIDs

None defined. Mode 22 (UDS) is not relied upon here; left to the generic flow.

## On-car checklist (mirrored into `testChecklist`)

1. Connect over BLE, ignition on; confirm the negotiated protocol is **CAN 11/500**.
2. Read VIN (Mode 09) and confirm it matches the windscreen.
3. Read live data at idle: RPM (~850), coolant, throttle, fuel trims near 0 %, MAP.
4. Read DTCs (Mode 03/07); clear a harmless one and confirm.

## Notes

If a specific car turns out to be an older 188-body Punto on K-line, switch `expectedProtocol` to
`ISO_14230_4_KWP_FAST` and re-check the PID set; auto-detect will reveal the truth on first connect.
