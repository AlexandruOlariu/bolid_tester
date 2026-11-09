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

For cloud builds without a Mac, use EAS (profiles in `eas.json`):

```bash
npm i -g eas-cli
eas build -p android --profile preview   # APK
eas build -p ios --profile preview       # needs an Apple account
```

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

All 32 slices, grouped as in the [feature audit](./audit-2026-11.md#feature-inventory). Routes are
files in `src/app/` (expo-router); every hidden route is reached from **More** or **Info** (see
[more](./features/more.md#hidden-routes-and-where-they-are-reached)). Two specs carry another name
(`inspection` → `used-car-inspection`, `maintenance` → `maintenance-log`), and
[`features/tp20.md`](./features/tp20.md) documents the shared TP2.0 transport rather than a slice.
`src/shared/lib/featureDocsSync.test.ts` fails CI when a slice has no spec or a spec has no slice.

### Tier A — generic OBD2 (any car)

| Slice (`src/features/*`) | Route                           | Spec                                                           |
| ------------------------ | ------------------------------- | -------------------------------------------------------------- |
| `connection`             | `/` (Connect tab)               | [`features/connection.md`](./features/connection.md)           |
| `vehicle-select`         | `/vehicle` (Vehicle tab)        | [`features/vehicle-select.md`](./features/vehicle-select.md)   |
| `live-data`              | `/dashboard` (Live tab)         | [`features/live-data.md`](./features/live-data.md)             |
| `fault-codes`            | `/faults` (Faults tab)          | [`features/fault-codes.md`](./features/fault-codes.md)         |
| `vehicle-info`           | `/info` (Info tab)              | [`features/vehicle-info.md`](./features/vehicle-info.md)       |
| `vin-decode`             | `/vin-decode`                   | [`features/vin-decode.md`](./features/vin-decode.md)           |
| `extended-pids`          | `/extended` (from Info)         | [`features/extended-pids.md`](./features/extended-pids.md)     |
| `sensor-readings`        | `/sensor-readings`              | [`features/sensor-readings.md`](./features/sensor-readings.md) |
| `sensor-tests`           | `/sensors`                      | [`features/sensor-tests.md`](./features/sensor-tests.md)       |
| `settings`               | `/settings` (Settings tab)      | [`features/settings.md`](./features/settings.md)               |
| `error-log`              | `/error-log`                    | [`features/error-log.md`](./features/error-log.md)             |
| `more`                   | `/more` (More tab)              | [`features/more.md`](./features/more.md)                       |
| `onboarding`             | — (cards on Connect and Charts) | [`features/onboarding.md`](./features/onboarding.md)           |
| `engine-host`            | — (headless, `_layout.tsx`)     | [`features/engine-host.md`](./features/engine-host.md)         |

### Tier B — analysis, ownership, tooling

| Slice (`src/features/*`) | Route             | Spec                                                                   |
| ------------------------ | ----------------- | ---------------------------------------------------------------------- |
| `ai-diagnose`            | `/ai-diagnose`    | [`features/ai-diagnose.md`](./features/ai-diagnose.md)                 |
| `history`                | `/history`        | [`features/history.md`](./features/history.md)                         |
| `report`                 | `/report`         | [`features/report.md`](./features/report.md)                           |
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
