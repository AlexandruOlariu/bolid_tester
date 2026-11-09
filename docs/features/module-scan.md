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
  (`P0299 00`), the VAG decimal (`vagCodeForDtc`), a description (`describeDtc(sae, 'vag')`: the
  SAE meaning, VAG P1 texts for manufacturer codes — UDS bytes are SAE-encoded, so the native KWP
  5-digit table is never used here), and decoded status flags
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
  row shows ident, a **verification badge** (`VerificationBadge`, plan 25): green "Standard OBD2", blue "Confirmed <date> (<source>)" once the profile item carries `confirmed` evidence, amber "Illustrative — not yet confirmed on this car" otherwise (the engine's ISO pair is standard), each DTC (code, VAG
  number, description, status), and the gated per-module clear. Honest empty states for K-line
  links and profiles without a module list.
- **Discover modules** (`DiscoverySection`, plan 25) — see below. Shown on any 11-bit CAN link
  (not 29-bit CAN / J1939), also when the profile declares no modules (that is how a garage car on
  the generic base gets a list).
- **ScanHistorySection** (below the live scan, shown once ≥1 scan is saved) — **Share report** of
  the latest scan, a **fault search** box filtering the latest scan, and a **Compare** picker
  (default latest vs previous) rendering the diff grouped by module with appeared/cleared/changed
  badges.
- **Route params `before` / `after`** (plan 16) — `/module-scan?after=<scan id>&before=<scan id>`
  pre-selects the Compare pickers (`CompareSection`'s `initialBeforeId` / `initialAfterId`). With
  only `after` (a car's first scan), Before is the same car's previous scan (`baselineFor`), else
  empty with "No earlier scan of this car — pick a baseline above." — never another car's scan or
  the After scan itself. The [History timeline](./history.md) links each saved scan this way, with
  the previous scan of the same car as `before`. `ScanHistorySection` reads them
  with `useLocalSearchParams`, and once the pickers have taken them clears them on this route
  (`navigation.setParams`), so the same link works again after the pickers were changed by hand;
  a new pair of ids re-seeds the pickers while the (hidden-tab) screen stays mounted. Covered by
  `ui/ScanHistorySection.test.tsx`.

## Discover modules (plan 25)

The real module map of a car, one tap away instead of guessed. **Discover modules** probes every
candidate 11-bit CAN id pair in `VAG_UDS_HEADER_CANDIDATES` (`obd-core/uds/vagHeaders.ts` — known
VAG PQ35/PQ46-era UDS pairs by VCDS address, each marked with its source; `discoveryCandidates`
adds any UDS pair the profile declares that is not among them):

- **11-bit CAN only** (`isCan11`). Every candidate is an 11-bit pair, and on 29-bit CAN / J1939
  there is no functional header to restore `ATSH` to, so standard reads would break until a
  reconnect: the hook hides the section and `discoverUdsModules` throws before sending anything.
- **Shared pairs.** 08 (HVAC) and 46 (comfort) share `746` / `7B0` on some cars. Candidates are
  grouped by pair (`groupCandidatesByPair`) and each pair is probed **once**; `pickCandidateByIdent`
  picks the address whose `identHints` appear in the module's ident (system name first), else the
  first, and the others come back as `DiscoveredModule.alternatives`. The row says the two
  addresses share the ids and offers **Record as 46 … instead**; adding (or the literal) uses the
  address chosen. "N of M" counts probes (distinct pairs).

- Per candidate (`discoverUdsModules`, `obd-core/uds/discoverModules.ts`): `ATSH <req>`,
  `ATCRA <rx>`, `22 F187`; on any answer (a negative `7F 22 xx` still proves a module listens) the
  standard ident (`readModuleIdent`); `resetAddressing()` in `finally` after **every** candidate.
  Read-only — only `22` reads go out. The command timeout is lowered to 1 s while probing
  (`DiagnosticSession.withCommandTimeout`) so silent addresses do not take 4 s each. States:
  `answered` / `silent` (NO DATA or timeout) / `error` (logged as `module-scan/discover`).
- Results: "N of M addresses answered", one row per answering module (address, name, id pair, part
  number, system name) and the silent ones in one line — silence is not proof of absence (a PQ35
  module may sit behind TP2.0). A discovery belongs to the car and connection it ran on: after a
  garage switch or a reconnect it is dropped, never shown against (or added to) another car.
- **Add to this car's module list**: for a **garage car** the module is stored in
  `UserVehicle.modules` (persisted with the garage, sanitized on load) and `buildUserProfile` merges
  it over the base profile's list (same transport + address replaces the base entry); for a
  **built-in profile** (code, not data) the row shows the `DiagModule` literal to paste into the
  profile — the developer flow, with the read ident as `sampleIdent` and a reminder to add
  `confirmed` once the adapter log is committed as a fixture. A row already in the list says so.
- Simulator: `MockTransport` answers `22 F187` only on headers with a seeded ident (Golf: `7E0`,
  `760`, `714`) — the engine's extended DIDs no longer answer on other modules' headers — so the
  Golf discovery finds exactly engine, ABS and cluster.

## hooks / api / model

- `useModuleScan()` — availability gate (CAN + profile modules), a best-effort **bus-wake** pre-step,
  sequential `scanAll`, `clearOne` (by `diagModuleKey`, transport + address — the Golf lists cluster
  `17` on UDS and on TP2.0, so the address alone is ambiguous), and **auto-save** of the completed scan to `scanHistoryStore`;
  `discover` / `addDiscovered` / `canDiscover` / `isGarageCar` for Discover modules.
- `api/discovery.ts` — `discoveredToModule`, `isInModuleList`, `diagModuleLiteral` (pure).
- `useScanShare()` — writes `formatAutoScanReport` to a `.txt` and opens the OS share sheet
  (dependency-tolerant `expo-file-system` + `expo-sharing`, like `useDtcExport`).
- `moduleScanService` — `scanModule` / `clearModule`: `ATSH`/`ATCRA` addressing, tolerant of
  silent modules (`isModuleUnreachableError` → honest "no response" state), always restores the
  header. Core parsing lives in `obd-core/uds/udsModule.ts` (unit-tested).
- `scanReport` / `scanDiff` / `scanSearch` — pure formatters/logic (no I/O), unit-tested against
  fixtures and reused by the UI.
- `moduleScanStore` (Zustand): `running`, `progress`, `results[]`, `lastScanTs`, `tp20`,
  `discovery`, `discoveryOwner` (car id + session the discovery ran on), `discoveryProgress`.
  Results are keyed by `diagModuleKey`. Scan, gateway scan and discovery refuse to start while
  `running` is set.
- `scanHistoryStore` (persisted, `bolid.scans` **v1** since plan 18 — it shipped unversioned, so
  zustand wrote 0; `migrateScans` keeps the same shape — capped `MAX_SCANS`, debounced writes + rehydration-merge safety net,
  mirroring `historyStore`): `scans[]` of `SavedScan` snapshots.
- Profiles gain `modules?: DiagModule[]` (address, name, transport `uds|tp20`, headers, simulator
  seeds). The Golf ships engine + ABS + cluster (UDS, illustrative) and the gateway as `tp20`.

## Behavior

- Fully exercised against the simulator: `scenarios.ts` seeds per-header DTC stores + ident from
  the profile; MockTransport answers `19 02`/`19 04`/`14`/`22 F1xx` per ATSH header.
- Real cars: silent modules are reported as such, never as app errors; every experimental address
  is badged "Illustrative" until its profile entry carries `confirmed` evidence.

## Acceptance

- Golf simulator: engine scan shows the three known faults (P2183/P2015/P0121) with VAG numbers;
  ABS shows C0130 with warning-lamp flag; cluster scans clean; gateway shows the TP2.0 note;
  per-module clear empties the engine store and the re-scan confirms it.
- The completed scan is auto-saved; **Share report** produces the forum-pasteable Auto-Scan block,
  **search** finds `08579`/`P2183`/`coolant` in the engine module, and **Compare** of two scans shows
  a cleared fault when one was cleared between them.
- The bus-wake burst never fails a scan (a NAKing/asleep sim bus is swallowed).
- Passat/Punto (K-line / no modules): screen shows the honest unavailability note.
- Golf simulator: **Discover modules** lists engine, ABS and cluster with their part numbers, every
  other candidate silent; standard reads still work afterwards; on a garage car **Add to this car's
  module list** stores the module and the scan button appears.
