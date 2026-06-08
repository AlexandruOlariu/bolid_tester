# Bolid Tester

A **generic OBD2 / EOBD diagnostics app** for Android and iOS that talks to an ELM327-compatible
**Bluetooth Low Energy** adapter (e.g. the *Vgate iCar Pro Bluetooth 4.0*). Reads live engine data,
reads & clears engine fault codes, shows readiness/freeze-frame, and reads the VIN — for any
OBD2-compliant car.

> **This project is documentation-driven.** The [`docs/`](./docs) folder is the source of truth.
> Start with [`docs/README.md`](./docs/README.md) and [`docs/PLAN.md`](./docs/PLAN.md).

## Status

- ✅ **Phase 0** — docs foundation + scaffolding.
- ✅ **Phase 1** — platform-agnostic OBD2 core + ELM327 simulator + tests (runs with no hardware).
- ✅ **Phase 2** — React Native (Expo) feature-sliced UI + BLE transport (`react-native-ble-plx`) +
  experimental Mode 22 PIDs. Builds/runs on a dev machine / EAS — see
  [`docs/phase2-mobile-app.md`](./docs/phase2-mobile-app.md).
- ⏳ **Phase 3** — on-car validation against the three example cars, polish, store builds.

See [`docs/implementation-log.md`](./docs/implementation-log.md) for details.

## The OBD2 core (Phase 1) — runnable now

The diagnostic engine in [`src/shared/obd-core`](./src/shared/obd-core) is pure TypeScript with **no
platform dependencies**. It is exercised against a built-in **virtual ELM327** simulator
([`docs/simulator.md`](./docs/simulator.md)), so the whole thing is testable with no car or adapter.

```bash
npm install
npm test          # unit + integration tests (incl. the 3 example cars via the simulator)
npm run typecheck # tsc --noEmit
npm run lint
```

## Example cars validated

The three cars in [`docs/vehicles/`](./docs/vehicles) are the project owner's own cars, used as
reference profiles: **VW Golf Plus 2009 2.0 TDI** (CAN), **Fiat Punto 1.2 2007** (K-line/CAN), and
**VW Passat B5.5 1.9 TDI** (K-line). They are examples — the app works with any OBD2 car, and new
cars are added as data (a Markdown profile + a typed object).

## Phase 2 (mobile app)

The Expo app and BLE transport require a native build (Android/iOS device or EAS), so they are
developed/installed on a developer machine — not in the cloud container. The architecture
([`docs/architecture.md`](./docs/architecture.md)) keeps the UI thin over the already-tested core.
