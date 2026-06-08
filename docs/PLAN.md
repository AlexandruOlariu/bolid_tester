# Bolid Tester — OBD2 Diagnostics App (Plan)

> This is the approved implementation plan, kept in-repo as part of the documentation-driven
> workflow. Progress against it is tracked in [`implementation-log.md`](./implementation-log.md).

## Context

The user owns a **Vgate iCar Pro Bluetooth 4.0** OBD2 adapter and wants a mobile app
(Android **and** iOS) that is a **generic OBD2/EOBD diagnostics tool** — it must work with *any*
OBD2-compliant car. The three cars below are the **user's own cars, used as concrete example /
reference profiles** that we must verify end-to-end. They are **seed data for an extensible vehicle
registry, not the app's fixed scope**:

| Car | Engine | Fuel | Expected OBD2 transport |
|-----|--------|------|--------------------------|
| VW Golf Plus 2009, 81 kW / 109 cp | 2.0 TDI, manual | diesel | **CAN** (ISO 15765-4) — full generic support |
| Fiat Grande Punto 1.2 2008 | 1.2 petrol, manual | petrol | **CAN** (ISO 15765-4) |
| VW Passat B5.5, AVB-family | 1.9 TDI, manual | diesel | **K-line KWP2000** (ISO 14230-4) — riskiest, thinner live data |

Adding a car later = drop in a `docs/vehicles/<car>.md` + a typed profile (no changes to the engine);
the app also offers an **Auto / Generic OBD2** mode that works with **no profile at all**.

The whole project is **documentation-driven**: a `docs/` folder of Markdown files is the canonical
source of truth that drives implementation, and we keep running descriptions of what we build there
too.

### Confirmed decisions
- **Docs model:** *Spec = source of truth.* `docs/` Markdown is canonical; vehicle data also lives
  as typed TS config kept in sync with the docs (no runtime markdown parsing).
- **Stack:** **React Native via Expo** (dev client + config plugins, cloud EAS builds so no Mac
  needed). A pure browser web app cannot do BLE on iOS (Web Bluetooth unsupported in Safari), and iOS
  is required. All OBD2 logic lives in a **platform-agnostic TS core** so a Web Bluetooth PWA
  (Android/desktop) can be added later for free.
- **Generic-first:** the cars are **examples** — the engine works with **any** OBD2 car via auto
  protocol detection; vehicles are an **extensible registry** (profile = Markdown + typed config).
- **v1 scope:** Generic OBD2/EOBD validated against the three example cars, **plus a profile-driven
  manufacturer-extensions mechanism** for extra PIDs — **VAG** is the first example.
- **UI architecture:** *Feature-driven (feature-sliced).* Each feature is a self-contained folder
  with its own `ui / styles / hooks / api / model`; cross-cutting code lives in a `shared/` layer.
- **Design system:** **Tamagui** (universal RN + web, themed tokens, light/dark); `react-native-svg`
  for gauges. (Fallback if setup proves heavy: React Native Paper.)

### What a generic ELM327 can and cannot do
- ✅ Engine/emissions ECU via standard OBD2: live data (Mode 01), read & clear DTCs (03/04/07),
  freeze frame (02), readiness, VIN (09).
- ⚠️ Manufacturer extended PIDs (Mode 22) are experimental, per-profile, tuned on the real car.
- ❌ Not VCDS/VAG-COM: no ABS/airbag/transmission/cluster modules, no MS/SW-CAN.

## Milestones

- **Phase 0 — Docs + scaffold.** Full `docs/` tree; Expo app + TS core skeleton + tooling.
- **Phase 1 — OBD2 core + simulator (no hardware).** Transport interface, ELM327 client, OBD2
  PID/DTC/VIN layer, the generic profile + 3 example profiles, MockTransport simulator. Tests green.
- **Phase 2 — BLE transport + UI.** `BleTransport`, permissions, the feature screens, simulator
  toggle.
- **Phase 3 — Extended PIDs + polish.** Profile-driven Mode 22 PIDs (VAG example) behind a flag,
  freeze frame, readiness, logging/export, on-car checklists, EAS builds.

## Verification

- **In-container / CI (no hardware):** unit tests (decoders, DTC, ELM327 parsing, simulator);
  integration test running a full `DiagnosticSession` against `MockTransport` for the generic profile
  and each example car; docs-sync test; `tsc --noEmit` + `eslint`.
- **On real cars:** per-vehicle checklist in [`testing.md`](./testing.md).

See the repository root and [`architecture.md`](./architecture.md) for the detailed component design.
