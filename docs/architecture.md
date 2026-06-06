# Architecture

## Overview

A pure-TypeScript **OBD2 core** (no platform APIs) sits behind a swappable **Transport** interface.
A thin React Native (Expo) UI, organized as **feature slices**, sits on top. This keeps the
diagnostic engine unit-testable with **no hardware** and reusable across the BLE transport, a future
Web Bluetooth build, and the in-memory simulator.

```
UI — feature slices (Tamagui)  ──►  state stores (Zustand)  ──►  DiagnosticSession
                                                              │
                                                       OBD2 layer (PIDs, DTC, VIN)
                                                              │
                                                       ELM327 client (AT cmds, queue, parsing)
                                                              │
                                                   Transport interface
                                          ┌───────────────┼─────────────────┐
                                   BleTransport      MockTransport     (WebBluetoothTransport
                              (react-native-ble-plx)  (simulator)        — future, optional)
```

## Layers (bottom-up)

### 1. Transport (`src/shared/obd-core/transport`)
A minimal byte pipe. The rest of the stack does not care whether bytes go over BLE, a mock, or
(later) Web Bluetooth.

```ts
interface Transport {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  write(bytes: Uint8Array): Promise<void>;
  onData(listener: (bytes: Uint8Array) => void): () => void; // returns unsubscribe
  readonly status: TransportStatus; // 'disconnected' | 'connecting' | 'connected' | 'error'
}
```

- **`MockTransport`** — the simulator (see [`simulator.md`](./simulator.md)). Pure, deterministic.
- **`BleTransport`** — wraps `react-native-ble-plx`. **Discovers** the notify + write characteristics
  at runtime instead of hard-coding UUIDs, so it is robust across ELM327 BLE clones.

### 2. ELM327 client (`src/shared/obd-core/elm327`)
Turns the byte pipe into a request/response command channel.

- **Half-duplex command queue.** The ELM327 handles **one** command at a time. The client serializes
  commands, appends `\r`, and resolves when the terminating `>` prompt is seen.
- **Response cleanup.** Strips command echo (we also send `ATE0`), `\r`/`\n`, spaces (`ATS0`), and the
  `>` prompt; detects `NO DATA`, `?`, `SEARCHING...`, `UNABLE TO CONNECT`, `STOPPED`, `BUFFER FULL`.
- **Init sequence.** `ATZ → ATE0 → ATL0 → ATS0 → ATH0 → ATSP0` then probe `0100`. Adaptive timing
  (`ATAT1`). See [`obd2-reference.md`](./obd2-reference.md).
- **Timeouts & retries** per command, with a longer timeout while the adapter is `SEARCHING...`.

### 3. OBD2 layer (`src/shared/obd-core/obd`)
Protocol-agnostic OBD2 semantics on top of the ELM327 client.

- **PID registry** — declarative table of Mode 01 PIDs with `{ pid, name, unit, bytes, decode() }`.
- **Decoders** — pure functions from response bytes to typed values (RPM, °C, km/h, %, V, …).
- **DTC parsing** — 2-byte → `P/C/B/U` codes for Modes 03 (stored), 07 (pending), 0A (permanent).
- **VIN** — Mode 09 PID 02 (multi-frame assembly).
- **Supported-PID discovery** — bitmaps `0100/0120/0140/0160`.

### 4. DiagnosticSession (`src/shared/obd-core/session`)
High-level orchestration used by the UI:
`connect → init → identify (protocol + supported PIDs + VIN) → poll live PIDs → read/clear DTCs`.
Exposes reactive streams/snapshots the UI subscribes to.

### 5. Vehicle registry (`src/shared/vehicles`)
Typed profiles (an **extensible registry**). A built-in `generic` auto-detect profile works for any
car. Profiles drive protocol pre-selection, dashboard filtering, the simulator, and extended-PID
gating. See [`vehicles/README.md`](./vehicles/README.md).

## UI: feature-sliced

Each feature in `src/features/<name>` is **self-contained** and depends only on `src/shared/*`,
never on another feature:

```
features/<name>/
├── ui/        # screens + components (Tamagui)
├── styles/    # styling for this feature
├── hooks/     # React hooks (consume api + stores)
├── api/       # the feature's service layer → talks to the OBD2 core/device (NOT a network API)
├── model/     # types + Zustand store slice
└── index.ts   # the feature's public surface
```

Shared, cross-cutting code (the OBD2 core, vehicle registry, BLE transport, design-system wrappers,
theme, generic hooks, utils) lives under `src/shared/*`. Anything reused by two features is promoted
to `shared`.

**Routing.** `src/app/*` (expo-router) files are thin and just render a feature screen.

## State management

[Zustand](https://github.com/pmndrs/zustand) stores hold connection state, the live-data snapshot,
and the DTC list. The `DiagnosticSession` pushes updates into these stores; hooks read from them.
Keeping stores thin and the logic in the core means the logic is testable without React.

## Error handling & resilience

- Every command can fail (`NO DATA`, timeout, `UNABLE TO CONNECT`); the session degrades gracefully
  (e.g. skip an unsupported PID rather than abort the whole poll).
- BLE disconnects surface as a `status` change; the UI offers reconnect.
- All adapter I/O can be mirrored to an in-app **log** (Settings) for debugging real cars.

## Why this shape

- **Testable without a car** — the core + simulator run in plain Node/Jest in CI and in this
  container.
- **Portable** — swapping `BleTransport` for `WebBluetoothTransport` later is a single-file change.
- **Generic-first** — no car model is hard-coded in the engine; cars are data (profiles).
