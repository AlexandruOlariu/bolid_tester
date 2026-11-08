# Plan 28 — Web Bluetooth PWA

**Size:** L (2–3 days) · **Depends on:** plan 12 (`linkStore`, diagnostics), plan 26 (test bridge)
· **Roadmap:** v0.7 "Web Bluetooth PWA"

## Goal

The app runs in Chrome (desktop and Android) from a static site, connects to the Vgate over
**Web Bluetooth** through a `WebBluetoothTransport` that mirrors `BleTransport`'s UUID-agnostic
discovery, persists state in the browser, and degrades every native-only feature explicitly rather
than crashing. Deployed to GitHub Pages by CI on every push to `main`.

## Why

`Transport.ts` promised Web Bluetooth from day one; the improvement plan deferred it (6.9). A
zero-install demo is the cheapest way to show the simulator and the engine to anyone, and Android
Chrome supports Web Bluetooth for real adapters.

## Read first

- `src/shared/transports/ble/BleTransport.ts` (`selectCharacteristics`, status transitions) and
  `manager.ts` (`OBD_SERVICE_UUIDS`, `looksLikeAdapter`).
- `src/shared/state/persistStorage.ts` — **`DIR` is `''` on web, so every persisted store is a
  silent no-op there**; this plan adds a `localStorage` backend.
- `src/shared/state/secureApiKey.ts`, `src/shared/notify/index.ts`, `src/features/more/api/updates.ts`
  (the tolerant-import idiom), `src/features/connection/hooks/{useBluetoothState,useScan}.ts`
  (static `import { State } from 'react-native-ble-plx'`), `ui/ConnectionScreen.tsx`.
- Every export hook (`grep -rln "expo-sharing" src`): `useAdapterHealth`, `useCarBackup`,
  `useErrorLogExport`, `useMeasuringLog`, `useDtcExport`, `useChartExport`, `useScanShare`,
  `useLogFixtureExport`, `useTripRecorder`.
- `app.json`, `metro.config.js`, `babel.config.js`, `.gitignore` (`web-build/` is already ignored;
  `dist/` is ignored too and holds a local APK — do **not** export web into `dist/`).
- `.github/workflows/ci.yml`.

## Design

### `src/shared/transports/web-ble/WebBluetoothTransport.ts`

Written against a narrow interface so tests inject a fake:

```ts
export interface WebBtCharacteristic {
  uuid: string;
  properties: { notify: boolean; indicate: boolean; write: boolean; writeWithoutResponse: boolean };
  startNotifications(): Promise<unknown>;
  addEventListener(type: 'characteristicvaluechanged', cb: (ev: { target: { value: DataView } }) => void): void;
  removeEventListener(type: 'characteristicvaluechanged', cb: (ev: unknown) => void): void;
  writeValueWithoutResponse?(data: BufferSource): Promise<void>;
  writeValueWithResponse?(data: BufferSource): Promise<void>;
  writeValue(data: BufferSource): Promise<void>;
}
export interface WebBtService { uuid: string; getCharacteristics(): Promise<WebBtCharacteristic[]> }
export interface WebBtServer { connected: boolean; connect(): Promise<WebBtServer>; disconnect(): void; getPrimaryServices(): Promise<WebBtService[]> }
export interface WebBtDevice { id: string; name?: string; gatt?: WebBtServer; addEventListener(type: 'gattserverdisconnected', cb: () => void): void; removeEventListener(type: 'gattserverdisconnected', cb: () => void): void }
export interface WebBluetoothLike { requestDevice(opts: { acceptAllDevices?: boolean; filters?: unknown[]; optionalServices?: string[] }): Promise<WebBtDevice> }

export class WebBluetoothTransport implements Transport {
  /** Must be called from a user gesture (Chrome requirement) — the Connect button handler. */
  static pickDevice(bt: WebBluetoothLike = navigator.bluetooth as unknown as WebBluetoothLike): Promise<WebBtDevice>;  // acceptAllDevices + optionalServices: OBD_SERVICE_UUIDS
  constructor(private device: WebBtDevice) {}
  connect(): Promise<void>;          // gatt.connect → getPrimaryServices → first service with notify+write → startNotifications → status
  disconnect(): Promise<void>;
  write(bytes: Uint8Array): Promise<void>;   // 20-byte chunks (no MTU API on the web); writeValueWithoutResponse ?? writeValue
  onData / onStatusChange;          // 'gattserverdisconnected' → 'disconnected'
  get linkInfo(): BleLinkInfo | null;         // mtu: 23, payload: 20, uuids
}
export const isWebBluetoothAvailable = () => typeof navigator !== 'undefined' && !!(navigator as { bluetooth?: unknown }).bluetooth;
```

`OBD_SERVICE_UUIDS` move to `src/shared/transports/common/obdServiceUuids.ts` (re-exported from
`ble/manager.ts`) so the web transport does not import `react-native-ble-plx`.

### Web platform gating

- `src/shared/transports/ble/manager.ts`: `getBleManager()` throws
  `new Error('Bluetooth LE via react-native-ble-plx is not available on web')` when `Platform.OS
=== 'web'`; `useBluetoothState` already catches and reports `unsupported`. `useScan`/
  `useBluetoothState` import `State` as a value from ble-plx — keep (it is plain JS), but call
  `useBluetoothState(enabled && Platform.OS !== 'web')`.
- `connectionService.connectInternal`, `adapterSource === 'ble'` on web: `const device = await
WebBluetoothTransport.pickDevice()` must happen in the button handler, so `useConnect.connect()`
  gains an optional pre-step: on web it calls `pickDevice()` first and passes the device through
  `ConnectTarget` (`{ deviceId: device.id, deviceName: device.name, webDevice?: WebBtDevice }`).
- `ConnectionScreen` on web: no scan list, no MAC entry; one button **Choose adapter & connect**
  and a note "Works in Chrome / Edge on desktop and Android over HTTPS; not in Safari or iOS."
  When `!isWebBluetoothAvailable()` show that note as a blocking panel and keep the simulator path.

### Persistence on web

`persistStorage.ts`: when `Platform.OS === 'web'` (or `DIR === ''` and `globalThis.localStorage`
exists) use a `localStorage`-backed `StateStorage` (`getItem`/`setItem`/`removeItem` with the same
`bolid.<name>` keys, try/catch → `logPersistFailure`). Keep the file backend for native. Test with
a fake `localStorage` in node.

### Native-only features on web — the matrix

| Capability                       | Native                | Web behaviour                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BLE (ble-plx)                    | ✓                     | Replaced by `WebBluetoothTransport`; `useBluetoothState` → `unsupported` never shown because `enabled=false`                                                                                                                                                                                                                                                                 |
| Persistence (`expo-file-system`) | file                  | `localStorage` backend                                                                                                                                                                                                                                                                                                                                                       |
| Exports / share sheets (9 hooks) | file + `expo-sharing` | New `src/shared/lib/saveFile.ts` — `saveTextFile(name, body, mime)`: on web create a `Blob`, `URL.createObjectURL`, click a temporary `<a download>`; on native keep file + share. Migrate `useErrorLogExport`, `useDtcExport`, `useLogFixtureExport`, `useAdapterHealth.share`, `useScanShare` in this plan; the other four fall back to a "Not available on web yet" toast |
| Secure store                     | keystore              | In-memory only (existing degradation) — show a one-line note under the AI key field on web                                                                                                                                                                                                                                                                                   |
| Notifications / haptics          | ✓                     | No-ops (existing tolerant wrappers)                                                                                                                                                                                                                                                                                                                                          |
| Location (trips GPS)             | ✓                     | Works via browser geolocation; verify `expo-location` web support, else disable the GPS toggle on web                                                                                                                                                                                                                                                                        |
| OTA updates                      | ✓                     | `unavailable` (existing)                                                                                                                                                                                                                                                                                                                                                     |
| Sniffer (`ATMA`)                 | ✓                     | ✓ (notifications stream)                                                                                                                                                                                                                                                                                                                                                     |

### Expo web target

- `npx expo install react-native-web react-dom @expo/metro-runtime` (`react-dom@19.2.3` is already a
  devDependency; move it to `dependencies`).
- `app.json`: `"web": { "bundler": "metro", "output": "single", "favicon": "./assets/icon.png" }`
  and `"experiments": { "baseUrl": "/bolid_tester" }` for GitHub project pages (the repo is
  `AlexandruOlariu/bolid_tester`). `single` keeps expo-router's client-side routing working on a
  static host without 404 rewrites.
- Build: `npx expo export --platform web --output-dir web-build` (never `dist/`).
- Tamagui on web is supported; `@tamagui/babel-plugin` already targets `tamagui`. `react-native-svg`
  (gauges) renders on web.
- `installGlobalErrorHandlers()` already chains web `unhandledrejection`.

### Deployment (`.github/workflows/web.yml`)

On push to `main` and `workflow_dispatch`: checkout, `setup-node@v5` (node 24, npm cache),
`npm install --legacy-peer-deps --ignore-scripts --no-audit --no-fund`, `npx expo export --platform
web --output-dir web-build`, `touch web-build/.nojekyll`, `actions/upload-pages-artifact@v3` with
`path: web-build`, then `actions/deploy-pages@v4` in a `deploy` job (`permissions: pages: write,
id-token: write`, `environment: github-pages`). Owner enables Pages → Source: GitHub Actions.
Web Bluetooth requires HTTPS — GitHub Pages provides it.

## Steps

1. `persistStorage` web backend + test.
2. `obdServiceUuids.ts`; `WebBluetoothTransport.ts` + tests; `isWebBluetoothAvailable`.
3. Web gating in `manager.ts`, `useBluetoothState` calls, `useConnect` pre-step, `ConnectTarget`
   extension, `connectionService` web branch, `ConnectionScreen` web UI.
4. `saveFile.ts` + migrate the five export hooks; web-fallback toast for the rest.
5. Expo web deps + `app.json`; run `npx expo export --platform web --output-dir web-build` locally
   and open `web-build/index.html` via `npx serve web-build` (simulator must work end to end).
6. `web.yml`; docs; `npm run ci`.

## Simulator

The simulator is the primary web experience (no adapter needed). Verify Settings → Simulator →
Connect → Live/Faults/Charts in Chrome. The test bridge (plan 26) provides the fake GATT for unit
tests: a fake `WebBtCharacteristic` whose `writeValue` forwards to the bridged `MockTransport` and
whose `characteristicvaluechanged` events carry the mock's output in 20-byte `DataView`s.

## Tests

- `WebBluetoothTransport.test.ts` (fake `WebBluetoothLike`): picks the first service with
  notify+write; starts notifications; emits bytes from `DataView`s; chunks a 39-byte write into
  20 + 19 `writeValueWithoutResponse` calls (falls back to `writeValue` when absent);
  `gattserverdisconnected` → `disconnected` once; `connect()` with no suitable service rejects and
  calls `gatt.disconnect()`.
- `WebBluetoothTransport.session.integration.test.ts`: `DiagnosticSession` over the bridged fake →
  identify + DTC read.
- `persistStorage.test.ts`: web backend round-trip with a fake `localStorage`; failure → logged.
- `saveFile.test.ts`: web path creates and revokes an object URL (fake `document`/`URL`).

## Docs

- New `docs/web.md`: how to run (`npx expo start --web`), build, deploy, the capability matrix,
  browser support (Chrome/Edge desktop + Android; HTTPS; user-gesture rule), Pages setup.
- `docs/features/connection.md`: Web Bluetooth section; `docs/architecture.md`: the web transport
  in the diagram (the "future" note becomes current); `docs/phase2-mobile-app.md`: web target.
- Root `README.md`: "Try it in the browser" link once Pages is live.

## Acceptance

- [ ] `npx expo export --platform web --output-dir web-build` succeeds; the simulator flow works in
      Chrome from the exported bundle; settings survive a reload (localStorage).
- [ ] In Chrome on Android (HTTPS), **Choose adapter & connect** opens the browser device chooser;
      with no adapter, cancelling shows a clean error, not a crash.
- [ ] Safari shows the "not supported here" panel and still offers the simulator.
- [ ] Error-log export downloads a `.md` file in the browser.
- [ ] `web.yml` deploys on push to `main`; the Pages URL loads under `/bolid_tester/`.
- [ ] `npm run ci` green (new tests included); `typecheck:app` passes with `react-native-web`.

## Out of scope

Offline PWA install (service worker / manifest) — a follow-up once the static site exists; Web
Serial for USB adapters; iOS Safari (no Web Bluetooth).

## Deferred until an on-car session

- Connect the Vgate from Chrome on Android and from a laptop; record the chooser name, service UUID
  picked, and the latency grade in `docs/adapters/` (plan 29).
- Confirm whether 20-byte chunking is required for the Vgate on the web path or whether larger
  writes succeed; tune `payload` if an adapter-specific table is warranted.
