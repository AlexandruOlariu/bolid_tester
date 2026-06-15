---
name: android-apk
description: >-
  Build a local Android APK for this Expo/React Native project (Gradle
  assembleRelease), handling the Windows MAX_PATH (260-char) native-build
  failure automatically. Use whenever the user asks to build, compile, or
  produce an APK/Android build locally, or hits "Filename longer than 260
  characters" / ninja path errors during a Gradle native build.
---

# Build a local Android APK

Produce an installable APK from the prebuilt `android/` project using Gradle. On Windows the native
C++ codegen step overflows the 260-char path limit; this skill builds through a short **directory
junction** so paths stay legal. The release variant is signed with the debug keystore (see
`android/app/build.gradle`), so the APK installs directly — it is **not** a Play-Store upload build.

## Preconditions (check, don't assume)

1. **`android/` exists.** If not, prebuild first: `npx expo prebuild --platform android --clean`.
2. **node_modules installed** — `node_modules/.bin` present. If not: `npm install`.
3. **JDK 17** on `JAVA_HOME` (`java -version` → 17.x). RN 0.85 needs 17.
4. **Android SDK** present — `ANDROID_HOME` set, or `%LOCALAPPDATA%\Android\Sdk` exists. Ensure
   `android/local.properties` has `sdk.dir=...` (escape `\` as `\\` and `:` as `\:`). Create it if missing.

If a precondition genuinely can't be met, stop and tell the user exactly what's missing — don't guess.

## Build (Windows — the path-safe way)

The plain `cd android && gradlew.bat assembleRelease` works **only** if the project already sits at a
short path. From a deep path (e.g. `C:\Users\<you>\Desktop\...`) it fails with
`ninja: error: ... Filename longer than 260 characters`. The Win32 `LongPathsEnabled` registry flag
does **not** fix it — the SDK's bundled `ninja` isn't long-path-aware. Build through a junction:

1. **Make a short junction** to the project root (idempotent — skip if `C:\b` already points here):
   ```powershell
   if (-not (Test-Path "C:\b")) { New-Item -ItemType Junction -Path "C:\b" -Target "<project-root>" }
   ```
   If `C:\b` is taken by something else, pick another short name (`C:\bt`, `D:\b`, …).
2. **Clear the stale native cache** (it was configured with the long paths) and build from the junction:
   ```powershell
   Remove-Item -Recurse -Force "C:\b\android\app\.cxx" -ErrorAction SilentlyContinue
   cd C:\b\android
   .\gradlew.bat assembleRelease --no-daemon
   ```
   Use `run_in_background: true` — a clean native build takes several minutes (NDK/CMake for
   `react-native-screens`, `react-native-worklets`, `react-native-gesture-handler`, `expo-modules-core`,
   four ABIs). Don't poll in tight loops; wait for the completion notification, then read the output file.

The `.cxx` removal is only needed when switching path roots or after a failed/partial native build;
on a clean repeat build from the same junction you can skip it.

## On macOS / Linux

No path limit — build in place:
```bash
cd android && ./gradlew assembleRelease
```

## Verify & report

- Success line: `BUILD SUCCESSFUL`. On failure, grep the output for `FAILURE`, `What went wrong`,
  `ninja: error`, `Execution failed` and diagnose from there.
- APK lands in the **real project** (junction is the same folder):
  `android/app/build/outputs/apk/release/app-release.apk` (~100 MB).
- Report the path + size, and give the install command:
  `adb install "<project>\android\app\build\outputs\apk\release\app-release.apk"`.

## Notes

- Debug-key signed → fine for sideloading/testing, **not** Play upload. For a store build, set up a
  real upload keystore or use `eas build -p android` (`eas.json` is configured).
- For a smaller download, build a `.aab` (`bundleRelease`) or split per-ABI APKs.
- The junction is safe to delete afterward (`rmdir C:\b` / `Remove-Item C:\b`) — it never touches files.
