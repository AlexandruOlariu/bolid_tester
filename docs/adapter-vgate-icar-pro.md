# Adapter — Vgate iCar Pro Bluetooth 4.0 (BLE)

The user's adapter:
[Vgate iCar Pro Bluetooth 4.0](https://www.emag.ro/tester-diagnoza-auto-vgate-icar-pro-bluetooth-4-0-android-si-ios-obd2-multimarca-citire-si-stergere-erori-date-live-sku0767/pd/DBM7TLBBM/).

## What it is

- A **genuine ELM327** (commonly reported as **v2.2/2.3**) OBD2-to-Bluetooth interface.
- **Bluetooth Low Energy (BLE / GATT)** — the "4.0" in the name. This is the key reason it works on
  **iOS**: BLE peripherals can be reached by apps **without** Apple MFi certification, whereas
  classic Bluetooth SPP adapters cannot. On iOS you do **not** pair it in Settings; the app connects
  to it directly via BLE.
- Supports **all five standard OBD2 transport protocols** (J1850 PWM/VPW, ISO 9141-2,
  ISO 14230-4 KWP2000, ISO 15765-4 CAN 11/29-bit at 250/500 kbps).
- Has an auto-sleep feature (low power when the car is off).

## What it can do (and our app targets)

- Read **live data** (Mode 01), **read & clear fault codes** (Modes 03/04/07), **freeze frame**
  (Mode 02), **readiness monitors** (PID 0101), and **VIN** (Mode 09).
- It is a **read/clear** tool — no ECU programming/coding, no actuator tests.

## What it cannot do (documented non-goals)

- **No manufacturer multi-module diagnostics.** A generic ELM327 over standard OBD2 reaches the
  **engine/emissions ECU only**. It is **not** a VCDS/VAG-COM replacement — no ABS, airbag,
  transmission, instrument cluster, or comfort modules.
- **No MS-CAN / SW-CAN.** It does not bridge the manufacturer comfort/infotainment sub-buses some
  VAG cars use. (Standard powertrain CAN is fine.)

These limits are inherent to the hardware/standard, not to our app.

## BLE connection model

ELM327 BLE clones expose a GATT service with **two characteristics**: one **notify** (data from the
adapter → app) and one **write** (app → adapter). Reported UUIDs vary across clones (e.g. the
`FFF0` service with `FFF1`/`FFF2`, or `18F0` with `2AF0`/`2AF1`).

> **Design decision:** we **do not hard-code UUIDs.** `BleTransport` discovers all services and
> characteristics, then picks the characteristic that supports **notify/indicate** for reads and the
> one that supports **write/writeWithoutResponse** for writes. This makes the app robust across
> adapter variants and is the documented approach in `features/connection.md`.

Advertised device names seen on these adapters include `IOS-Vlink`, `Vlink`, `VEEPEAK`, `OBDII`,
`V-LINK`. The scan screen lists everything and lets the user pick; we can pre-filter by these name
hints and by the presence of a serial-like service.

## ELM327 quirks handled in the client

- **Half-duplex.** One command at a time; we queue and wait for the `>` prompt.
- **Echo & whitespace.** We send `ATE0`, `ATL0`, `ATS0` and still defensively strip echo, CR/LF,
  spaces and the prompt.
- **`SEARCHING...`** can appear on the first request while the protocol is detected — we use a longer
  timeout for the first OBD command.
- **Latency / buffering.** BLE notifications can split a response across packets; the client buffers
  incoming bytes until it sees `>`.
- **MTU.** Default ~20-byte BLE payloads; long responses (VIN, many DTCs) arrive in several
  notifications and are reassembled.

## Init sequence

`ATZ → ATE0 → ATL0 → ATS0 → ATH0 → ATAT1 → ATSP0`, then probe `0100`. After a successful probe we
read `ATDPN` (protocol number) and `ATRV` (voltage). See [`obd2-reference.md`](./obd2-reference.md).

## Expectations per example car

| Car | Likely negotiated protocol | Notes |
|-----|----------------------------|-------|
| Golf Plus 2009 2.0 TDI | CAN 11/500 (`6`) | Full, fast, many PIDs. |
| Fiat Punto 1.2 2007 | KWP2000 fast (`5`) or CAN | Depends on exact variant; auto-detect handles it. |
| Passat B5.5 1.9 TDI | KWP2000 fast (`5`) / ISO 9141-2 (`3`) | Slower K-line; fewer live PIDs; engine DTC read/clear OK. |

## Sources
- vgatemall.com, astools.eu (product specs: genuine ELM327, BLE, all OBD2 protocols, iOS).
- carscanner.info "Choosing an OBD adapter" (BLE adapters, no MS/SW-CAN).
