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

## Bus wake (6b.10)
Before the first module is addressed, `scanAll` fires a **best-effort functional TesterPresent
burst** (`3E 00` to the OBD2 functional header, `testerPresentBurst` in `obd-core/uds/testerPresent`):
a parked VW lets the bus fall asleep and the first physically-addressed request then times out
("probe fails on a parked car"). The burst is a few frames (~300 ms, bounded to ~1 s) and **swallows
every response and error** — a still-asleep bus, a clone that NAKs, or a timeout must never abort the
scan that follows. Pure and unit-tested over an injectable sender.

## Saved scans, report, diff & search (6b.1–3)
Every completed `scanAll` is **auto-saved** to a persisted, capped history (`scanHistoryStore`,
key `bolid.scans`), vehicle-keyed exactly like `historyStore` (VIN when the ECU reports it, else the
profile id). A saved scan is a compact serializable snapshot (`buildSavedScan` normalizes the live
`ModuleScanResult[]`, which embeds the whole `DiagModule`, into it). Three pure, unit-tested views sit
on top:
- **VCDS-style Auto-Scan text report** (`scanReport.formatAutoScanReport`) — the forum-pasteable block
  (chassis header, per-module address/name/part no/component/coding/faults with VAG numbers + status),
  shared as a `.txt` via `expo-sharing` (`useScanShare`, the dependency-tolerant import pattern).
- **Scan diff** (`scanDiff.diffScans`) — before→after of two saved scans: faults appeared/cleared per
  module, coding changed, part number changed, modules added/removed, with headline totals. The
  "did the repair work?" / used-car-baseline view.
- **DTC search** (`scanSearch.searchScan`) — one query across the last scan's per-module faults by
  VAG 5-digit number, SAE/OBD2 code, or fault-text substring.

## UI
- **ModuleScanScreen** — "Scan all modules" with progress; one row per module: address, name,
  part number/SW, state badge (`✓ no faults / ⚠ n faults / – no response / ⏳ TP2.0`). Expanding a
  row shows ident, each DTC (code, VAG number, description, status), and the gated per-module
  clear. Honest empty states for K-line links and profiles without a module list.
- **ScanHistorySection** (below the live scan, shown once ≥1 scan is saved) — **Share report** of
  the latest scan, a **fault search** box filtering the latest scan, and a **Compare** picker
  (default latest vs previous) rendering the diff grouped by module with appeared/cleared/changed
  badges.

## hooks / api / model
- `useModuleScan()` — availability gate (CAN + profile modules), a best-effort **bus-wake** pre-step,
  sequential `scanAll`, `clearOne`, and **auto-save** of the completed scan to `scanHistoryStore`.
- `useScanShare()` — writes `formatAutoScanReport` to a `.txt` and opens the OS share sheet
  (dependency-tolerant `expo-file-system` + `expo-sharing`, like `useDtcExport`).
- `moduleScanService` — `scanModule` / `clearModule`: `ATSH`/`ATCRA` addressing, tolerant of
  silent modules (`isModuleUnreachableError` → honest "no response" state), always restores the
  header. Core parsing lives in `obd-core/uds/udsModule.ts` (unit-tested).
- `scanReport` / `scanDiff` / `scanSearch` — pure formatters/logic (no I/O), unit-tested against
  fixtures and reused by the UI.
- `moduleScanStore` (Zustand): `running`, `progress`, `results[]`, `lastScanTs`, `tp20`.
- `scanHistoryStore` (persisted, capped `MAX_SCANS`, debounced writes + rehydration-merge safety net,
  mirroring `historyStore`): `scans[]` of `SavedScan` snapshots.
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
- The completed scan is auto-saved; **Share report** produces the forum-pasteable Auto-Scan block,
  **search** finds `08579`/`P2183`/`coolant` in the engine module, and **Compare** of two scans shows
  a cleared fault when one was cleared between them.
- The bus-wake burst never fails a scan (a NAKing/asleep sim bus is swallowed).
- Passat/Punto (K-line / no modules): screen shows the honest unavailability note.
