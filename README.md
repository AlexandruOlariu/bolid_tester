# Bolid Tester

A **generic OBD2 / EOBD diagnostics app** for Android and iOS that talks to an ELM327-compatible
**Bluetooth Low Energy** adapter (e.g. the *Vgate iCar Pro Bluetooth 4.0*). It reads live engine
data, reads & clears fault codes, shows readiness / freeze-frame and the VIN — and adds trip
recording, charts, performance tests, alerts, sensor tests, and gated, experimental coding /
service-interval reset — for any OBD2-compliant car.

> **This project is documentation-driven.** The [`docs/`](./docs) folder is the source of truth.
> Start with [`docs/README.md`](./docs/README.md) and [`docs/PLAN.md`](./docs/PLAN.md).

## Status

- ✅ **Phase 0** — docs foundation + scaffolding.
- ✅ **Phase 1** — platform-agnostic OBD2 core + ELM327 simulator + tests (runs with no hardware).
- ✅ **Phase 2** — React Native (Expo) feature-sliced UI + BLE transport (`react-native-ble-plx`).
- ✅ **Phase 3** — readiness, freeze-frame, experimental Mode 22 PIDs, polish.
- ✅ **Phase 4** — analysis, performance & module access (see below). Core verified here; the
  RN/Tamagui screens build on a dev machine / EAS.
- ⏳ on-car validation against the three example cars; store builds.

See [`docs/implementation-log.md`](./docs/implementation-log.md) for details.

## Features

Core diagnostics: connection, vehicle select (or Auto/Generic), **live data**, **fault codes**
(stored/pending/permanent + readiness + freeze-frame), **vehicle info** (VIN, protocol, supported
PIDs), **settings** (with a built-in **simulator** so the whole app runs with no hardware).

Phase-4 additions (reachable from the **More** tab):

| Feature | What it does | Notes |
|---|---|---|
| [Diagnose (AI)](./docs/features/ai-diagnose.md) | One-tap AI health report from a local OpenAI-compatible LLM (e.g. LM Studio); reads + gated clear-DTC | falls back to on-device rules if no server |
| [History](./docs/features/history.md) | Persistent log of past AI diagnoses & fault-code checks | unlimited, clearable; file-backed |
| [Trips](./docs/features/trip-recording.md) | Record live data, export CSV/JSON, replay | — |
| [Charts](./docs/features/live-charts.md) | Live PIDs plotted over time | — |
| [Performance](./docs/features/performance-tests.md) | 0–100, ¼-mile, braking | closed-course |
| [Alerts](./docs/features/alerts.md) | Threshold warnings (haptic/visual/sound) | — |
| [Notifications](./docs/features/notifications.md) | Local notifications + maintenance reminders | on-device only |
| [Sensor tests](./docs/features/sensor-tests.md) | Mode 06 + experimental module sensors (ABS) | module reads CAN-only |
| [Coding](./docs/features/coding.md) | Experimental UDS module coding | gated, backup-first |
| [Service reset](./docs/features/service-reset.md) | Service-interval ("oil/SRI") reset | gated; CAN (Golf) **and** KWP2000 (Passat) |
| [DPF / regen](./docs/features/dpf.md) | Diesel soot load, regeneration status, EGT/EGR | experimental Mode 22; **CAN diesel only** |
| [Used-car inspection](./docs/features/used-car-inspection.md) | One-tap pre-purchase check incl. a "codes recently cleared?" tell | standard OBD2; any car |
| [Battery & charging](./docs/features/battery-health.md) | Resting/cranking/charging voltage → health verdict | voltage-based, not a load test |
| [VIN decoder](./docs/features/vin-decode.md) | WMI / country / year / check-digit from the VIN, offline | NA year/check conventions flagged |
| [Maintenance log](./docs/features/maintenance-log.md) | Service logbook + what's-due by km/time | odometer user-entered |
| [Error log](./docs/features/error-log.md) | Saves caught & uncaught errors; export as Markdown/JSON to fix later | on-device, capped, clearable |

> ⚠️ Coding and service-reset are **experimental writes** to control modules. They ship gated
> (explicit confirmation), are profile-driven, back up the current values first, and the shipped
> descriptors are **illustrative** — confirm on the real car. They are never offered for safety
> modules (immobilizer/airbag/cluster mileage).

## The OBD2 core — runnable now (no hardware)

The diagnostic engine in [`src/shared/obd-core`](./src/shared/obd-core) is pure TypeScript with **no
platform dependencies**, exercised against a built-in **virtual ELM327**
([`docs/simulator.md`](./docs/simulator.md)).

```bash
npm install
npm test          # unit + integration tests (incl. the 3 example cars via the simulator)
npm run lint
```

## Running the app (dev)

```bash
npm install
npx expo start --dev-client -c     # -c clears Metro's cache (needed after adding files)
```

The **Settings → Adapter source** toggle switches between a real BLE adapter and the simulator, so
every screen works with no car. After pulling new native dependencies, install them with
`npx expo install` (this project uses `expo-notifications`, `expo-file-system`, `expo-haptics`,
`expo-location`, `expo-sharing`).

## Building an Android APK (local)

```bash
npm install
npx expo prebuild --platform android --clean   # once, or after native config changes
cd android
gradlew.bat assembleRelease
# Output: android\app\build\outputs\apk\release\app-release.apk
```

(Convenience scripts: `npm run prebuild:android`, `npm run android:apk`, `npm run android:clean`.)

### Windows: `Filename longer than 260 characters` (MAX_PATH)

On Windows the native C++ codegen step can fail with:

```
ninja: error: Stat(... ShadowNode.cpp.o): Filename longer than 260 characters
```

This is the **Windows path-length limit**, not a project bug (the JS bundle builds fine first). The
object-file paths embed the full project path, which overflows 260 chars.

> **The Win32 `LongPathsEnabled` registry flag is not enough.** Even with
> `HKLM\…\FileSystem\LongPathsEnabled = 1` already set, the Android SDK's bundled `ninja` is **not**
> long-path-aware and still fails. The reliable fix is to **build through a short path** so the
> generated paths stay under 260 chars — no need to move or copy the project.

1. **Create a directory junction with a short name** pointing at the project (one-time; harmless,
   touches no files):
   ```bat
   mklink /J C:\b "C:\Users\<you>\...\bolid_tester"
   ```
2. **Delete the stale native build** (it was configured with the long paths) and rebuild *from the
   junction*:
   ```bat
   rmdir /s /q C:\b\android\app\.cxx
   cd /d C:\b\android
   gradlew.bat assembleRelease
   ```
   The APK still lands at `android\app\build\outputs\apk\release\app-release.apk` in the real project
   (the junction is the same folder). Remove the junction later with `rmdir C:\b` if you want.

Alternatives if you'd rather not use a junction: clone/build the project from a short drive root
(e.g. `C:\b`), or build in the cloud with `eas build -p android --profile preview` (see
[`eas.json`](./eas.json)).

A reusable Claude Code skill automates this whole flow — see
[`.claude/skills/android-apk/SKILL.md`](./.claude/skills/android-apk/SKILL.md).

### Will it run on Android Auto?

No — Android Auto only projects a fixed set of app categories (navigation, media, messaging,
point-of-interest, IoT, games-while-parked, browser/video) using Google's templated Car App Library;
a real-time diagnostics dashboard isn't an allowed category and React Native UI can't be projected.
The app is a normal phone app (mount the phone, talk BLE to the adapter). A glanceable in-app
"driving mode" is the practical in-car option.

## Example cars

The three cars in [`docs/vehicles/`](./docs/vehicles) are the owner's own, used as reference
profiles: **VW Golf Plus 2009 2.0 TDI** (CAN), **Fiat Grande Punto 1.2 2008** (CAN), and **VW Passat
B5.5 1.9 TDI** (K-line). They are examples — the app works with any OBD2 car, and new cars are added
as data (a Markdown profile + a typed object). See [`docs/architecture.md`](./docs/architecture.md).
