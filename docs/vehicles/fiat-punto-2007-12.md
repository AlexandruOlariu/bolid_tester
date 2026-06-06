---
id: fiat-punto-2007-12
name: Fiat Punto 1.2 2007 (petrol)
expectedProtocol: ISO_14230_4_KWP_FAST
supportedPidCount: 14
extended: false
---

# Fiat Punto 1.2 2007 — petrol, manual

A late **Punto (188-family) / Grande Punto-era** small petrol car. Petrol EOBD has been mandatory in
the EU since 2001, so it is OBD2-compliant. The exact transport depends on the precise variant:
older **Punto** bodies use **K-line (ISO 9141-2 / ISO 14230-4 KWP2000)**, while **Grande Punto**
(2005+) typically uses **CAN**.

## Protocol

- **Expected:** `ISO_14230_4_KWP_FAST` (ELM327 protocol `5`), with `ISO_9141_2` (`3`) and CAN as
  alternates.
- We rely on **auto-detect** and record whatever the adapter negotiates; the profile's expected value
  is only a hint and a sanity check.

## Live data we surface (`supportedPids`, 14)

Petrol exposes fuel trims and timing:

`0104` load · `0105` coolant · `0106` short-term fuel trim B1 · `0107` long-term fuel trim B1 ·
`010B` MAP · `010C` RPM · `010D` speed · `010E` timing advance · `010F` intake air temp ·
`0110` MAF · `0111` throttle · `011F` run time · `012F` fuel level · `0142` module voltage

## Fault codes

- Read **stored** (Mode 03) and **pending** (Mode 07); clear with Mode 04. Permanent (0A) often
  absent on this generation.
- Engine ECU only.

## Extended PIDs

None defined. Mode 22 (UDS) is not reliably available on this generation; left to the generic flow.

## On-car checklist (mirrored into `testChecklist`)

1. Connect over BLE, ignition on.
2. Note the negotiated protocol (K-line vs CAN) — **update this doc and the profile** with the
   observed value.
3. Read live data at idle: RPM (~850), coolant, throttle, fuel trims near 0 %, MAP.
4. Read VIN if supported (older K-line ECUs sometimes don't return Mode 09 VIN — record the result).
5. Read DTCs; clear a harmless one and confirm.

## Notes

If this turns out to be a Grande Punto on CAN, behavior is closer to the Golf. The profile's
`expectedProtocol` should be corrected to the observed value after the first real connection.
