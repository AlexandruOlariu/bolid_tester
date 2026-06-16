# Feature: dpf — DPF / regeneration monitor (experimental, diesel, CAN-only)

A diesel-focused read-only view of the **diesel particulate filter**: soot load, ash load, distance
and count since the last **regeneration**, exhaust-gas temperature, plus EGR/oil-temp — turned into a
plain status (*OK / filling / regen due / regenerating / high*) with driver advice.

> ⚠️ **Experimental.** The underlying values come from **manufacturer Mode 22 DIDs** which are **not
> standardized**. The DIDs shipped in the VAG profile are **illustrative** and must be **confirmed on
> the real car** before the numbers are trusted. The interpretation thresholds are typical
> passenger-car values. This is **read-only** — no forced/service regeneration is performed (that
> would be a gated UDS write, out of scope here).

## What's actually possible over a generic ELM327
- Only **CAN/UDS** cars can answer Mode 22 (`22 <DID>` → `62 …`). Of the example cars that is the
  **Golf Plus 2009 TDI**. The **Passat B5.5** is K-line (no Mode 22) and the **Punto** is petrol — the
  screen is **hidden** for both.
- The feature reads whichever DPF/diesel DIDs the active profile declares (tagged `category: 'dpf' |
  'diesel'` with a semantic `role`), so a new diesel profile lights it up with **no code change**.

## UI
- **DpfScreen** — a status banner (color by status), the computed **soot load %**, and a tile grid of
  every diesel value read (name, value, unit, an *experimental* badge). A short "what to do" line from
  the assessment (e.g. *"a 15–20 min steady drive at speed usually triggers a regen"*). Shown only
  when the profile declares diesel/DPF PIDs **and** the link is CAN; otherwise an honest "not
  available for this car / protocol" note.

## hooks
- `useDpf()` — filters `profile.extendedPids` to `category` dpf/diesel, gates on `isCan`, issues the
  Mode 22 reads via `session.readExtended(did)`, decodes with the profile decoder, maps the `role`s
  into a `DpfInput`, and returns `{ available, values, report, refresh, running }`.

## api (core)
- Pure interpretation lives in [`obd-core/analysis/dpf`](../architecture.md) — `assessDpf(input)`
  returning `{ status, sootPct, advice, flags }`. No I/O, unit-tested.
- The raw reads reuse `DiagnosticSession.readExtended` (the same path as
  [`extended-pids`](./extended-pids.md)); values also appear there raw, for debugging.

## model
- `dpfStore` (Zustand): `values: { name, unit, value, role }[]`, `report: DpfReport | null`,
  `running`. Not persisted (live reads).
- Profile data: a **diesel pack** of `ExtendedPid`s on the Golf profile (soot mass/%, ash, distance &
  count since regen, EGT, oil temp, EGR), each `experimental`, `category`/`role`-tagged, with a
  `sampleResponse` the simulator serves.

## Behavior
- Fully exercised in the **simulator**: the seeded DIDs return plausible values so the status banner,
  advice and tiles all render with no hardware.
- Every value is labelled experimental; the assessment never claims certainty.

## Acceptance
- On the Golf simulator the screen shows a soot-load %, a status, advice, and one tile per diesel DID.
- The screen is **absent** for the Passat (K-line) and Punto (petrol) profiles.
- `assessDpf` returns `regenerating` when a regen flag/high EGT is present, `high` at ≥90 % soot.
