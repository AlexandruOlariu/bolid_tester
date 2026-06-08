# Implementation Log

A running record of what was actually built, newest first. (Documentation-driven: specs live in the
other docs; this file is the "what we did" history.)

---

## Phase 2 — Mobile app (Expo + Tamagui + BLE)

**Status:** ✅ code complete. Core stays green here; the RN app compiles/runs on a dev machine /
EAS (native build can't run in the container). See [`phase2-mobile-app.md`](./phase2-mobile-app.md).

Implemented the feature-sliced UI over the tested core:
- `src/shared/transports/ble/BleTransport.ts` — `Transport` over `react-native-ble-plx` with
  **runtime characteristic discovery** (no hard-coded UUIDs); `permissions.ts`, `manager.ts`,
  and a dependency-free `src/shared/lib/base64.ts` (unit-tested) for BLE payloads.
- `src/shared/state/*` — Zustand stores (`sessionStore`, `settingsStore` incl. the adapter I/O log).
- `src/shared/ui/*` — Tamagui widgets: `Screen`, `StatusBadge`, `ValueCard`, SVG `Gauge`.
- `src/features/*` — seven slices (`connection`, `vehicle-select`, `live-data`, `fault-codes`,
  `vehicle-info`, `extended-pids`, `settings`), each with `ui / styles / hooks / api / model`.
- `src/app/*` — expo-router shell (tab navigation) + `tamagui.config.ts`, `babel.config.js`,
  `metro.config.js`; `tsconfig.app.json` for the full-app typecheck; `@/*` path alias.

The Settings **simulator toggle** lets the whole UI run with no hardware, driving the same
`DiagnosticSession` the BLE path uses.

Verified in container (core scope): `npm run typecheck` (0 errors), `npm test` (36 passing),
`npm run lint` (0 issues). Full-app typecheck (`npm run typecheck:app`) runs on a dev machine after
installing the RN deps.

## Phase 1 — OBD2 core + simulator + tests

**Status:** ✅ complete and verified (typecheck clean, 36 tests pass, lint clean).

Implemented the platform-agnostic engine under `src/shared`:
- `obd-core/transport` — `Transport` interface + `MockTransport` (virtual ELM327) + `scenarios`
  (builds a simulator scenario from any vehicle profile).
- `obd-core/elm327` — `Elm327Client` (half-duplex command queue, prompt handling, init sequence,
  timeouts) + `responseParser` (notice/hex detection).
- `obd-core/obd` — `protocols`, `pids` (registry + decoders), `dtc` (encode/decode/parse +
  dictionary), `vin`, `supportedPids` (bitmap encode/decode).
- `obd-core/session` — `DiagnosticSession` orchestration (connect → init → identify → poll →
  read/clear DTCs → extended PIDs).
- `vehicles` — typed registry: `generic` + the three example cars.

Tests (`npm test`): PID decoders, DTC encode/decode/parse, VIN assembly, supported-PID bitmaps,
ELM327 client (init/read/NO-DATA/timeout), response parser, the `vehicle-docs-sync` guard, and a
full **DiagnosticSession integration** for the generic profile and all three cars (protocol,
effective PID set, VIN present/absent, DTC read+clear, live value, experimental Mode 22).

Verified: `npm run typecheck` (0 errors), `npm test` (34 passing), `npm run lint` (0 issues).

## Phase 0 — Docs foundation & scaffolding

**Status:** ✅ complete.

- Created the `docs/` source-of-truth tree: `README.md`, `PLAN.md`, `architecture.md`,
  `obd2-reference.md`, `adapter-vgate-icar-pro.md`, `simulator.md`, `testing.md`, this log;
  `vehicles/` (registry README + three example profiles with machine-readable front-matter);
  `features/` (one spec per feature slice).
- Project scaffolding: `package.json`, `tsconfig.json`, `jest.config.js`, `.eslintrc.cjs`,
  `.prettierrc`, `.gitignore`, root `README.md`, and Phase-2 Expo scaffolding (`app.json`, `eas.json`).

**Note on Phase 2 (mobile UI):** the React Native UI install (Expo / Tamagui /
`react-native-ble-plx`) requires a native build and cannot be exercised inside the remote container,
so it is developed/installed on a developer machine / EAS. The **OBD2 core + simulator + tests** are
fully built and verified here, and the UI sits thinly on top of this already-tested engine.
