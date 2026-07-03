# Feature: module-scan — VCDS-style auto-scan (experimental, CAN/UDS)

Scan every control module the profile declares: identification (part number, software version,
system name) plus **per-module fault codes** with VAG code numbers and ISO 14229 status flags —
the app's equivalent of a VCDS auto-scan, within what a generic ELM327 can reach.

> ⚠️ **Experimental.** Module CAN addresses are per-car; except the standard OBD engine pair
> (`7E0/7E8`) the shipped addresses are **illustrative** and must be confirmed on the real car.
> Pre-UDS VAG modules (cluster/comfort/gateway on PQ platforms) speak **TP2.0** and are listed but
> skipped until the TP2.0 transport lands. K-line cars cannot module-scan at all over a generic
> ELM327 — the engine-only Fault codes screen is their path.

## What it does (per UDS module)
- `22 F187/F189/F191/F197/F18C` — best-effort identification (skips DIDs the module lacks).
- `19 02 <mask>` — ReadDTCInformation, default full store (0xFF); each DTC decodes to SAE
  (`P0299 00`), the VAG decimal (`vagCodeForDtc`), a description (VAG seed dictionary
  `uds/vagDtcs.ts`, falling back to the generic dictionary), and decoded status flags
  (confirmed / pending / failing now / warning lamp).
- `19 04` — per-DTC snapshot (UDS freeze frame), raw + lightly parsed (layouts are per-module).
- `14 FFFFFF` — per-module clear, behind a confirm, followed by an automatic re-scan.

## UI
- **ModuleScanScreen** — "Scan all modules" with progress; one row per module: address, name,
  part number/SW, state badge (`✓ no faults / ⚠ n faults / – no response / ⏳ TP2.0`). Expanding a
  row shows ident, each DTC (code, VAG number, description, status), and the gated per-module
  clear. Honest empty states for K-line links and profiles without a module list.

## hooks / api / model
- `useModuleScan()` — availability gate (CAN + profile modules), sequential `scanAll`, `clearOne`.
- `moduleScanService` — `scanModule` / `clearModule`: `ATSH`/`ATCRA` addressing, tolerant of
  silent modules (`isModuleUnreachableError` → honest "no response" state), always restores the
  header. Core parsing lives in `obd-core/uds/udsModule.ts` (unit-tested).
- `moduleScanStore` (Zustand): `running`, `progress`, `results[]`, `lastScanTs`.
- Profiles gain `modules?: DiagModule[]` (address, name, transport `uds|tp20`, headers, simulator
  seeds). The Golf ships engine + ABS + cluster (UDS, illustrative) and the gateway as `tp20`.

## Behavior
- Fully exercised against the simulator: `scenarios.ts` seeds per-header DTC stores + ident from
  the profile; MockTransport answers `19 02`/`19 04`/`14`/`22 F1xx` per ATSH header.
- Real cars: silent modules are reported as such, never as app errors; every experimental address
  is badged.

## Acceptance
- Golf simulator: engine scan shows the three known faults (P2183/P2015/P0121) with VAG numbers;
  ABS shows C0130 with warning-lamp flag; cluster scans clean; gateway shows the TP2.0 note;
  per-module clear empties the engine store and the re-scan confirms it.
- Passat/Punto (K-line / no modules): screen shows the honest unavailability note.
