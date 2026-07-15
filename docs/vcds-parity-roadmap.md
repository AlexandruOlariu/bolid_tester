# VCDS parity & nice-to-haves (roadmap + status)

Goal: get as close as a generic BLE ELM327 (Vgate iCar Pro) allows to what **VCDS** does on the
VW cars (Golf Plus 2009 2.0 TDI, Passat B5.5 1.9 TDI), plus general app nice-to-haves.
Written 2026-07 after a review of the code-complete state; **updated 2026-07 after the parity pass
landed** (see `docs/implementation-log.md`). Status legend: ✅ shipped (simulator-first, tested),
⏳ partial, ❌ not started.

## What the parity pass delivered (✅)

- **Module scan / auto-scan** — per-module ident + fault codes (UDS `19 02` / `14` / `19 04`),
  VAG DTC numbers + status flags. `docs/features/module-scan.md`.
- **TP2.0** — the moonshot: channel layer + gateway install list + pre-UDS module ident, fully
  unit-tested against an in-memory VW bus; real-hardware raw-CAN link included.
  `docs/features/tp20.md`.
- **Adaptations** — VCDS-style channel browser, read/edit-in-bounds/write with backup+verify,
  plus **label packs** (open equivalent of VCDS label files). `docs/features/adaptations.md`.
- **Guided routines** — output tests (`2F`) + basic settings (`31`) incl. **forced DPF regen**,
  with live interlocks. `docs/features/routines.md`.
- **OBD2 gap-fillers** — CAN multi-PID batching, a freeze frame per stored code, IUPR in the
  used-car inspection, Mode 05, a CAN **bus sniffer**, VIN→profile suggestion, adapter-log→replay.
- **Passat service reset** — root-caused (KWP1281, unreachable over ELM327) and made honest.

## Hardening pass (2026-07-03, ✅)

A post-landing review found four gaps the simulator hid — all would have surfaced as mystery
failures on the real car. Fixed, with the simulator upgraded to reproduce real-adapter behavior
(ELM multi-frame printout, bare-`ATSH` rejection, stale-`ATCRA` blocking):
**ISO-TP multi-frame de-framing** in the response parser, **full addressing restore**
(`resetAddressing()`: functional header + `ATCRA` clear in every module path), **NRC `0x78`
response-pending tolerance** (plus a `0x37` security-access retry), and **fail-closed +
continuously-monitored routine interlocks**. Details in `docs/implementation-log.md`. On-car
validation is meaningful now — before this pass it would have misattributed parser failures to
adapters/modules.

## Next-tier parity (Phase 6b, 2026-07, ✅ landing)

From `docs/improvement-plan-2026-07.md` → "Phase 6b — VCDS parity, next tier":

- **6b.6 Measuring-block logging** (✅) — VCDS's "Log" for module DIDs: record selected Mode 22 DIDs
  over time to a shareable CSV (`extended-pids`). `docs/features/extended-pids.md`. (Charting Mode 22
  values was deferred — see that doc.)
- **6b.7 Guided fault finding** (✅) — a DTC's **Guide**: note + deep-links to related measuring
  blocks and the relevant routine + inline freeze frame, from a per-profile map
  (`shared/vehicles/faultGuides.ts`). `docs/features/fault-codes.md`.
- **6b.9 Readiness / drive-cycle coach** (✅) — after a clear, shows which monitors are still not
  ready + a generic per-monitor drive pattern (`obd-core/obd/driveCycle.ts`), polled by EngineHost
  and notifying as each monitor (and then all) flips ready. `docs/features/fault-codes.md`.
- **6b.1 Auto-Scan text report** (✅) — forum-pasteable VCDS-style block, shared as `.txt`.
  `scanReport.ts`; `docs/features/module-scan.md`.
- **6b.2 Scan diff / before-after** (✅) — persist auto-scans + diff two (faults appeared/cleared,
  coding/part-number changed, modules added/removed). `scanDiff.ts` + `scanHistoryStore.ts`.
- **6b.3 Search all modules for a DTC** (✅) — one query over the last scan by VAG number / SAE code
  / fault text. `scanSearch.ts`.
- **6b.4 Long-coding helper** (✅) — byte-by-byte / per-bit breakdown with label-pack names, live
  old→new preview, edits through the existing gated write. `obd-core/coding/codingHelper.ts`;
  `docs/features/coding.md`.
- **6b.5 One-tap coding presets ("tweaks")** (✅) — reversible curated toggles compiled to the gated
  coding write, with on/off/unknown detection; ships 3 Golf Plus tweaks. `obd-core/coding/presets.ts`;
  `docs/features/coding.md`.
- **6b.8 Full coding backup ("clone my car")** (✅) — one-tap snapshot of every declared module's
  coding + adaptation values → dated JSON, capped store, export/share, per-module gated coding
  restore (adaptation restore manual in v1). `features/coding/api/carBackup.ts`; `docs/features/coding.md`.
- **6b.10 Bus wake / tester-present broadcast** (✅) — best-effort functional `3E 00` burst before a
  module scan, fully swallowed. `obd-core/uds/testerPresent.ts`; `docs/features/module-scan.md`.

All ten Phase 6b items have now landed (simulator-first, tested).

## Still open (⏳ / ❌)

- **KWP login (`2B`) UI + code book** (⏳) — the UDS/adaptation write paths exist; a K-line KWP
  login screen for pre-UDS adaptations is not built.
- **Label-pack coverage** (⏳) — format + one EDC17 pack ship; more packs are a data effort.
- **Real-hardware TP2.0 validation** (❌) — code + sim done; needs on-car confirmation per adapter.
- **On-car validation of the UDS module scan / adaptations / routines** (❌) — unblocked by the
  hardening pass; per-car checklists in `docs/testing.md`.

---

## Original analysis (for reference)

Written after a review of the then code-complete state (24 features, UDS write core in
`obd-core/coding`, per-module addressing via `setHeader`/`setRxFilter`).

## Where the app already overlaps VCDS

- **SRI / service reset** — done, both methods (UDS routine + adaptation write), CAN and KWP paths.
- **Long-coding read/edit/write** — done for UDS modules, profile-gated, with backup/diff/restore
  (`coding` feature + `coding.ts` bit/byte schema — this *is* a long-coding editor).
- **Security access `27`** — pluggable seed/key per profile.
- **Measuring-data reads** — engine Mode 22 DIDs (`extended-pids`), ABS module DIDs
  (`sensor-tests` module tier), DPF pack (`dpf`).
- **Engine DTCs, freeze frame, readiness, Mode 06** — standard OBD2, solid.

## The gap map (VCDS function → app status)

| VCDS function | App today | What it takes |
|---|---|---|
| **Auto-Scan** (all modules: part no, coding, faults) | ❌ | Module registry + iterate: UDS `10 03` → `22 F187/F189/F19E` → `19 02`. UDS-only v1 is buildable **now** on existing infra. |
| **Per-module fault codes** (ABS, airbag, cluster…) | ❌ engine-only (Mode 03/07/0A) | UDS `19 02` read / `14` clear / `19 04` freeze frame, addressed via existing `setHeader`/`setRxFilter`. |
| **VAG fault-code texts** (5-digit codes + symptom bytes) | ❌ generic OBD2 dictionary only | VAG DTC dictionary + UDS status-byte decoding (intermittent/confirmed/…). |
| **Output tests** (actuators) | ❌ (sensor-tests is read-only by design) | UDS `2F` InputOutputControl / KWP `30`, behind the same guardrails as coding. |
| **Basic settings** (throttle-body align, SAS G85 cal, EGR learn, brake bleed, **forced DPF regen**) | ❌ (`routineControl 31` exists in core, unused for this) | A gated "guided routines" feature: pick routine from profile, show live values while it runs, hard safety interlocks (engine state, voltage). |
| **Adaptation channels** (read → test → save) | ⚠️ writes possible via coding path; no channel browser | Generic browse/read/backup/write UI over `22`/`2E` (UDS) and read/write-local-id (KWP). |
| **Measuring blocks** (grouped, labeled, per module) | ⚠️ flat experimental DID lists | Label packs (below) + group presentation; KWP `21 <group>` for pre-UDS modules. |
| **Label files** (per-part-number names for blocks/bits/channels) | ⚠️ hardcoded in profiles | A JSON "label pack" format keyed by module part number — the single highest-leverage data investment; keeps profiles thin and community-extensible. (Own format — VCDS label files are proprietary.) |
| **Gateway installation list** | ❌ | On PQ35 it's KWP-over-**TP2.0** to the gateway → needs the TP2.0 work below. |
| **Login codes** (KWP `2B` 5-digit login) | ⚠️ only a comment in `udsCoding.ts` | Login-code entry UI + per-profile code book; needed before KWP adaptations. |
| **SFD unlock** (2020+ cars) | — | Not applicable to these cars; out of scope. |

## Hardware honesty (what parity is even possible)

- **Golf Plus 2009 (PQ35)** — the realistic parity target. Engine (EDC17) and newer modules speak
  **UDS/ISO-TP**: everything in the table above except the gateway list works with the current
  adapter. Older modules (cluster, comfort, HVAC) speak **KWP2000 over TP2.0** — doable on an
  ELM327 only via raw-CAN mode (`ATCAF0`, manual 0x200 channel setup, ACKs, keepalives, negotiated
  timing). BLE latency makes this the riskiest, highest-value engineering item: it is what turns
  "UDS-only scan" into a true VCDS-style **full Auto-Scan**.
- **Passat B5.5** — most modules speak **KWP1281** with per-byte ACK timing a stock ELM327
  physically can't do. Full VCDS parity on this car is a **hardware limit**, not a software gap:
  engine-side KWP2000 things (current service-reset path) are the ceiling. Document it; don't
  chase it. (A future non-ELM transport — KKL/OBDeleven-class — would lift it.)

## Suggested order

1. **P1 — UDS module scan + per-module DTCs** (`19 02`/`14`/`19 04`) + VAG DTC dictionary.
   Biggest visible jump toward "feels like VCDS"; pure reuse of existing addressing + UDS core.
2. **P1 — Adaptation-channel browser** and **KWP login UI** (generalize the coding UI).
3. **P1 — Guided routines**: output tests (`2F`) + basic settings (`31`), coding-grade gating.
   First shipped routine: throttle-body alignment; add forced DPF regen with strict interlocks.
4. **P1 — Label-pack format** so 1–3 render with human names instead of raw DIDs.
5. **P2 — TP2.0 transport** → full Auto-Scan + gateway install list + KWP measuring groups on the
   Golf. Prototype against the simulator first (add a TP2.0 scenario).
6. **P3 — Passat**: write the honest "what this car can/can't do over ELM327" doc section.

## Non-VCDS nice-to-haves spotted during review

- **CAN multi-PID batching** — `pollOnce()` sends one PID per request; ISO 15765 allows up to 6
  PIDs per Mode 01 frame → ~3–6× faster live-charts/performance-tests sampling on CAN cars.
- **Freeze frame for every stored DTC** — currently only the first stored code (Mode 02 supports
  per-frame addressing).
- **Log→simulator replay** — turn the Settings adapter-I/O log captured on a real car into a
  simulator scenario file. Kills the "confirm on the real car" loop for every experimental DID.
- **VIN → profile suggestion** — `vin-decode` already exists; on connect, suggest the matching
  registry profile (or prefill a new one) in `vehicle-select`.
- **Mode 05** (O2 test results, non-CAN) — the K-line/Passat counterpart of Mode 06.
- **IUPR (Mode 09 08/0B)** — in-use monitor performance ratios; great signal for
  `used-car-inspection` (detects readiness-reset games beyond permanent DTCs).
- **CAN sniffer screen** (`ATMA`) — raw bus monitor for tinkerers; cheap to add, pairs well with
  the raw-frame debugging philosophy already in extended-pids.
