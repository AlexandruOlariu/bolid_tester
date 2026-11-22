# Phase 2 — Mobile App (Expo + Tamagui + BLE)

The React Native UI is built on top of the already-tested OBD2 core. It is organized as **feature
slices** (see [`architecture.md`](./architecture.md)).

## Why it isn't compiled/run in the cloud container

The RN runtime (Expo, `react-native`, `react-native-ble-plx`, Tamagui) needs a **native build**
(Android/iOS device, emulator, or EAS) and a Metro bundler — none of which run in the headless
container. So:

- The **core** (`src/shared/lib`, `src/shared/obd-core`, `src/shared/vehicles`) is typechecked,
  linted, and unit/integration-tested in the container (`npm run typecheck`, `npm test`, `npm run
lint` — all green).
- The **app** (`src/app`, `src/features`, `src/shared/ui|state|theme|transports`) is typechecked on a
  dev machine with `npm run typecheck:app` after installing the RN deps, and run with Expo.

## Run it on a dev machine

```bash
npm install                 # installs RN deps too
npx expo install --fix      # aligns native versions to the Expo SDK (recommended)
npm run typecheck:app       # full-app TypeScript check

# Dev client (BLE needs a custom dev client; Expo Go can't use react-native-ble-plx):
npx expo prebuild
npm run android             # or: npm run ios   (iOS needs a Mac/Xcode or EAS)
```

### Web target (plan 28)

The same app also builds for the browser — the simulator everywhere, and real Bluetooth LE adapters
through Web Bluetooth in Chrome / Edge. `react-native-web`, `react-dom` and `@expo/metro-runtime`
are dependencies; `app.json` sets `web.output: "single"` and `experiments.baseUrl: "/bolid_tester"`.

```bash
npx expo start --web                                      # dev server
npx expo export --platform web --output-dir web-build     # static site (never into dist/)
```

`.github/workflows/web.yml` deploys it to GitHub Pages on every push to `main`. Browser support, the
native-only capability matrix and the Pages setup are in [web.md](./web.md).

### iOS 27 and a real iPhone

Tried on 2026-10-15 with Xcode 27 and an iPhone on iOS 27. `npx expo prebuild` generates `ios/`
(not committed). Most of what that output needs is handled for you; the rest is local to your machine:

- **UIScene lifecycle (required by iOS 27): automated.** Without it the app is stopped at launch
  (`NoSceneLifecycleAdoption`). The config plugin [`plugins/ios-scene-lifecycle.js`](../plugins/ios-scene-lifecycle.js)
  (registered in `app.json`, unit-tested in `plugins/ios-scene-lifecycle.test.ts`) makes the generated
  `AppDelegate` conform to `ExpoReactNativeFactoryProvider`, removes its own window creation, adds
  `class SceneDelegate: ExpoAppSceneDelegate {}` and writes the `UIApplicationSceneManifest` into
  `Info.plist`. It is idempotent, does nothing once the Expo template adopts scenes itself, and throws
  if the template changes shape. A clean `expo prebuild` was checked to produce the same files that
  ran on the phone.
- **Personal Apple team:** free teams cannot use Push Notifications. The app only needs local
  notifications, so empty `ios/<App>/<App>.entitlements` (remove `aps-environment`), pick the team in
  Signing & Capabilities and use a bundle id of your own, because the one in `app.json` is probably
  registered to another team.
- **Xcode 27 rejects pod targets below iOS 15.** Raise them in the `Podfile` `post_install` block.
- **Node:** `expo prebuild` needs Node 20.19.4 or newer; point the build phase at it with
  `ios/.xcode.env.local` (`export NODE_BINARY=...`).
- **Release, not Debug,** for an icon launch: the Debug configuration needs the Metro server.
- **Signing over SSH fails** (`errSecInternalComponent`, locked keychain); start the build from Xcode.

For cloud builds without a Mac, use EAS (profiles in `eas.json`):

```bash
npm i -g eas-cli
eas build -p android --profile preview   # APK
eas build -p ios --profile preview       # needs an Apple account — see iOS below
```

### iOS (plan 09)

The Vgate iCar Pro is a **Bluetooth LE** adapter, so an iPhone reaches it through CoreBluetooth with
no Apple MFi certificate and no pairing in iOS Settings
([adapter-vgate-icar-pro.md](./adapter-vgate-icar-pro.md)). iOS is built only on EAS (no Mac
needed); nothing here has been run on an iPhone yet — the owner steps are at the end.

**Config (`app.json`, checked by `src/shared/lib/iosConfig.test.ts`).**

| Key                                                    | Value / why                                                                                                                      |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `ios.bundleIdentifier`                                 | `com.bolidtester.app` (same as the Android package)                                                                              |
| `ios.buildNumber`                                      | `"1"`, only the seed: `eas.json` `cli.appVersionSource: "remote"` keeps the build number on EAS, `production` auto-increments it |
| `NSBluetoothAlwaysUsageDescription` (+ `…Peripheral…`) | the Bluetooth prompt text                                                                                                        |
| `NSLocationWhenInUseUsageDescription`                  | "Bolid Tester records a GPS track alongside OBD2 data while you record a trip." (when-in-use only)                               |
| `NSLocalNetworkUsageDescription`                       | the Local Network prompt for a Wi-Fi adapter (plan 26)                                                                           |
| `ITSAppUsesNonExemptEncryption: false`                 | only the OS HTTPS stack is used (exempt), so TestFlight skips the export-compliance question                                     |
| plugin `expo-location`                                 | the same when-in-use text; the Always and motion strings set to `false` so prebuild writes none; no background location          |
| plugin `expo-notifications`                            | `color: "#2bb673"`; local notifications only (no push server)                                                                    |
| plugin `react-native-ble-plx`                          | `isBackgroundEnabled: false`: no `bluetooth-central` background mode for App Review to question                                  |

**EAS profiles (`eas.json`).** `development` (dev client) and `preview` are internal distribution
builds for real devices (`ios.simulator: false`); `production` is the TestFlight / App Store build
(`autoIncrement`, channel `production`). Credentials: let EAS manage the distribution certificate
and the provisioning profiles (answer yes when `eas build` asks, or run `eas credentials`).

```bash
eas login                                   # the owner's Expo account (plan 08 created the project)
eas device:create                           # internal builds only: scan the QR code on the iPhone
eas build -p ios --profile preview          # install from the link EAS prints
eas build -p ios --profile production       # TestFlight / App Store build
eas submit -p ios --latest                  # upload to App Store Connect (creates the app record if asked)
```

TestFlight: in App Store Connect add an external group "Bolid testers" and attach the processed
build (the first external build goes through Beta App Review).

**Platform differences the code handles (plan 09 code checks).**

1. Connect screen: **Connect by address** is Android-only (iOS exposes CoreBluetooth UUIDs, not
   MACs); on iOS the device list shows "If the adapter is not listed, turn it off and on; iOS does
   not pair OBD2 BLE adapters in Settings." Classic Bluetooth (SPP) is hidden on iOS (plan 27).
2. A denied Bluetooth prompt arrives as ble-plx `State.Unauthorized`: the banner reads "Allow
   Bluetooth for Bolid Tester in Settings" with **Open settings** (`Linking.openSettings()`), and a
   scan started in that state says the same instead of "Bluetooth is off". iOS has no API to turn
   the radio on, so there is no **Turn on Bluetooth** button; the banner points to Control Center.
3. `requestBlePermissions()` (and the Classic Bluetooth pair) resolve `true` at once on iOS and
   never touch `PermissionsAndroid`; the OS prompts on first CoreBluetooth use.
4. `BleTransport` passes `requestMTU: 247` on Android only; iOS negotiates the MTU itself and the
   negotiated value is read back from `device.mtu`.
5. Fonts: Tamagui's `$mono` token ships a CSS fallback stack that iOS cannot resolve; it is
   overridden per platform (`Menlo` on iOS, `monospace` on Android, the stack on web;
   `src/shared/ui/monoFont.ts`).
6. Safe areas: `Screen` uses `edges={['bottom']}` and every tab, hidden routes included, has
   `headerShown: true`, so the navigator header covers the notch / Dynamic Island.
7. Notifications: iOS shows its permission prompt once. More → Notifications reads the live state
   on open, prompts at most once, and after a denial offers **Open settings** instead of a dead
   **Enable** button.
8. Sharing: every export writes to `documentDirectory` and opens `expo-sharing`, which is the iOS
   share sheet (the web build downloads instead, plan 28).

**Validation checklist (owner, on an iPhone; plan 09 § Deferred).**

- [ ] Simulator mode: open every tab and three hidden routes (e.g. Trips, Error log, Vehicle
      report); export the error log and check the iOS share sheet opens.
- [ ] The Bluetooth prompt shows the configured text. Deny it once: the Connect banner offers
      **Open settings** and a scan reports a permission problem; allow it in Settings and scan.
- [ ] Real adapter: Connect → **Scan for adapters** → the Vgate appears (`IOS-Vlink` / `Vlink`) →
      Connected → **Live** shows RPM on the Golf → **Faults** reads the codes.
- [ ] Record a 1-minute trip with Location allowed (the prompt shows the configured text): the
      trip has a GPS track and its CSV opens the share sheet.
- [ ] Notifications: **Enable notifications** prompts once; after a denial **Open settings** shows.
- [ ] No Android-only UI (Connect by address, classic Bluetooth, "Turn on Bluetooth") and no
      `PermissionsAndroid` / `requestMTU` entry in More → Error log.
- [ ] Settings → Adapter log → export the connect session as a replay fixture named `ios-connect`
      (plan 02) and add a row to the Golf's "Validated on the car" table with the platform in the
      App build column (e.g. `0.5.0 iOS 18`).

## Using the app

1. **Settings** → the adapter source defaults to **Real adapter (Bluetooth)**. **Simulator (no car)**
   is an explicit opt-in (no hardware needed); while it is on, an amber banner is shown on every
   screen. In simulator mode pick which example car to emulate and whether to inject DTCs (none by
   default; presets or **Custom…** codes).
2. **Connect** → connect to the simulator, or scan & pick your Vgate adapter over BLE.
3. **Vehicle** → choose a profile (or Auto / Generic).
4. **Live**, **Faults**, **Info** → live data, read/clear DTCs, VIN/protocol/adapter info. The
   **Extended PIDs** screen (from Info) shows the experimental Mode 22 reads on CAN cars.
5. **More** → every other screen: analysis and ownership tools (Tier B) and the gated manufacturer
   tier (Tier C), listed in the map below.

The **simulator path uses the exact same `DiagnosticSession`** the BLE path uses, so the whole UI is
exercisable end-to-end without a car — and is what the core integration tests cover.

## Feature ↔ code map

All 34 slices, grouped as in the [feature audit](./audit-2026-11.md#feature-inventory). Routes are
files in `src/app/` (expo-router); every hidden route is reached from **More** or **Info** (see
[more](./features/more.md#hidden-routes-and-where-they-are-reached)). Two specs carry another name
(`inspection` → `used-car-inspection`, `maintenance` → `maintenance-log`), and
[`features/tp20.md`](./features/tp20.md) documents the shared TP2.0 transport rather than a slice.
`src/shared/lib/featureDocsSync.test.ts` fails CI when a slice has no spec or a spec has no slice.

### Tier A — generic OBD2 (any car)

| Slice (`src/features/*`) | Route                                            | Spec                                                         |
| ------------------------ | ------------------------------------------------ | ------------------------------------------------------------ |
| `connection`             | `/` (Connect tab)                                | [`features/connection.md`](./features/connection.md)         |
| `vehicle-select`         | `/vehicle` (Vehicle tab)                         | [`features/vehicle-select.md`](./features/vehicle-select.md) |
| `live-data`              | `/dashboard` (Live tab; Dashboard + All sensors) | [`features/live-data.md`](./features/live-data.md)           |
| `fault-codes`            | `/faults` (Faults tab)                           | [`features/fault-codes.md`](./features/fault-codes.md)       |
| `vehicle-info`           | `/info` (Info tab)                               | [`features/vehicle-info.md`](./features/vehicle-info.md)     |
| `vin-decode`             | `/vin-decode`                                    | [`features/vin-decode.md`](./features/vin-decode.md)         |
| `extended-pids`          | `/extended` (from Info)                          | [`features/extended-pids.md`](./features/extended-pids.md)   |
| `sensor-tests`           | `/sensors`                                       | [`features/sensor-tests.md`](./features/sensor-tests.md)     |
| `settings`               | `/settings` (Settings tab)                       | [`features/settings.md`](./features/settings.md)             |
| `error-log`              | `/error-log`                                     | [`features/error-log.md`](./features/error-log.md)           |
| `more`                   | `/more` (More tab)                               | [`features/more.md`](./features/more.md)                     |
| `feedback`               | `/feedback` (More → Tools, Error log, Settings)  | [`features/feedback.md`](./features/feedback.md)             |
| `onboarding`             | — (cards on Connect and Charts)                  | [`features/onboarding.md`](./features/onboarding.md)         |
| `engine-host`            | — (headless, `_layout.tsx`)                      | [`features/engine-host.md`](./features/engine-host.md)       |

### Tier B — analysis, ownership, tooling

| Slice (`src/features/*`) | Route             | Spec                                                                   |
| ------------------------ | ----------------- | ---------------------------------------------------------------------- |
| `ai-diagnose`            | `/ai-diagnose`    | [`features/ai-diagnose.md`](./features/ai-diagnose.md)                 |
| `history`                | `/history`        | [`features/history.md`](./features/history.md)                         |
| `report`                 | `/report`         | [`features/report.md`](./features/report.md)                           |
| `backup`                 | `/backup`         | [`features/backup.md`](./features/backup.md)                           |
| `inspection`             | `/inspection`     | [`features/used-car-inspection.md`](./features/used-car-inspection.md) |
| `battery-health`         | `/battery`        | [`features/battery-health.md`](./features/battery-health.md)           |
| `dpf`                    | `/dpf`            | [`features/dpf.md`](./features/dpf.md)                                 |
| `maintenance`            | `/maintenance`    | [`features/maintenance-log.md`](./features/maintenance-log.md)         |
| `trip-recording`         | `/trips`          | [`features/trip-recording.md`](./features/trip-recording.md)           |
| `live-charts`            | `/charts`         | [`features/live-charts.md`](./features/live-charts.md)                 |
| `performance-tests`      | `/performance`    | [`features/performance-tests.md`](./features/performance-tests.md)     |
| `alerts`                 | `/alerts`         | [`features/alerts.md`](./features/alerts.md)                           |
| `notifications`          | `/notifications`  | [`features/notifications.md`](./features/notifications.md)             |
| `adapter-health`         | `/adapter-health` | [`features/adapter-health.md`](./features/adapter-health.md)           |

### Tier C — manufacturer / module access (CAN, VAG-first) 🧪

These ship gated; every non-standard address, DID and routine id is illustrative until confirmed on
a car.

| Slice (`src/features/*`) | Route            | Spec                                                       |
| ------------------------ | ---------------- | ---------------------------------------------------------- |
| `module-scan`            | `/module-scan`   | [`features/module-scan.md`](./features/module-scan.md)     |
| `adaptations`            | `/adaptations`   | [`features/adaptations.md`](./features/adaptations.md)     |
| `routines`               | `/routines`      | [`features/routines.md`](./features/routines.md)           |
| `coding`                 | `/coding`        | [`features/coding.md`](./features/coding.md)               |
| `service-reset`          | `/service-reset` | [`features/service-reset.md`](./features/service-reset.md) |
| `can-sniffer`            | `/sniffer`       | [`features/can-sniffer.md`](./features/can-sniffer.md)     |

Cross-cutting: `src/shared/transports/ble/BleTransport.ts` (runtime characteristic discovery),
`src/shared/state/*` (Zustand), `src/shared/ui/*` (Tamagui widgets + SVG gauge),
`tamagui.config.ts`, `src/app/*` (expo-router).
