# OBD2 Simulator (virtual ELM327)

`MockTransport` (`src/shared/obd-core/transport/MockTransport.ts`) is a **virtual ELM327** that makes
the entire app and test-suite runnable **without any hardware**. It implements the `Transport`
interface and answers AT/OBD commands with realistic bytes, parameterized by a **scenario** derived
from a vehicle profile.

## Why
- Develop and demo the app with no car or adapter.
- Deterministic, fast **unit/integration tests** (CI and this container).
- Reproduce per-car quirks (CAN vs K-line, missing PIDs, slow init) so the UI is exercised honestly.

## What it models
- **AT commands:** `ATZ` (version banner), `ATE0/L0/S0/H1`, `ATSP0`, `ATDPN` (returns the scenario's
  protocol number), `ATRV` (voltage), `ATI` (version), `ATCRA` (accepted). Unknown → `?`.
- **Protocol negotiation:** first OBD request may emit `SEARCHING...` then data; K-line scenarios add
  latency and may emit a `BUS INIT` notice.
- **Supported-PID bitmaps:** `0100/0120/0140/0160` computed from the scenario's PID set.
- **Mode 01 live values:** generated from a small physical model (idle vs revving, gentle noise) so
  gauges move realistically. Unsupported PIDs → `NO DATA`.
- **DTCs:** Mode 03/07/0A return the scenario's injected codes; **Mode 04** clears them (subsequent
  reads are empty). Mode 02 returns a freeze frame for the first stored code.
- **VIN:** Mode 09 PID 02 returns a scenario VIN (multi-frame on CAN); K-line scenarios can be
  configured to **not** answer (to emulate older ECUs).
- **Extended (Mode 22):** answers only the DIDs the scenario declares (Golf); otherwise `NO DATA`.

## Scenarios
Built from the vehicle registry + overrides:
- `generic` — CAN, broad PID set, sample VIN, no injected DTCs.
- `golf-plus-2009-20tdi` — CAN 11/500, 16 PIDs, real VIN `WVWZZZ1KZ9W903398`,
  optional DTCs, one experimental Mode 22 DID.
- `fiat-punto-2008-12` — CAN 11/500, 13 PIDs, VIN.
- `passat-b55-19tdi` — KWP2000 fast, 9 PIDs, real VIN `WVWZZZ3BZ4E342958` in scenario data,
  **no MAF/oil/fuel-rate**, slower timing, Mode 09 VIN often absent.

Tests and the in-app Settings picker select a scenario. Latency is configurable (≈0 ms in tests for
speed; non-zero to emulate K-line in the UI).

## Quirks toggles
- `latencyMs` — per-response delay (K-line > CAN).
- `emitSearching` — prefix the first OBD reply with `SEARCHING...`.
- `vinSupported` — whether `0902` answers.
- `whitespaceInResponses` — emulate adapters that ignore `ATS0` (the client must still parse).

## Contract
The simulator's **outputs are bytes ending in the `>` prompt**, exactly like a real ELM327, so the
`Elm327Client` is unaware it is talking to a mock. This is what makes the tests meaningful.
