---
id: golf-plus-2009-20tdi
name: VW Golf Plus 2009 2.0 TDI 81 kW
expectedProtocol: ISO_15765_4_CAN_11_500
vin: WVWZZZ1KZ9W903398
engineCode: CBD
supportedPidCount: 16
extended: true
---

# VW Golf Plus 2009 — 2.0 TDI 81 kW / 109 cp (diesel)

The **easy, modern case**: a 2009 VW Golf Plus on the VAG PQ35 platform, VIN
`WVWZZZ1KZ9W903398`. This is a conventional **2.0 TDI diesel**, not an e-Golf/electric profile.
Being a 2008+ car it uses **CAN (ISO 15765-4, 11-bit, 500 kbps)** for OBD2, so generic diagnostics
are fast and complete.

## Confirmed VCDS / vehicle-history details

Confirmed across **10 VCDS auto-scans 2025-05 → 2026-04** (212,260 → 224,680 km) plus a 2026-05
Car Scanner OBD2 export of this exact car.

- **VIN:** `WVWZZZ1KZ9W903398`
- **Chassis:** `1K-VW36 (1K0)`
- **Engine code shown by VCDS/PDF:** `CBD`
- **Power:** `81 kW (109 cp)`
- **Engine ECU:** SW `03L 906 022 LM`, HW `03L 906 022 G`
- **Engine coding:** `0000071` (stable across every scan)
- **VCDS component:** `R4 2.0l TDI G000SG 9977`
- **VCDS engine label file:** `03L-906-022-CBA.clb` — note the label-file suffix (`-CBA`) is a
  shared family file and does **not** match the SW part (`…LM`); label files aren't 1:1 with the part.
- **Modules VCDS reaches:** `01 03 08 09 10 15 16 17 19 25 42 44 52 62 69 72`; **`56` (Radio) is not
  reachable**. Over **generic OBD2 the app only sees `01` (engine)** — the rest need a VCDS-class tool.

> **Freeze-frame timestamps are unreliable on this car:** the ECU clock read ~2019–2020 while the
> scans were taken in 2025–2026, so a freeze frame's `Date`/`Time` can't be trusted; its `Mileage`
> is the dependable anchor.

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
- Generic powertrain codes only (engine ECU). ABS/airbag/HVAC etc. are **not** reachable over
  generic OBD2 — VCDS sees them, the app does not. See
  [`../adapter-vgate-icar-pro.md`](../adapter-vgate-icar-pro.md).

### Known engine faults (seeded into the simulator)

Confirmed from a year of VCDS scans plus the 2026-05 OBD2 export. These populate the profile's
`knownFaults`, which [`scenarios.ts`](../../src/shared/obd-core/transport/scenarios.ts) seeds into
the default simulator scenario (so the DTC-read flow is exercised against ground-truth data):

| Generic | VAG 5-digit | Fault | Observed over 212k→224k km |
| --- | --- | --- | --- |
| `P2183` | `08579` | Coolant temp sensor 2 / radiator outlet `G83` | Persistent, MIL on most of 2025; cleared in the last VCDS scans, back (confirmed) in the 2026-05 OBD2 scan |
| `P2015` | `08213` | Intake manifold runner/flap position sensor (B1) | Persistent, oscillating intermittent↔confirmed; archived/inactive in the latest scans |
| `P0121` | `00289` | Throttle/pedal position sensor `G69` | Transient — only in the ~220k–223k km window |

> **Generic ↔ VAG cross-reference:** for VAG cars the 5-digit number is just the DTC's two raw bytes
> read as a decimal (`P2183` → `0x2183` → `8579`). `vagCodeForDtc()` in
> [`obd-core/obd/dtc.ts`](../../src/shared/obd-core/obd/dtc.ts) computes it. (VCDS sometimes prints a
> 6th leading zero, e.g. `000289`; the value is identical.)

Non-powertrain faults VCDS also reported but the app **cannot** read over generic OBD2: HVAC front
air-distribution flap motor (`B1091`), an infotainment CAN-bus cluster (`00469`/`01304`/`01305`),
and the left mirror turn-signal lamp (`L131`).

## Extended PIDs (experimental, flagged)

Being CAN/UDS-capable, this car can answer **Mode 22** reads. The profile seeds an **experimental
DPF / diesel / injection pack** at DIDs `1701`–`170D` (soot mass & load, ash, distance & count since
regen, EGT, oil temp, EGR, injection quantity and per-cylinder corrections). Every one is
**illustrative and must be confirmed on the real car**.

> These DIDs **cannot be validated from log files** — neither VCDS (which works off `.clb`/`.rod`
> label files and freeze frames) nor an OBD2 scanner (DTCs only) exposes the raw UDS DID or its byte
> layout. Confirming them needs a live Mode 22 capture on the car.

- `1701` → "DPF soot mass (calc.)" — **unverified DID**, demo value in the simulator.

See [`../features/extended-pids.md`](../features/extended-pids.md) and the `extendedPids` array in
[`golf-plus-2009-20tdi.ts`](../../src/shared/vehicles/golf-plus-2009-20tdi.ts).

## On-car checklist (mirrored into `testChecklist`)

1. Plug adapter, ignition on (engine off), connect over BLE.
2. Confirm protocol shows **CAN 11/500**.
3. Read VIN (Mode 09) and confirm it matches `WVWZZZ1KZ9W903398`.
4. Start engine; confirm RPM (~800–900 idle), coolant rises, MAP/boost, oil temp, voltage (~14 V).
5. Read DTCs and compare with the known VCDS engine faults `P2015` and `P2183`.
6. If a harmless/handled code is cleared, re-read and confirm it is gone.
7. Toggle the experimental extended PID; record whether a plausible value comes back.

## Notes

CAN makes this the reference "happy path". If the generic flow works anywhere, it works here.
