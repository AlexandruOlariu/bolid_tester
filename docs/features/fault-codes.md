# Feature: fault-codes

Read and clear Diagnostic Trouble Codes (DTCs), show freeze frame and readiness monitors. Every read is saved to [History](./history.md).

## UI
- **FaultCodesScreen** — three sections: **Stored** (Mode 03), **Pending** (Mode 07),
  **Permanent** (Mode 0A). Each code shows the code string (e.g. `P0299`) + a description + a
  **Guide** affordance (see below).
- **Readiness** panel — MIL on/off + monitor readiness from PID `0101`.
- **Drive-cycle coach** panel — appears when monitors are incomplete (e.g. right after a clear) or
  once enabled (see below).
- **Freeze frame** — values captured when a code set (Mode 02), shown for the first stored code.
- **Clear** button — confirmation dialog → Mode 04 → re-read.
- **Export report** (Markdown) and **Share report** (HTML) — both snapshot the current read (vehicle,
  VIN, protocol, MIL, readiness, stored/pending/permanent codes with VAG cross-reference numbers, and
  any freeze frames) and open the OS share sheet. Markdown is the plain-text export; the HTML report is
  a self-contained, print-friendly "send to my mechanic" artifact.

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

## hooks
- `useDtcs()` — read stored/pending/permanent; expose loading/error.
- `useClearDtcs()` — clear + refresh, with a confirm step.
- `useReadiness()` — parse PID `0101`.

## api (service layer)
- `dtcService` — issues Mode 03/07/0A, decodes 2-byte DTCs (see
  [`../obd2-reference.md`](../obd2-reference.md)), looks up descriptions, and runs Mode 04 for clear.

## model
- `dtcStore` (Zustand): `stored[]`, `pending[]`, `permanent[]`, `mil`, `monitors`, `freezeFrame`.
- `coachStore` (Zustand): `enabled`, the coach's latest polled `readiness`, `updatedAt`. Shared by
  the Coach panel and the EngineHost watcher; `reset()` ends coach mode.

## Behavior
- Decoding maps the first two bits to `P/C/B/U` and assembles the 4-character code.
- Descriptions come from a small generic dictionary; unknown codes get a range-based generic label.
- **Clearing is destructive** (erases codes, resets readiness) — always confirm; warn that codes may
  return if the fault persists.

## Acceptance
- Decodes known fixtures correctly (`01 33 → P0133`, `02 99 → P0299`, etc.).
- Clears via Mode 04 and the list refreshes to empty in the simulator.
- Works on K-line (Passat) and CAN (Golf) simulated cars.
