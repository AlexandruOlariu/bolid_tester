# Feature: adapter-health

A one-tap **adapter health check** that grades your ELM327 so "is my clone junk?" support questions
become a screenshot. It reads the adapter's identity — firmware (`ATI`), supply voltage (`ATRV`),
negotiated protocol (`ATDPN`) — then times a short burst of `0100` commands and turns the whole thing
into a plain **good / ok / poor** grade with human-readable notes.

> Honest scope: this measures how the *adapter* behaves (firmware string, link voltage, command
> latency), not the health of the car. A fast clone is still graded "ok" — it works, but genuine ELM327
> silicon is rare, so we don't promise flawless. Thresholds are conservative and split CAN vs K-line.

## What it does
- **Firmware (`ATI`)** — the version string. Common inflated clone strings (`v1.5`, `v2.1`) are flagged;
  genuine chips topped out at v1.x years ago.
- **Voltage (`ATRV`)** — the vehicle supply as the adapter sees it. Below ~11.5 V warns of a weak
  battery / ignition off (live readings may drop out).
- **Protocol (`ATDPN`)** — the auto-detected bus, used only to pick the latency budget (CAN is fast;
  K-line / J1850 is slower by design and gets a more forgiving threshold).
- **Latency burst** — ~10 timed `0100` round trips; reports min / median / max ms and how many
  answered. The **median** drives the grade.

## UI
- **AdapterHealthScreen** — a **Run health check** button (requires a connected session) that steps
  through the identity reads and the burst (progress is shown), then displays the grade, the identity
  card, the latency tiles, and the per-check notes. **Share as text** writes a plain-text report to a
  file and opens the OS share sheet (`expo-sharing`) — the pasteable support artifact.

## hooks
- `useAdapterHealth()` — runs the sequence against `session.client` (`version()` / `voltage()` /
  `protocolNumber()` then a `command('0100')` loop timed with `Date.now()`), grades it with
  `gradeAdapter`, and exposes `{ run, share, running, phase, report }`. Commands are one-off and
  serialized by the ELM client behind whatever the EngineHost poll loop is doing — no extra loop.

## api (pure)
- `gradeAdapter(input)` → `{ grade, latency, notes, cloneSuspected }` — pure, unit-tested. Latency sets
  the baseline; a clone tell caps an otherwise-"good" adapter at "ok"; a non-answering adapter is
  "poor". `summarizeLatency` computes min / median / max.
- `formatAdapterReport(report)` → the shareable plain-text block. Pure, so it's testable and reused by
  the share flow.

## model
- `adapterHealthStore` (Zustand): `running`, `phase`, `report`. Not persisted — a check is a one-off.

## Behavior
- Works in the **simulator** (steady `12.3 V` from `ATRV`, a firmware string, and `0100` answers), so
  the full run/grade/share flow is exercised with no hardware; scripted inputs drive the unit tests.
- Tied to an active session; the grading math itself is hardware-free.

## Acceptance
- A connected session runs the check and yields a grade + latency stats + notes.
- A `v1.5`/`v2.1` firmware string is flagged as a suspected clone and caps the grade at "ok".
- K-line gets a more forgiving latency budget than CAN.
- Sharing produces a plain-text report; unavailable share modules are a safe no-op.
