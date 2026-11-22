# Feature: fault-codes

Read and clear Diagnostic Trouble Codes (DTCs), show freeze frame and readiness monitors. Every read is saved to [History](./history.md).

## UI

- **FaultCodesScreen** — three sections: **Stored** (Mode 03), **Pending** (Mode 07),
  **Permanent** (Mode 0A). Each code shows the code string (e.g. `P0299`) + a description from the
  [DTC database](#dtc-database) + a **Guide** affordance (see below). Tapping the code or its
  description opens the [detail sheet](#detail-sheet).
- **Readiness** panel — MIL on/off + monitor readiness from PID `0101`.
- **Drive-cycle coach** panel — appears when monitors are incomplete (e.g. right after a clear) or
  once enabled (see below).
- **Freeze frame** — values captured when a code set (Mode 02), shown for the first stored code.
- **Clear** button — confirmation dialog → Mode 04 → re-read.
- **Export report** (Markdown) and **Share report** (HTML) — both snapshot the current read (vehicle,
  VIN, protocol, MIL, readiness, stored/pending/permanent codes with VAG cross-reference numbers, and
  any freeze frames) and open the OS share sheet. Markdown is the plain-text export; the HTML report is
  a self-contained, print-friendly "send to my mechanic" artifact. The snapshot is
  `dtcCheckFromRead(read, info, label, { adapter })` in `src/shared/lib/dtcReport.ts` (plan 15 moved
  the screen's local `buildCheck` there so the [vehicle report](./report.md) shares it); since then
  the HTML report also carries the protocol **label** (`PROTOCOL_LABELS`, not the raw id), the
  adapter voltage and the adapter name.
- **Full report** — opens the [unified vehicle report](./report.md) (`/report`): this read plus the
  module scan, inspection, battery, AI summary and maintenance due list in one PDF / HTML / Markdown.

## Guided fault finding (6b.7)

Each DTC row has an expandable **Guide** that turns a code into the data that explains it, driven by a
small per-profile lookup table (`shared/vehicles/faultGuides.ts`, `matchFaultGuide(profileId, code,
vagCode?)`). A guide shows:

- a short **note** (what to look at and why),
- a **Related data** deep-link to the [Extended PIDs](./extended-pids.md) screen carrying the related
  DIDs (`/extended?dids=…`, which pre-selects + highlights them),
- an **Open routine** deep-link to the [Routines](./routines.md) screen when a `routineId` maps
  (e.g. EGR flow → EGR valve output test; intake-flap → V157 basic setting),
- the code's **freeze frame** inline when one was captured.

Matching is order-sensitive: the first rule whose `codes` contains the generic P-code **or** its VAG
5-digit number, or whose `prefix` the code starts with, wins. Unmatched codes fall back to a generic
guide (freeze frame + generic note), so every row has a useful guide. The reference **Golf Plus**
ships representative guides (EGR, DPF, boost/P0299, glow plugs, plus the car's own P2015/P2183); other
profiles use the generic fallback. Guides are curated **outside** the vehicle profiles/types on
purpose.

## DTC database

`src/shared/obd-core/obd/dtcDatabase/` (pure, bundled statically, about 180 KB of source against a
350 KB budget):

| File                                  | Holds                                                                      |
| ------------------------------------- | -------------------------------------------------------------------------- |
| `index.ts`                            | types, range table, severity rules, `lookupDtc`, `describeDtc`             |
| `generic/p0.ts` (+ `p0-part1…4.ts`)   | SAE P0000–P0AFF (1 333 codes; P0B/P0C hybrid blocks fall back to range)    |
| `generic/p2.ts` (+ `p2-part1…2.ts`)   | SAE P2000–P2FFF (694 codes)                                                |
| `generic/p3.ts`                       | SAE P3400–P34FF cylinder deactivation block (98)                           |
| `generic/b0.ts`, `generic/c0.ts`      | generic body / chassis (10 each — only well-established assignments)       |
| `generic/u0.ts`                       | U0001–U04FF network: bus, lost communication, software, invalid data (271) |
| `manufacturer/vag.ts` (+ `vag-p1.ts`) | VAG P1xxx by SAE code (157) and the native KWP 5-digit table (TP2.0 only)  |
| `manufacturer/fiat.ts`                | Fiat / FGA P1xxx — empty; filled on-car (plan 05 deferred section)         |

API (`@/shared/obd-core`, re-exported by `obd/dtc.ts`):

```ts
type DtcMake = 'vag' | 'fiat' | 'generic';
type DtcSeverity = 'info' | 'moderate' | 'high' | 'unknown';
lookupDtc(code, make = 'generic'): DtcInfo; // code, description, system, subsystem, severity,
//                                             manufacturerSpecific, source
describeDtc(code, make?): string; // = lookupDtc(...).description
toDtc(code, make?): Dtc;
```

- **Generic codes** (P0, P2, P34xx, B0, C0, U0) always resolve from the SAE tables, whatever the
  make. **Manufacturer-specific codes** (P1xxx, P3000–P33FF, B1/B2, C1/C2, U1/U2) resolve from the
  `make` table; with no entry (or make `generic`) the source is `range`.
- **Fallback** when there is no entry: `<System> — <subsystem> fault (<code>)`, e.g.
  `Powertrain — Reserved (ISO/SAE) fault (P3FFF)`. The subsystem comes from `DTC_RANGES` (P0/P1 by
  the third character: fuel & air metering, ignition / misfire, auxiliary emission, speed & idle,
  computer & output, transmission, hybrid; P2/P3/U0 by the J2012 grouping) — see
  [`../obd2-reference.md`](../obd2-reference.md#dtc-encoding).
- **Severity rules** (`DTC_SEVERITY_RULES`, ordered, first match): misfire `P030x`/`P031x`, hybrid
  `P0A`/`P0B`, over temperature `P0217`/`P0218`, oil pressure `P0520`–`P0524`, crank sensor
  `P0335`/`P0336` → **high**; lost communication `U0100`–`U01FF`, catalyst `P0420`/`P0430`,
  emissions `P04xx`, DPF (`P2002`/`P2003`, `P242F`, `P2452`–`P2463`), computer `P06xx` →
  **moderate**; any other code with an entry → **info**; no entry → **unknown**.
- **Make-aware reads.** The core `readDtcs` stays generic; `dtcService.readAll()` (and the AI
  snapshot) re-describe with the profile's `make` (`toDtc(code, profile.make)`), so a Golf shows the
  VAG text for `P1557`. Module scan (UDS) describes each DTC with `describeDtc(sae, 'vag')` only.
- **Sourcing rule.** Descriptions are the standardized SAE J2012 / ISO 15031-6 definitions, authored
  for this project in short canonical wording. Never copy from GPL sources (python-OBD's `codes.py`
  is GPL-2); a list may only be used when it is MIT/BSD/public domain and cited in the file header.
  Uncertain codes are left out, not guessed. Each file at most 1 800 lines, keys
  `/^[PCBU][0-9A-F]{4}$/`, no duplicates across files, module at most 350 KB of source —
  `dtcDatabase.test.ts` enforces all of it.
- **Two VAG number spaces, never mixed.** `VAG_P1` is keyed by the SAE code (what OBD2 modes and
  UDS report: their two DTC bytes are SAE-encoded). `VAG_DTC_TEXTS` holds native KWP1281/KWP2000
  fault numbers (e.g. `00532` Supply voltage B+), read by KWP `0x18` from TP2.0 modules, and is
  only used there (`vagNativeDtcText`). Read as SAE bytes those numbers are different, standardized
  faults (`01312` = 0x0520 = `P0520` oil pressure, not "powertrain data bus"), so the UDS path never
  consults it. Its texts name the component only; the failure type comes from the status byte.
  `uds/vagDtcs.ts` is a compatibility re-export (`VAG_DTC_TEXTS`, `vagNativeDtcText`, `vagDtcText`).

## Detail sheet

`ui/DtcDetailSheet.tsx` — a Tamagui `Sheet` (`modal`, 85 % snap point), opened by tapping the code
(or its description) in a row; view model in `model/dtcDetail.ts` (pure, tested). Top to bottom:

1. The code (large), the VAG 5-digit number (VAG and generic profiles) and a severity badge (high
   red, moderate amber, info blue, unknown grey) with a one-line hint.
2. Description; `system · subsystem`; a **Manufacturer-specific** chip when applicable.
3. The freeze frame captured for this code (same block as the inline guide).
4. The fault guide (`matchFaultGuide`) note and its **Related data** / **Open routine** links.
5. Actions: **Explain with AI** → `/ai-diagnose?focus=<code>` (see
   [AI diagnose](./ai-diagnose.md#focused-run-explain-with-ai)); **Search the web** → a Google
   search for `<code> OBD2 <car name>`; **Share** → the OS share sheet with a plain-text summary
   (copy from there; `expo-clipboard` is not installed).
6. Footer: "Descriptions follow SAE J2012. Causes and fixes vary by car; use the guide and freeze
   frame before replacing parts."

The inline **Guide** button on each row stays; both use the shared `ui/DtcGuideParts.tsx`.

## Drive-cycle / readiness coach (6b.9)

After a code clear the readiness monitors flip to "not ready" and only complete over a drive. The
coach helps finish them:

- A **Coach** toggle on the panel; while enabled **and** connected, `EngineHost`
  (`src/features/engine-host`) polls readiness (`0101`) every ~30 s (isolated watcher reading
  `coachStore`).
- The panel lists each **incomplete monitor** with a short, **generic/approximate** completion pattern
  (`obd-core/obd/driveCycle.ts` — cold start, warm-up, steady cruise, etc.), updating live as monitors
  complete.
- An **OS notification** (category `diagnostic`, via `notify()` so it respects prefs + quiet hours)
  fires the moment a monitor flips ready, and once when **all** monitors are ready. Edge detection is
  the pure `diffReadiness(prev, next)` helper.
- Coach mode ends on manual toggle-off or on disconnect.

## AI agent

- `agent/agentTools.ts` contributes the `fault_codes` skill and the `read_dtcs_detail` tool (one code's description, status, freeze frame and guide note) to the [AI agent](./ai-diagnose.md#agent).

## hooks

- `useDtcs()` — read stored/pending/permanent; expose loading/error.
- `useClearDtcs()` — clear + refresh, with a confirm step.
- `useReadiness()` — parse PID `0101`.

## api (service layer)

- `dtcService` — issues Mode 03/07/0A, decodes 2-byte DTCs (see
  [`../obd2-reference.md`](../obd2-reference.md)), looks up descriptions, and runs Mode 04 for clear.

## model

- `dtcStore` (Zustand, lives in `src/shared/state/dtcStore.ts` because EngineHost and the
  onboarding first-run card read it too): `stored[]`, `pending[]`, `permanent[]`, `readiness`,
  `freezeFrames[]`, plus in-memory `lastReadAt` (stamped only by a real read from a live session)
  and `readFor` (the car the current results came from, `activeCarStamp()`; `clearResults()` sets
  it back to null while `lastReadAt` stays) — the vehicle report uses the live read only when
  `readFor` matches its car.
- `coachStore` (Zustand): `enabled`, the coach's latest polled `readiness`, `updatedAt`. Shared by
  the Coach panel and the EngineHost watcher; `reset()` ends coach mode.

## Behavior

- Decoding maps the first two bits to `P/C/B/U` and assembles the 4-character code.
- Descriptions come from the [DTC database](#dtc-database); codes without an entry get a
  range-based label (`<System> — <subsystem> fault (<code>)`).
- **Clearing is destructive** (erases codes, resets readiness) — always confirm; warn that codes may
  return if the fault persists.

## Acceptance

- Decodes known fixtures correctly (`01 33 → P0133`, `02 99 → P0299`, etc.).
- Clears via Mode 04 and the list refreshes to empty in the simulator.
- Works on K-line (Passat) and CAN (Golf) simulated cars.
- Simulator, Settings → **Custom…** `P0135,P0301,U0121`: real descriptions for all three; the detail
  sheet shows severity **high** for `P0301` and **moderate** for `U0121`.
- On the Golf profile a VAG `P1557` shows the VAG text; on the generic profile the range text.
- Module scan (Golf simulator): the TP2.0 comfort module's native VAG faults `00928` / `01330` show
  their VAG component text (`vagNativeDtcText`, `tp20Scan.test.ts`); the UDS modules' SAE codes
  (`P2183`, `P2015`, `P0121`, `C0130`) show the generic text. History and the HTML report render
  the stored descriptions unchanged.
- **Explain with AI** opens the AI screen focused on the code (focus card + focused report).
