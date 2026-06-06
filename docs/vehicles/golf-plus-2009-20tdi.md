---
id: golf-plus-2009-20tdi
name: VW Golf Plus 2009 2.0 TDI 110cp
expectedProtocol: ISO_15765_4_CAN_11_500
supportedPidCount: 16
extended: true
---

# VW Golf Plus 2009 — 2.0 TDI 110 cp (diesel, manual)

The **easy, modern case**: a 2009 VW on the VAG PQ35 platform. Being a 2008+ car it uses
**CAN (ISO 15765-4, 11-bit, 500 kbps)** for OBD2, so generic diagnostics are fast and complete.

## Protocol

- **Expected:** `ISO_15765_4_CAN_11_500` (ELM327 protocol `6`).
- Auto-detect (`ATSP0`) will land here; the app verifies with `ATDPN`.

## Live data we surface (`supportedPids`, 16)

Diesel, so no spark-timing / classic lambda trims. Realistic set:

`0104` load · `0105` coolant · `010B` MAP (boost) · `010C` RPM · `010D` speed · `010F` intake air
temp · `0110` MAF · `0111` accelerator/throttle · `011F` run time · `0121` distance with MIL ·
`0131` distance since DTCs cleared · `0133` barometric · `0142` module voltage · `0146` ambient air ·
`015C` engine oil temp · `015E` engine fuel rate

> The real ECU's supported-PID **bitmap** is always authoritative at runtime; this list is what we
> expect and what the simulator emulates.

## Fault codes

- Read **stored** (Mode 03), **pending** (Mode 07), **permanent** (Mode 0A); clear with Mode 04.
- Generic powertrain codes only (engine ECU). ABS/airbag etc. are **not** reachable — see
  [`../adapter-vgate-icar-pro.md`](../adapter-vgate-icar-pro.md).

## Extended PIDs (experimental, flagged)

Being CAN/UDS-capable, this car can answer **Mode 22** reads. We seed **one experimental example**;
the DID is **illustrative and must be confirmed on the real car** before trusting the value.

- `2217 01` → "DPF soot mass (experimental)" — **unverified DID**, demo value in the simulator.

See [`../features/extended-pids.md`](../features/extended-pids.md).

## On-car checklist (mirrored into `testChecklist`)

1. Plug adapter, ignition on (engine off), connect over BLE.
2. Confirm protocol shows **CAN 11/500**.
3. Read VIN (Mode 09) and confirm it matches the windscreen VIN.
4. Start engine; confirm RPM (~800–900 idle), coolant rises, MAP/boost, oil temp, voltage (~14 V).
5. Read DTCs (expect none, or known stored codes); note them.
6. (If a harmless code is present) clear it, re-read, confirm cleared.
7. Toggle the experimental extended PID; record whether a plausible value comes back.

## Notes

CAN makes this the reference "happy path". If the generic flow works anywhere, it works here.
