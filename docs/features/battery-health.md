# Feature: battery-health

Track the **12 V battery and charging system** from system voltage: resting voltage → state of
charge, the **cranking dip** during a start, and the **alternator** charging voltage while running —
with a plain *good / fair / weak* verdict.

> Honest scope: this reads **system voltage** (ELM327 `ATRV`, or Mode 01 PID 42 control-module
> voltage), not a proper load test. It's a useful early warning (a tired battery or weak alternator),
> not a substitute for a carbon-pile / conductance tester. Thresholds are for a conventional 12 V
> lead-acid system.

## What it does
- **Resting voltage** (key-on, engine-off) → an approximate **state of charge** (12.6 V ≈ 100 %,
  12.0 V ≈ 25 %).
- **Cranking dip** — the lowest voltage during a start. A healthy battery holds well above ~9.6 V; a
  drop into the 8 s is a weak battery (or heavy starter draw).
- **Charging voltage** — alternator output while running should sit ~13.6–14.8 V; lower suggests a
  weak alternator/regulator, much higher an over-charge.

## UI
- **BatteryScreen** — a **Capture** button that samples voltage for a few seconds (the user is
  prompted to optionally crank/start during the window), then shows resting V + SoC, cranking dip,
  charging V, the verdict, and the per-phase notes. A live voltage read is shown when connected.

## hooks
- `useBatteryHealth()` — samples `session.client.voltage()` (`ATRV`) every ~200 ms for a short window,
  collects `{ t, v }`, calls `analyzeBattery`, and exposes `{ capture, capturing, report, liveV }`.

## api (core)
- Pure analysis in [`obd-core/analysis/battery`](../architecture.md) — `analyzeBattery(samples)` →
  `{ restingV, crankingDipV, chargingV, socPct, verdict, notes }`, and `socFromResting(v)`. No I/O;
  unit-tested.

## model
- `batteryStore` (Zustand): `samples: VSample[]`, `report: BatteryReport | null`, `capturing`. Not
  persisted (a capture is a one-off; a trend could be added later via [`history`](./history.md)).

## Behavior
- Works in the **simulator** (which returns a steady `12.3V` from `ATRV`), so the capture/verdict flow
  is exercised with no hardware; a scripted dip/charge series drives the unit tests.
- Tied to an active session for live voltage; the math itself is hardware-free.

## Acceptance
- A captured series of resting → crank dip → charging classifies each phase and yields a verdict.
- `socFromResting` returns 100 % at 12.6 V, 50 % at 12.2 V, clamped 0–100.
- A low charging voltage adds a "weak alternator/regulator" note.
