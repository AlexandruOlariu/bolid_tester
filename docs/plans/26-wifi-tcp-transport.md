# Plan 26 — Wi-Fi ELM327 transport (TCP)

**Size:** M (1 day) · **Depends on:** plan 12 (shares the diagnostics panel and `linkStore`) ·
**Roadmap:** v0.7 "Wi-Fi ELM327"

## Goal

Wi-Fi ELM327 adapters (the `WiFi_OBDII` class, default `192.168.0.10:35000`) work through a
`TcpTransport` that implements the existing `Transport` interface, selectable in Settings as a third
adapter source, with the whole stack (ELM client, session, every feature) unchanged above it.

## Why

`Transport` (`src/shared/obd-core/transport/Transport.ts`) is a byte pipe with status events; only
BLE and the simulator implement it. Wi-Fi adapters are common, work on iOS without MFi, and need
no Bluetooth permissions.

## Read first

- `src/shared/obd-core/transport/Transport.ts`, `MockTransport.ts` (`SimScenario`, `write`,
  `onData`), `logReplay.ts` (`ReplayTransport` — the smallest `Transport` implementation to copy).
- `src/shared/transports/ble/BleTransport.ts` (status transitions, `connectSeq` guard, teardown).
- `src/features/connection/api/connectionService.ts` (`connectInternal` adapter-source branch,
  `withLog`, `ConnectTarget`), `hooks/useConnect.ts`, `hooks/useBluetoothState.ts` (`enabled`
  argument), `ui/ConnectionScreen.tsx` (mock vs BLE branches), `styles/connection.styles.ts`.
- `src/shared/state/settingsStore.ts` (`AdapterSource`, defaults, `migrateSettings` from plan 01),
  `src/features/settings/ui/SettingsScreen.tsx` ("Adapter source" segment).
- `app.json` (`ios.infoPlist`), `docs/features/connection.md`, `docs/features/settings.md`.

## Design

### Library

`react-native-tcp-socket` (npm; verify the current major — 6.x at the time of writing — and that it
autolinks under Expo SDK 56 dev clients with no config plugin). Assumed API, to be confirmed against
its README before coding:

```ts
import TcpSocket from 'react-native-tcp-socket';
const socket = TcpSocket.createConnection({ host, port, timeout }, onConnect);
socket.on('data', (d: Buffer | string) => …); socket.on('error', (e) => …); socket.on('close', () => …);
socket.write(buffer); socket.destroy();
```

If the API differs, adapt only `defaultSocketFactory` below — the transport is written against an
injected interface.

### `src/shared/transports/tcp/TcpTransport.ts`

```ts
export interface TcpSocketLike {
  write(data: Uint8Array): void;
  destroy(): void;
  on(event: 'connect', cb: () => void): void;
  on(event: 'data', cb: (chunk: Uint8Array | string) => void): void;
  on(event: 'error', cb: (e: Error) => void): void;
  on(event: 'close', cb: () => void): void;
}
export interface TcpEndpoint {
  host: string;
  port: number;
}
export type TcpSocketFactory = (
  ep: TcpEndpoint,
  connectTimeoutMs: number,
) => Promise<TcpSocketLike>;

export class TcpTransport implements Transport {
  status: TransportStatus = 'disconnected';
  constructor(
    private endpoint: TcpEndpoint,
    private factory: TcpSocketFactory = defaultSocketFactory,
    private connectTimeoutMs = 5000,
  ) {}
  connect(): Promise<void>; // resolves on 'connect'; rejects on 'error' or timeout; status transitions like BleTransport
  disconnect(): Promise<void>; // destroy() + status 'disconnected' (no 'error' emission on a manual close)
  write(bytes: Uint8Array): Promise<void>;
  onData(listener): () => void; // string chunks are converted with stringToBytes; Buffers via Uint8Array.from
  onStatusChange(listener): () => void;
}
/** Loads react-native-tcp-socket through a variable specifier (tolerant import, same idiom as shared/notify). Throws a friendly error when the module is absent. */
export const defaultSocketFactory: TcpSocketFactory;
```

Unsolicited `'close'`/`'error'` after connect → `setStatus('disconnected' | 'error')` so
`connectionService.watchStatus` handles it exactly as a BLE drop (auto-reconnect included).

`src/shared/transports/tcp/endpoint.ts` (pure): `parseEndpoint('192.168.0.10:35000'): TcpEndpoint |
null` (IPv4 or hostname, port 1–65535), `DEFAULT_WIFI_ENDPOINT = { host: '192.168.0.10', port: 35000 }`,
`formatEndpoint(ep)`.

### Settings

`AdapterSource = 'mock' | 'ble' | 'wifi'`; new `wifi: { host: string; port: number }` with
`DEFAULT_WIFI_ENDPOINT`; `setWifi(patch)`. Add to `migrateSettings` (bump version by one): `wifi:
p.wifi ?? DEFAULT_WIFI_ENDPOINT`. Settings "Adapter source" gains a third segment **Wi-Fi**; below
it, when selected, host and port `Input`s with validation text from `parseEndpoint`.

### Connection flow

- `connectionService.connectInternal`: `else if (adapterSource === 'wifi') { rawTransport = new
TcpTransport(wifi); device = { id: formatEndpoint(wifi), name: 'Wi-Fi ELM327' }; }`. No
  permission request. `lastTarget` stays `undefined` (the endpoint comes from settings, so
  auto-reconnect replays it naturally).
- `ConnectionScreen`: third branch: a `Panel` "Join the adapter's Wi-Fi network first (usually
  `WiFi_OBDII`, no password). On Android, if the phone warns the network has no internet, choose
  _Stay connected_." plus host/port summary, **Connect** button; `useBluetoothState(adapterSource ===
'ble')` so no `BleManager` is created.
- `linkStore` (plan 12) gets a `kind: 'ble' | 'wifi'` field; the diagnostics classifier adds a
  `transport` rule for /ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH/ → "Phone is not on the adapter's Wi-Fi
  network, or the adapter uses a different address" with suggestions (join network, check
  `192.168.0.10:35000`, disable mobile data).
- `app.json` → `ios.infoPlist.NSLocalNetworkUsageDescription`: "Bolid Tester connects to a Wi-Fi
  OBD2 adapter on your local network." (iOS 14+ prompts on first local-network access.)

### Test bridge (shared, reused by plans 27 and 28)

`src/shared/obd-core/transport/testing/bridge.ts` (not exported from the core barrel):

```ts
/** Drive any fake socket/device from a MockTransport so a new Transport can be integration-tested through DiagnosticSession with no hardware. */
export function bridgeToMock(scenario: SimScenario): {
  write(bytes: Uint8Array): void;
  onData(cb: (b: Uint8Array) => void): () => void;
  mock: MockTransport;
};
```

## Steps

1. `npx expo install react-native-tcp-socket`; confirm the API; write `defaultSocketFactory`.
2. `endpoint.ts` + test; `TcpTransport.ts` + test.
3. `settingsStore` source/endpoint + migration; Settings UI.
4. `connectionService` branch; `ConnectionScreen` branch; `useBluetoothState` gating; diagnostics
   rule; `linkStore.kind`.
5. `app.json` iOS string; docs; `npm run ci`.

## Simulator

No protocol change. For an end-to-end check without hardware, the test bridge above plays the
adapter: `fakeSocketFactory = async () => socketOverBridge(bridgeToMock(buildScenario('golf-plus-2009-20tdi')))`.

## Tests

- `endpoint.test.ts`: valid/invalid hosts and ports; default.
- `TcpTransport.test.ts` (fake factory): connect resolves and status is `connected`; connect error
  rejects with status `error`; connect timeout rejects; `write` forwards bytes; string `'data'`
  chunks are converted; unsolicited `'close'` emits `disconnected` once; manual `disconnect()`
  calls `destroy()` and emits no `error`.
- `TcpTransport.session.integration.test.ts`: `DiagnosticSession` over `TcpTransport` with the
  bridged Golf scenario → `connect()` returns protocol `ISO_15765_4_CAN_11_500`, the VIN and 16
  PIDs; `readDtcs('03')` works.
- `settingsStore.test.ts`: migration fills `wifi`.

## Docs

- `docs/features/connection.md`: Wi-Fi section (library, endpoint, Android no-internet prompt, iOS
  local-network permission).
- `docs/features/settings.md`: Wi-Fi fields.
- `docs/architecture.md`: `TcpTransport` in the transport diagram.

## Acceptance

- [ ] Settings → Wi-Fi → Connect with no adapter reachable fails within 5 s and the diagnostics
      panel shows the network suggestion.
- [ ] Integration test passes; `TcpTransport.test.ts` covers every status transition.
- [ ] Switching source between Simulator / Bluetooth / Wi-Fi never constructs a `BleManager` unless
      Bluetooth is selected.
- [ ] `npm run ci` green; `npm run typecheck:app` green with the new dependency.

## Out of scope

Discovering the adapter's address automatically (mDNS/UDP broadcast); Wi-Fi networks that require
a password; classic Bluetooth (plan 27).

## Deferred until an on-car session

- Connect to a real Wi-Fi ELM327 on Android and iOS; record which adapter, its endpoint, the
  observed `ATI` string and the latency grade in `docs/adapters/` (plan 29).
- Confirm the Android "no internet" behaviour on the owner's phone and whether mobile data must be
  off; adjust the Connect-screen copy.
