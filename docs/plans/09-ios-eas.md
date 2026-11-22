# Plan 09 — iOS build via EAS

**Size:** M (1 day + Apple review latency) · **Depends on:** plan 08 (EAS project) · **Roadmap:**
v0.5 "iOS build"

## Goal

A TestFlight build of Bolid Tester that connects to the Vgate iCar Pro over BLE on an iPhone, with
every native permission string present and every Android-only UI path gracefully absent.

## Why

The plan and README promise Android **and** iOS; BLE is the reason the Vgate adapter was chosen (no
MFi needed). iOS has never been built. Several iOS-specific config items are missing today.

## Read first

- `app.json` (`ios`, `plugins`), `eas.json`, `package.json` (SDK 56, RN 0.85, `react-native-ble-plx`
  3.5, `expo-location`, `expo-notifications`, `expo-haptics`, `expo-sharing`, `expo-file-system`).
- `src/shared/transports/ble/{BleTransport.ts, manager.ts, permissions.ts}` and
  `src/features/connection/hooks/useBluetoothState.ts`, `ui/BluetoothPrompt.tsx`,
  `ui/ConnectionScreen.tsx` (`Platform.OS === 'android'` block).
- `src/features/settings/ui/SettingsScreen.tsx` (`Platform.select` font), `src/shared/ui/Screen.tsx`
  (`edges={['bottom']}`), `src/app/_layout.tsx` (header/tab colours).
- `docs/phase2-mobile-app.md` § EAS, `docs/adapter-vgate-icar-pro.md` § BLE.

## Design

### Config (`app.json`)

Add under `ios`:

```json
"infoPlist": {
  "NSBluetoothAlwaysUsageDescription": "…(present)",
  "NSBluetoothPeripheralUsageDescription": "…(present)",
  "NSLocationWhenInUseUsageDescription": "Bolid Tester records a GPS track alongside OBD2 data while you record a trip.",
  "ITSAppUsesNonExemptEncryption": false
},
"buildNumber": "1"
```

Plugins: add `["expo-location", { "locationWhenInUsePermission": "…same text…" }]` and
`["expo-notifications", { "icon": "./assets/icon.png", "color": "#2bb673" }]` if not already
implied. `react-native-ble-plx` plugin stays `isBackgroundEnabled: false`.

### EAS (`eas.json`)

```json
"preview":    { "distribution": "internal", "ios": { "simulator": false }, "channel": "preview" },
"production": { "autoIncrement": true, "channel": "production" }
```

- Internal distribution needs registered devices: `eas device:create` (owner scans a QR on the
  iPhone), then `eas build -p ios --profile preview`.
- TestFlight: `eas build -p ios --profile production` then `eas submit -p ios --latest` (needs App
  Store Connect app record; `eas submit` can create it).
- Credentials: let EAS manage certificates and provisioning (`eas credentials` if prompted).

### Code checks (do before the first build)

1. `ConnectionScreen`: the "Connect by address" panel is Android-only (correct — iOS exposes
   CoreBluetooth UUIDs, not MACs). Add an iOS hint under the device list: "If the adapter is not
   listed, turn it off and on; iOS does not pair OBD2 BLE adapters in Settings."
2. `useBluetoothState` / `BluetoothPrompt`: `react-native-ble-plx` `State.Unauthorized` is the iOS
   permission-denied state — the prompt should deep-link with `Linking.openSettings()` (works on
   both platforms).
3. `permissions.ts`: on iOS `requestBlePermissions()` must resolve `true` immediately (the OS prompts
   on first CoreBluetooth use); verify it does not call Android `PermissionsAndroid`.
4. `BleTransport` MTU: iOS negotiates MTU automatically; `requestMTU` is Android-only in ble-plx —
   guard with `Platform.OS`.
5. Fonts: `Platform.select({ ios: 'Courier', … })` fine; Tamagui `$mono` token used in the sniffer —
   verify it resolves on iOS (`tamagui.config.ts` fonts).
6. Safe areas: `Screen` uses `edges={['bottom']}`; with `headerShown: true` the top is handled by
   the navigator. Check hidden routes still get a header on iOS (expo-router Tabs: yes).
7. Haptics / notifications: `expo-notifications` local scheduling requires requesting permission on
   iOS — `useNotificationPermission` already requests; confirm the prompt appears once.
8. File sharing: `expo-sharing` on iOS presents the share sheet; `documentDirectory` paths work.

### Validation session (owner, iPhone)

Simulator mode: every tab + three hidden routes; share an error-log export. Real adapter: Connect →
Scan (Vgate appears as `IOS-Vlink`/`Vlink`) → Live on the Golf → Faults → record a 1-minute trip
with GPS permission granted → export fixture (plan 02) named `ios-connect`.

## Steps

1. `app.json` / `eas.json` edits; `npm run typecheck:app`.
2. Code checks 1–8 (small diffs; each with a note in the PR).
3. Owner: devices, `eas build -p ios --profile preview`, install, run the validation session.
4. Fix findings; `eas build … production` + `eas submit`; TestFlight external group "Bolid testers".
5. Docs: `docs/phase2-mobile-app.md` § iOS (commands, credential notes, the validation checklist);
   `docs/vehicles/golf-plus-2009-20tdi.md` "Validated on" row with platform iOS.

## Acceptance

- [ ] `eas build -p ios --profile preview` succeeds; the app installs via the internal distribution
      link.
- [ ] Bluetooth and Location permission prompts show the configured texts.
- [ ] BLE scan lists the Vgate; Connect reaches `Connected`; Live shows RPM on the Golf.
- [ ] Trip with GPS track records and exports; error-log export opens the iOS share sheet.
- [ ] TestFlight build processed; at least one external tester installed it.
- [ ] No Android-only UI visible on iOS; no crash in the error log from `PermissionsAndroid` or
      `requestMTU`.

## Deferred until a device session (owner)

Steps 3–4 and acceptance items 2–6 need an Apple Developer account and a test iPhone. The
implementing agent completes steps 1–2 (config + the eight code checks, each unit-tested or
type-checked where possible) and the docs, and leaves the EAS build command and the validation
checklist ready in `docs/phase2-mobile-app.md`.
