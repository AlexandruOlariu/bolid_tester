# Feature: sensor-tests

Inspect and **actively test individual sensors** — watch a single sensor live while you actuate it
(a "wiggle test"), and read standardized **on-board monitor test results**. This splits cleanly into
a **standard tier** (any OBD2 car) and an **experimental tier** (non-powertrain modules on CAN cars).

> The honest boundary: a generic ELM327 sees the **engine/emissions ECU**. Powertrain sensors
> (O2, MAF, MAP, IAT, ECT, TPS, …) are fully testable with standard OBD2. **Non-powertrain sensors
> — e.g. ABS wheel-speed — live on a *different module* (ABS/ESP) and are *not* on the OBD2 PID
> space.** Reading them is the same experimental, CAN-only, per-profile territory as
> [`extended-pids`](./extended-pids.md) and [`coding`](./coding.md), and is impossible over K-line.

## Standard tier — powertrain sensors (any OBD2 car)
- **Live single-sensor view** — pick one PID from the effective set and watch it large, fast, and
  graphed (reuses [`live-charts`](./live-charts.md)) with min/max-since-reset. Ideal for wiggle/tap
  tests: flex a connector or blip the throttle and watch the trace react.
- **Mode 06 — On-Board Monitoring Test Results.** The standardized "component test" mode: per-monitor
  Test ID (TID) / Component ID results with **value, min, max, and pass/fail**. Covers things like
  oxygen-sensor response, catalyst efficiency, EGR, evap — the closest thing OBD2 has to a built-in
  sensor self-test. CAN cars expose the richest set.
- **O2-sensor helpers** — for narrowband sensors, show switching behaviour live; surface the
  relevant Mode 06 O2 results where present.

## Experimental tier — module sensors (CAN only, profile-driven)
- **ABS wheel-speed & other module sensors** via **UDS `22` ReadDataByIdentifier** addressed to the
  **ABS/ESP module** (not the engine ECU): set the tester→module CAN header (`ATSH`), the RX filter
  (`ATCRA`), flow control, then poll the module's live-data DIDs.
- Requires a **profile-supplied module map**: the module's request/response CAN IDs and the DIDs for
  each wheel-speed channel, with a decoder. None are standardized — they are **per-car, unverified**,
  must be confirmed on the real vehicle, and ship only as illustrative seeds (simulator returns canned
  values). Hidden entirely unless the profile declares them **and** the link is CAN. K-line cars
  (e.g. the Passat B5.5) never offer this tier.

## UI
- **SensorTestScreen** — two sections: **Powertrain** (live single-sensor + Mode 06 results table)
  and, only when applicable, **Modules (experimental)** with the ABS/ESP wheel-speed channels, each
  row badged "experimental / unverified" with raw DID + response shown.
- A four-wheel layout for wheel-speed so you can spin one wheel (raised, in neutral) and confirm the
  matching channel responds.

## hooks
- `useLiveSensor(pid)` — high-priority single-PID poll + rolling buffer + min/max.
- `useMode06()` — request and decode Mode 06 TIDs into a labeled results table.
- `useModuleSensors()` — reads the profile's module sensor map, issues the UDS reads, exposes values
  + raw frames. Gated on CAN + profile opt-in.

## api (service layer)
- `sensorTestService` — for standard tier, raises poll priority of the selected PID and issues
  `06 <TID>`, decoding per SAE J1979 Mode 06 structure. For the experimental tier, reuses the
  `extended-pids` addressing path (`ATSH`/`ATCRA`/flow control + `22`) against the module address
  from the profile.

## model
- `sensorTestStore` (Zustand): `selectedPid`, `mode06Results`, `moduleSensors`, `rawFrames`.
- Profiles gain an optional `moduleSensors` map (module CAN IDs + DIDs + decoders), mirroring how
  `extendedPids` is declared.

## Behavior
- Standard tier works on **every** OBD2 car and in the **simulator**.
- Experimental tier is invisible unless the profile opts in and the protocol is CAN; every module
  value is labeled experimental with raw frames always shown.
- Read-only: this feature never *writes* to any module — actuator commands and coding are out of
  scope here (see [`coding`](./coding.md) for the write path and its guardrails).

## Acceptance
- For any simulated car, a chosen powertrain PID streams in the single-sensor view and a seeded
  Mode 06 result renders with pass/fail.
- For the Golf (CAN) simulator with a seeded ABS module map, four wheel-speed channels read with the
  "unverified" badge; the experimental section is **absent** for the K-line Passat and the Punto.
