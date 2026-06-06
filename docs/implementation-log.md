# Implementation Log

A running record of what was actually built, newest first. (Documentation-driven: specs live in the
other docs; this file is the "what we did" history.)

---

## Phase 1 — OBD2 core + simulator + tests

**Status:** ✅ complete and verified (typecheck clean, 34 tests pass, lint clean).

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
