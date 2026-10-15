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

### iOS 27 and a real iPhone

Tried on 2026-10-15 with Xcode 27 and an iPhone on iOS 27. `npx expo prebuild` generates `ios/`
(not committed), and with Expo SDK 57 that output needs these local changes before it builds and starts:

- **UIScene lifecycle (required by iOS 27).** Without it the app is stopped at launch
  (`NoSceneLifecycleAdoption`). In `ios/<App>/AppDelegate.swift` make `AppDelegate` also conform to
  `ExpoReactNativeFactoryProvider`, delete the `UIWindow(...)` and `startReactNative(...)` lines from
  `didFinishLaunchingWithOptions`, and add `class SceneDelegate: ExpoAppSceneDelegate {}`. In
  `Info.plist` add a `UIApplicationSceneManifest` whose `UISceneDelegateClassName` is
  `$(PRODUCT_MODULE_NAME).SceneDelegate` (single scene, `UIApplicationSupportsMultipleScenes` false).
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
eas build -p ios --profile preview       # needs an Apple account
```

## Using the app

1. **Settings** → choose **Simulator** (default, no hardware) or **Real (BLE)**. In simulator mode
   pick which example car to emulate and whether to inject DTCs.
2. **Connect** → connect to the simulator, or scan & pick your Vgate adapter over BLE.
3. **Vehicle** → choose a profile (or Auto / Generic).
4. **Live**, **Faults**, **Info** → live data, read/clear DTCs, VIN/protocol/adapter info. The
   **Extended PIDs** screen (from Info) shows the experimental Mode 22 reads on CAN cars.

The **simulator path uses the exact same `DiagnosticSession`** the BLE path uses, so the whole UI is
exercisable end-to-end without a car — and is what the core integration tests cover.

## Feature ↔ code map

| Feature (`src/features/*`) | Screen | Spec |
|----------------------------|--------|------|
| `connection` | Connect / scan | [`features/connection.md`](./features/connection.md) |
| `vehicle-select` | Vehicle | [`features/vehicle-select.md`](./features/vehicle-select.md) |
| `live-data` | Live dashboard | [`features/live-data.md`](./features/live-data.md) |
| `fault-codes` | Faults | [`features/fault-codes.md`](./features/fault-codes.md) |
| `vehicle-info` | Info | [`features/vehicle-info.md`](./features/vehicle-info.md) |
| `extended-pids` | Extended PIDs | [`features/extended-pids.md`](./features/extended-pids.md) |
| `settings` | Settings | [`features/settings.md`](./features/settings.md) |

Cross-cutting: `src/shared/transports/ble/BleTransport.ts` (runtime characteristic discovery),
`src/shared/state/*` (Zustand), `src/shared/ui/*` (Tamagui widgets + SVG gauge),
`tamagui.config.ts`, `src/app/*` (expo-router).
