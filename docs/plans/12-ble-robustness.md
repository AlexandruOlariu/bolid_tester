# Plan 12 — BLE robustness

**Size:** M (1–1½ days) · **Depends on:** plan 01 (shares `migrateSettings`) · **Roadmap:** v0.2
"BLE robustness"

## Goal

The link survives the real world: auto-reconnect is on by default after a confirmed drop (with a
flap guard), long commands are chunked to the negotiated MTU, an adapter that went to sleep is woken
before the first command, a late reply after a timeout can never be attributed to the next command,
and every connection failure opens a diagnostics panel that says what happened and what to try.

Everything here is implementable and testable against `MockTransport`; nothing waits for a car.

## Why

- `src/shared/state/settingsStore.ts` ships `autoReconnect: false`; a drop on the Live tab leaves
  the user to reconnect by hand.
- `BleTransport.connect()` asks for `requestMTU: 247` but never reads `device.mtu` and `write()`
  sends the whole command in one GATT write. A 16-byte UDS `2E` coding write is `2E` + 4 + 32 hex
  chars + `\r` = 39 bytes — over the 20-byte default payload if negotiation failed.
- ELM327 adapters (the Vgate included) auto-sleep after idle; the first byte wakes the chip and the
  command that carried it is lost, surfacing as a confusing timeout.
- `Elm327Client.exec()` clears `this.buffer` on entry; a reply arriving after its command timed out
  lands in the next command's window and resolves the wrong promise (the hardening note in
  `docs/improvement-plan-2026-07.md`).
- On failure the Connect screen shows one sentence of error and nothing else.

## Read first

- `src/shared/transports/ble/{BleTransport.ts, manager.ts, permissions.ts}` and
  `BleTransport.test.ts` (fake `device` / `manager` pattern).
- `src/shared/obd-core/elm327/Elm327Client.ts` (`exec`, `onData`, `raw`, `command`, `init`,
  `startMonitor`/`stopMonitor`) and `Elm327Client.test.ts`.
- `src/shared/obd-core/transport/MockTransport.ts` (`SimScenario`, `write`, `simulateDisconnect`,
  `latencyMs`) and `MockTransport.test.ts`.
- `src/features/connection/api/connectionService.ts` (`handleUnexpectedDrop`, `startAutoReconnect`,
  `connectInternal`, `withLog`), `api/reconnect.ts` (`runReconnect`, `RECONNECT_DELAYS_MS`).
- `src/features/connection/hooks/{useBluetoothState.ts, useScan.ts, useConnect.ts}`,
  `ui/{ConnectionScreen.tsx, BluetoothPrompt.tsx}`, `styles/connection.styles.ts` (`Panel`),
  `model/scanStore.ts`.
- `src/shared/state/adapterLog.ts` (`useAdapterLogStore`, `adapterLogSnapshot`, `LogEntry`),
  `src/shared/state/sessionStore.ts`.
- `docs/features/connection.md`, `docs/adapter-vgate-icar-pro.md` § "ELM327 quirks".

## Design

### 1. Auto-reconnect on by default, with a flap guard

`settingsStore.ts`: default `autoReconnect: true`. Add to `migrateSettings` (created by plan 01;
bump `version` by one and extend the `fromVersion < N` branch): `autoReconnect: p.autoReconnect ??
true` — existing blobs keep their stored value, fresh installs get `true`.

New pure module `src/features/connection/api/flapGuard.ts`:

```ts
export const FLAP_WINDOW_MS = 60_000;
export const MAX_DROPS_PER_WINDOW = 3;
/** Drop timestamps (ms). Returns true when another automatic reconnect is allowed. */
export function shouldAutoReconnect(dropsAt: number[], now: number): boolean;
/** Keep only drops inside the window. */
export function pruneDrops(dropsAt: number[], now: number): number[];
```

`connectionService.handleUnexpectedDrop()`: push `Date.now()` onto a module-level `dropsAt`, prune,
and only call `startAutoReconnect()` when `shouldAutoReconnect` is true; otherwise set the error
"The link dropped 3 times in a minute — auto-reconnect paused. Check the adapter is seated and
reconnect manually." A manual `connect()` resets `dropsAt`.

### 2. MTU negotiation and write chunking (`BleTransport.ts`)

```ts
export interface BleLinkInfo {
  mtu: number;                 // negotiated (device.mtu) or 23 when unknown
  payload: number;             // mtu - 3, floor 20
  service: string;
  notifyCharacteristic: string;
  writeCharacteristic: string;
  writeWithoutResponse: boolean;
}
get linkInfo(): BleLinkInfo | null;
```

- After `connectToDevice(…, { requestMTU: 247 })` read `device.mtu` (ble-plx exposes it on the
  returned `Device`; it is Android-only — on iOS the OS negotiates and `mtu` reports the
  negotiated value too, so no `Platform` branch is needed to read it, only to _request_ it: keep
  `requestMTU` in the options object but set it via `Platform.OS === 'android' ? { requestMTU: 247 } : {}`.
  `BleTransport.ts` currently has no `react-native` import; add `import { Platform } from
'react-native'` and, in `BleTransport.test.ts`, `jest.mock('react-native', () => ({ Platform: { OS:
'android' } }), { virtual: true })` — the test file already runs in node).
- `write(bytes)`: slice into `payload`-sized chunks and write sequentially (await each). With
  `withoutResponse` writes insert no delay (the adapter buffers); with response writes the await
  is the pacing.
- Store `linkInfo` in a new `src/features/connection/model/linkStore.ts` (`useLinkStore`:
  `{ link: BleLinkInfo | null; stage: ConnectStage | null; set… }`) from `connectInternal` right
  after `session.connect()` resolves (`rawTransport instanceof BleTransport ? rawTransport.linkInfo : null`).

### 3. Sleep / wake (`Elm327Client.ts`)

```ts
export interface Elm327Options {
  commandTimeoutMs?: number;
  firstCommandTimeoutMs?: number;
  /** NEW — idle gap after which the adapter may have auto-slept; a wake-up `\r` is sent first. Default 20_000. 0 disables. */
  wakeAfterIdleMs?: number;
}
```

- Track `lastIoAt` (updated in `exec` on write and in `onData` on any byte).
- In `raw()`'s queued runner: if `wakeAfterIdleMs > 0 && Date.now() - lastIoAt > wakeAfterIdleMs`,
  first run `execWake()`: write a bare `\r`, wait up to `WAKE_TIMEOUT_MS = 600` for a `>` (resolve
  either way, never reject), clear the buffer, then run the real command. Monitor mode is exempt.
- `init()` sets `lastIoAt = Date.now()` after `ATZ` so a fresh connection never wakes twice.
- `DiagnosticSession` passes the option through (constructor already forwards `Elm327Options`).
  `connectionService` sets `wakeAfterIdleMs: 20_000` for BLE and `0` for the simulator unless the
  scenario asks for sleep (below) — read `adapterSource` there.

### 4. Drain-until-prompt after a timeout (`Elm327Client.ts`)

- On timeout in `exec`: besides rejecting, set `this.draining = true` and remember
  `this.drainDeadline = Date.now() + DRAIN_GRACE_MS` (`DRAIN_GRACE_MS = 300`).
- `onData`: when `draining`, if the buffer contains `>` → drop everything through that prompt,
  `draining = false`, resolve the drain promise; else keep accumulating (do not touch `pending`).
- The next `exec` awaits `drainPromise` (resolves on prompt or at the deadline, whichever first),
  then clears the buffer and proceeds. Net effect: a late reply can only ever be discarded, never
  mis-attributed; the cost is ≤ 300 ms after a timeout.

### 5. Connection diagnostics panel

Pure classifier `src/features/connection/api/diagnoseFailure.ts`:

```ts
export type ConnectStage = 'bluetooth' | 'transport' | 'init' | 'probe' | 'identify';
export interface FailureDiagnosis {
  stage: ConnectStage;
  title: string;
  explanation: string;
  suggestions: string[]; // ordered, imperative, ≤ 4
}
export function diagnoseFailure(input: {
  error: string | null;
  btState: 'ready' | 'poweredOff' | 'unauthorized' | 'unsupported' | 'checking';
  adapterSource: 'mock' | 'ble';
  logTail: { dir: 'tx' | 'rx'; text: string }[]; // last ≤ 20 adapter-log entries
  deviceName: string | null;
}): FailureDiagnosis;
```

Rules (first match): `btState !== 'ready'` → `bluetooth` (reuse `BluetoothPrompt` texts); error
matches /No suitable notify/ → `transport`, "This device does not expose the serial-over-BLE
characteristics an ELM327 uses — it may be a classic Bluetooth (SPP) adapter" (points to the SPP
option once plan 27 ships); /permission/i → `bluetooth`; last tx is `ATZ` and error /timeout/ →
`init`, "The adapter accepted the link but did not answer `ATZ` — it is unpowered or asleep";
error /vehicle isn’t responding/ → `probe`, ignition guidance (reuse the session's wording); log tail
contains `UNABLE TO CONNECT` or `BUS INIT` → `probe`, K-line guidance; /timeout/ with last tx an OBD
command → `identify`; anything else → `transport` with the raw error.

`src/features/connection/ui/ConnectionDiagnostics.tsx`: rendered under the error `Panel` on
`ConnectionScreen` whenever `useSessionStore(s => s.status) === 'error'`. Collapsible "Details"
(`useState(false)`): stage chip, title, explanation, suggestions as bullets, then a monospace
block of the last 20 `useAdapterLogStore` entries (`» tx` / `« rx`, like Settings), `linkStore`
values when present (MTU, service, write mode), device id/name, and two buttons: **Copy details**
(`Share.share({ message })` from RN — no clipboard dependency) and **Open error log**
(`router.push('/error-log')`). `accessibilityLabel="Connection diagnostics"`.

## Steps

1. `flapGuard.ts` + test; `settingsStore` default + migration; wire into `handleUnexpectedDrop`.
2. `BleTransport`: `Platform`-guarded `requestMTU`, `linkInfo`, chunked `write`; tests.
3. `Elm327Client`: `wakeAfterIdleMs`, `lastIoAt`, `execWake`, drain-until-prompt; tests.
4. `MockTransport` sim controls (below); `connectionService` passes `wakeAfterIdleMs` and stores
   `linkInfo`; `linkStore.ts`.
5. `diagnoseFailure.ts` + test; `ConnectionDiagnostics.tsx`; mount in `ConnectionScreen`.
6. Settings copy for auto-reconnect ("On by default; pauses after 3 drops in a minute").
7. Docs; `npm run ci`.

## Simulator

Extend `SimScenario`:

```ts
/** Adapter auto-sleep: after this idle gap the next non-empty command is swallowed (the byte only
 *  wakes the chip); a bare `\r` is answered with `\r>`. Mirrors ELM327 low-power behaviour. */
sleepAfterIdleMs?: number;
```

`MockTransport`: track `lastWriteAt`; in `write()`, if `sleepAfterIdleMs` elapsed → if `cmd === ''`
emit `\r>` else emit nothing (swallow), then update `lastWriteAt`. Add `dropResponses(n: number)`:
the next `n` non-AT commands get no reply at all (timeouts for the diagnostics tests). Keep
`latencyMs` as the tool for late replies (set it above the client timeout).

## Tests

- `flapGuard.test.ts`: 3 drops in 60 s → false on the 4th; drops older than the window pruned.
- `BleTransport.test.ts`: 39-byte write with `mtu 23` → two `writeCharacteristicWithoutResponseForService`
  calls of 20 + 19 bytes; `mtu 247` → one call; `linkInfo` populated after connect; iOS branch (mock
  `Platform.OS = 'ios'`) passes no `requestMTU`.
- `Elm327Client.test.ts`:
  - **late reply**: `MockTransport` with `latencyMs: 200`, client `commandTimeoutMs: 50`; first
    `command('010C')` rejects with timeout; second `command('0105')` resolves with the `41 05`
    payload, never `41 0C` (fails without the drain fix);
  - **drain deadline**: `dropResponses(1)` then a normal command — the second command completes
    within `timeout + DRAIN_GRACE_MS`;
  - **wake**: scenario `sleepAfterIdleMs: 10`, client `wakeAfterIdleMs: 5`; `init()`, wait 20 ms,
    `command('010C')` succeeds and the tx log shows a bare `\r` before `010C`; with
    `wakeAfterIdleMs: 0` the same sequence times out (proves the simulator swallows).
- `diagnoseFailure.test.ts`: one case per rule, plus the fallback.
- `DiagnosticSession.test.ts`: unchanged.

## Docs

- `docs/features/connection.md`: auto-reconnect default + flap guard; MTU/chunking; sleep/wake;
  drain-until-prompt; the diagnostics panel (stages, rules); `linkStore`.
- `docs/obd2-reference.md` § ELM327: a short "Low power / auto-sleep" note.
- `docs/simulator.md`: `sleepAfterIdleMs`, `dropResponses`.
- `docs/features/settings.md`: auto-reconnect copy.

## Acceptance

- [ ] Simulator connected → Settings → simulate a drop (add a Developer-section button that calls
      `(rawTransport as MockTransport).simulateDisconnect()`; expose the raw transport via a
      `connectionService.__sim` dev hook or keep the existing test path) → reconnects automatically
      without touching the toggle; after three drops in a minute it stops with the pause message.
- [ ] A coding write of 16 bytes in the Golf simulator succeeds through a BLE fake with `mtu 23`
      (unit test) — no behaviour change for the simulator path.
- [ ] Late-reply and wake unit tests fail when the client changes are reverted.
- [ ] Forcing a failure (Settings → Developer → "Fail next connect: no reply to ATZ", implemented
      via `dropResponses` on an AT command — extend the sim control to AT when a flag is set) opens
      the diagnostics panel with stage `init` and the unpowered/asleep suggestion.
- [ ] `npm run ci` green.

## Out of scope

Wi-Fi and classic Bluetooth transports (plans 26, 27); background reconnect while the app is
suspended (`isBackgroundEnabled` stays false).

## Deferred until an on-car session

- Confirm the Vgate's actual sleep delay and whether a bare `\r` wakes it (adjust
  `wakeAfterIdleMs`; record in `docs/adapter-vgate-icar-pro.md`).
- Read the negotiated MTU on the owner's phones (Android + iOS) from the diagnostics panel and
  record it in the adapter doc.
- Walk out of range mid-poll and confirm one reconnect cycle, then the flap guard after repeated
  drops.
