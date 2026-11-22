# Plan 27 — Classic Bluetooth (SPP) transport, Android

**Size:** M–L (1½ days) · **Depends on:** plan 26 (test bridge, `linkStore.kind`, diagnostics
rule shape) · **Roadmap:** v0.7 "Classic Bluetooth SPP (Android)"

## Goal

The large population of cheap "Bluetooth 3.0" ELM327 adapters (Serial Port Profile) works on
Android through an `SppTransport` behind the same `Transport` interface, with a bonded-device
picker and a one-tap jump to system pairing. iOS is explicitly unsupported and the option is hidden
there.

## Why

`react-native-ble-plx` cannot reach SPP adapters at all (`docs/features/connection.md`
"Troubleshooting" already tells users so). Today the only answer is "buy a BLE adapter".

## Read first

- Everything in plan 26's **Read first**, plus `src/shared/transports/ble/permissions.ts`
  (`requestBlePermissions` requests `BLUETOOTH_SCAN` + `BLUETOOTH_CONNECT` on API 31+),
  `src/shared/transports/ble/manager.ts` (`looksLikeAdapter`, `ADAPTER_NAME_HINTS`),
  `src/features/connection/model/scanStore.ts` (`ScannedDevice`), `ui/DeviceRow.tsx`.
- `src/features/can-sniffer/hooks/useSniffer.ts` and `Elm327Client.startMonitor` (the `ATMA`
  limitation below).
- `app.json` `android.permissions`.

## Design

### Library evaluation

`react-native-bluetooth-classic` (kenjdavidson; Android RFCOMM/SPP, iOS only via MFi External
Accessory). Verify against its README before coding — assumed surface:

```ts
import RNBluetoothClassic, { BluetoothDevice } from 'react-native-bluetooth-classic';
await RNBluetoothClassic.isBluetoothEnabled();
const bonded: BluetoothDevice[] = await RNBluetoothClassic.getBondedDevices();
const device = await RNBluetoothClassic.connectToDevice(address, { delimiter: '>', charset: 'ascii' });
const sub = device.onDataReceived(({ data }) => …);   // one event per delimiter-terminated message
await device.write('010C\r');  await device.disconnect();
RNBluetoothClassic.onDeviceDisconnected((e) => …);
```

Key constraint: the library delivers data **per delimiter**. The ELM327 terminates every response
with the prompt `>`, so connect with `delimiter: '>'` and re-append `'>'` to each received message
before emitting it to the ELM client (which looks for the prompt). Consequence: monitor mode
(`ATMA`, lines end with `\r` and no prompt until interrupted) cannot stream over this transport in
v1 — see capabilities below. If the README shows a raw/undelimited read mode, prefer it and drop
the limitation.

### `Transport` capabilities (small, backwards-compatible interface addition)

`src/shared/obd-core/transport/Transport.ts`:

```ts
export interface TransportCapabilities { monitor: boolean }   // can stream ATMA lines
export interface Transport {
  …existing…
  /** Optional; absent means { monitor: true }. */
  readonly capabilities?: TransportCapabilities;
}
```

`DiagnosticSession.startSniffer()` throws `new Error('Bus monitoring is not available over this
adapter link')` when `transport.capabilities?.monitor === false`; `SnifferScreen` shows that
message instead of the Start button (read via a `sessionStore` → `session.canMonitor` getter).

### `src/shared/transports/spp/SppTransport.ts`

```ts
export interface SppDeviceLike {
  write(data: string): Promise<boolean>;
  onDataReceived(cb: (ev: { data: string }) => void): { remove(): void };
  disconnect(): Promise<boolean>;
}
export interface SppModuleLike {
  connectToDevice(address: string, opts: { delimiter: string; charset: string }): Promise<SppDeviceLike>;
  onDeviceDisconnected(cb: (ev: { device?: { address?: string } }) => void): { remove(): void };
  getBondedDevices(): Promise<{ address: string; name?: string }[]>;
  isBluetoothEnabled(): Promise<boolean>;
}
export class SppTransport implements Transport {
  readonly capabilities = { monitor: false };
  constructor(private address: string, private loadModule: () => Promise<SppModuleLike> = defaultSppModule) {}
  connect(): Promise<void>;        // connectToDevice(address, { delimiter: '>', charset: 'ascii' }); subscribe data + disconnect
  disconnect(): Promise<void>;
  write(bytes: Uint8Array): Promise<void>;   // device.write(bytesToString(bytes))
  onData / onStatusChange as BleTransport
}
export async function listBondedAdapters(load = defaultSppModule): Promise<ScannedDevice[]>;  // name hints via looksLikeAdapter → isLikelyAdapter
```

`defaultSppModule` loads `react-native-bluetooth-classic` through a variable specifier and throws
"Classic Bluetooth is not available in this build" when absent (web, iOS, tests).

### Settings and connection flow

- `AdapterSource` adds `'spp'`. The Settings segment appears **only when `Platform.OS ===
'android'`**; on iOS the stored value `'spp'` falls back to `'ble'` at hydration (a `merge`
  rule) with a one-time info toast.
- `ConnectionScreen` SPP branch: **Paired adapters** list from `listBondedAdapters()` rendered
  with `DeviceRow`; empty state "Pair the adapter first: Android Settings → Bluetooth → pair
  `OBDII` (PIN 1234 or 0000), then come back" with a button **Open Bluetooth settings**
  (`Linking.sendIntent('android.settings.BLUETOOTH_SETTINGS')`); a **Refresh** button. Permission:
  call the existing `requestBlePermissions()` (CONNECT is what RFCOMM needs on API 31+; on older
  Android the library's manifest adds `BLUETOOTH`/`BLUETOOTH_ADMIN`). No scanning — bonded only.
- `connectionService.connectInternal`: `else if (adapterSource === 'spp') { rawTransport = new
SppTransport(target.deviceId); device = { id: target.deviceId, name: target.deviceName ?? 'Classic
Bluetooth adapter' }; }` — `ConnectTarget` is reused, so auto-reconnect works unchanged.
- `linkStore.kind` adds `'spp'`; diagnostics rule: /socket|read failed|connection refused/i on an
  SPP link → "The adapter is paired but not reachable — power-cycle it and make sure no other app
  (e.g. Torque) holds the connection".
- `app.json`: `android.permissions` already lists `BLUETOOTH_CONNECT`; nothing to add.

## Steps

1. `Transport.capabilities` + session/sniffer guard + tests.
2. `npx expo install react-native-bluetooth-classic`; confirm the API; `defaultSppModule`.
3. `SppTransport.ts` + test (fake module); `listBondedAdapters`.
4. Settings source (Android-only segment, iOS fallback merge); `ConnectionScreen` SPP branch.
5. `connectionService` branch; `linkStore.kind`; diagnostics rule.
6. Docs; `npm run ci`.

## Simulator

The test bridge from plan 26 plays the adapter: a fake `SppDeviceLike` whose `write` forwards to
the bridged `MockTransport` and whose `onDataReceived` re-chunks the mock's output **by `>`** (to
mimic the library's delimiter behaviour, stripping the delimiter like the library does). This
exercises the "re-append the prompt" logic end to end.

## Tests

- `SppTransport.test.ts`: connect → status `connected`; device data `'41 0C 0C D0\r\r'` (delimiter
  stripped) is emitted as `…\r\r>`; `onDeviceDisconnected` for this address → `disconnected` once
  (other addresses ignored); manual disconnect calls `device.disconnect()`; `capabilities.monitor
=== false`; `listBondedAdapters` flags `OBDII` as likely.
- `SppTransport.session.integration.test.ts`: `DiagnosticSession` over the bridged fake → connect,
  identify, `readDtcs`; `startSniffer()` rejects with the capability message.
- `MockTransport` / `BleTransport`: `capabilities` undefined → monitoring allowed (existing sniffer
  integration test still green).

## Docs

- `docs/features/connection.md`: "Classic Bluetooth (Android)" section — pairing, bonded list,
  limitations (no sniffer, no iOS and why: Apple requires MFi for SPP accessories; ELM327 clones are
  not MFi-certified so no App Store app can open them).
- `docs/features/can-sniffer.md`: capability note.
- `docs/architecture.md`: `SppTransport`, `capabilities`.
- `docs/adapter-vgate-icar-pro.md`: clarify BLE vs classic variants of common adapters.

## Acceptance

- [ ] On an Android dev build without a paired adapter, the SPP branch shows the pairing guidance
      and opens system Bluetooth settings.
- [ ] On iOS the segment is absent and a stored `'spp'` source falls back to Bluetooth LE.
- [ ] Integration test proves identify + DTC read through the delimiter-chunked fake.
- [ ] Sniffer screen explains unavailability over SPP instead of failing.
- [ ] `npm run ci` green.

## Out of scope

iOS classic Bluetooth; discovery/scanning of unpaired SPP devices; `ATMA` streaming over SPP.

## Appendix — USB OTG serial (optional stretch)

A wired ELM327 (USB, FTDI/CH340/CP210x) on Android via OTG: `react-native-usb-serialport-for-android`
(verify; Expo dev-client, autolinks) behind a `UsbSerialTransport` with the same shape as
`SppTransport` (open device → set 38400 8N1 → read/write). Needs `android.hardware.usb.host`
`<uses-feature>` and a `USB_DEVICE_ATTACHED` intent filter via a small config plugin. Bench use
only; do not schedule before an owner asks for it.

## Deferred until an on-car session

- Pair and connect a real SPP adapter on the owner's Android phone; record name, PIN, `ATI`,
  grade (plan 29).
- Confirm whether the library offers an undelimited read mode on the installed version; if yes,
  enable `ATMA` over SPP and flip `capabilities.monitor`.
