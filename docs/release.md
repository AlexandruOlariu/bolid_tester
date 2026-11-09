# Releases: versioning, signing, OTA updates

How a Bolid Tester build gets a version, a signature and over-the-air (OTA) updates, and how to cut,
check and roll back a release. Implemented by [plan 08](./plans/08-signed-release-ota.md). The privacy
side (what the update check sends) is in [privacy-policy.md](./privacy-policy.md).

## Versions

| Thing                       | Source                                                | Example  |
| --------------------------- | ----------------------------------------------------- | -------- |
| App version (`versionName`) | `package.json` `version` = `app.json` `expo.version`  | `0.2.0`  |
| OTA runtime version         | the app version (`runtimeVersion.policy: appVersion`) | `0.2.0`  |
| Android `versionCode`       | the CI run number (`BOLID_VERSION_CODE`)              | `57`     |
| Git tag / GitHub Release    | `v` + app version                                     | `v0.2.0` |

- **One version, three files.** `package.json`, `package-lock.json` and `app.json` must agree.
  `scripts/check-version-sync.mjs` fails `npm run ci` and the CI `verify` job when they do not, and
  `node scripts/check-version-sync.mjs --write` copies package.json's version into app.json.
- **versionCode** is the GitHub Actions run number, which only grows (Google Play needs a strictly
  increasing code). Local builds keep `versionCode 1` unless you set `BOLID_VERSION_CODE` before
  `expo prebuild`.
- **Semantic versioning.** `patch` for fixes, `minor` for features; `1.0.0` is the first store
  release ([roadmap](./roadmap.md)).
- **OTA reach.** An OTA update only reaches installs with the same runtime version, i.e. the same
  app version. Anything that changes native code — a new or upgraded native module, an Expo SDK
  upgrade, a permission or `app.json` plugin change — needs a new version and a new APK.

## Cutting a release

```bash
git switch main && git pull
npm run ci                       # green locally first
npm version minor                # or patch: bumps package.json + package-lock.json, and the npm
                                 # `version` script syncs app.json; one commit + tag vX.Y.Z
git push --follow-tags
```

`npm version` runs the package.json `version` script (`check-version-sync.mjs --write && git add
app.json`), so app.json lands in the same commit as the bump. Never edit the three versions by hand.

## What CI does (`.github/workflows/ci.yml`)

| Event                   | `verify` | `build-android`                                                                           | GitHub Release | `ota-publish`          |
| ----------------------- | -------- | ----------------------------------------------------------------------------------------- | -------------- | ---------------------- |
| any push / pull request | ✅       | —                                                                                         | —              | —                      |
| push to `main`          | ✅       | APK + AAB artifact; release-signed if the secret exists, else debug-signed with a warning | —              | —                      |
| push of a `v*` tag      | ✅       | APK + AAB, **must** be release-signed                                                     | ✅ created     | ✅ `production` branch |

- `verify`: lint, both typechecks, all Jest tests, `npm run check:release`
  (`scripts/check-signing-plugin.mjs` + `scripts/check-version-sync.mjs`) and `npm run check:capture`
  (the capture analyzer CLI on the synthetic capture, plan 25).
- `build-android`, in order: tag = `v<package.json version>` (tags only) → restore the keystore from
  `ANDROID_KEYSTORE_B64` into `$RUNNER_TEMP` and export `BOLID_KEYSTORE_PATH` (a tag build **fails
  here** when the secret is missing, instead of publishing a debug-signed release) → `expo prebuild`
  with `BOLID_VERSION_CODE=<run number>` → **Sentry source-map upload switch** (sets
  `SENTRY_DISABLE_AUTO_UPLOAD=true` while the `SENTRY_AUTH_TOKEN` secret is missing, plan 31) →
  `./gradlew assembleRelease bundleRelease` (with `EXPO_PUBLIC_SENTRY_DSN` from the `SENTRY_DSN`
  secret, `SENTRY_AUTH_TOKEN`, and `SENTRY_ORG` from the repository variable) →
  `aapt2 dump badging` must show `versionCode=<run number>` and `versionName=<version>` →
  `apksigner verify --print-certs` must succeed, print a signer certificate and not show "Android
  Debug" (whenever a keystore was restored)
  → artifact `android-v<version>-<run>` holding `bolid-tester-v<version>-<run>.apk` and `.aab`.
- Tags only: `gh release create vX.Y.Z <apk> <aab> --verify-tag --generate-notes` (notes from the
  merged PRs and commits since the previous tag).
- `ota-publish` (tags only, after the build): `eas-cli update --branch production --message vX.Y.Z`,
  with the same `EXPO_PUBLIC_SENTRY_DSN` as the APK (an update bundled without it would turn crash
  reporting into a no-op on every install that takes it).
  It skips with a warning while `EXPO_TOKEN` is missing or `app.json` still has the placeholder
  project, so a tag release never waits on the Expo setup.
- `git push --follow-tags` from `main` starts two runs (the branch and the tag). Both build; only the
  tag run publishes. Their run numbers differ, so the versionCodes stay unique.
- Artifacts are on the run page (Actions → the run → Artifacts), kept 90 days. Releases are under
  the repository's **Releases**.

## Signing

`android/` is gitignored and regenerated by `expo prebuild`, so signing is injected by the config
plugin `plugins/withReleaseSigning.js` (registered in `app.json` `plugins`). It edits the generated
`android/app/build.gradle`:

- adds `signingConfigs.release`, created only when `BOLID_KEYSTORE_PATH` is set, reading
  `BOLID_KEYSTORE_PASSWORD`, `BOLID_KEY_ALIAS` and `BOLID_KEY_PASSWORD` from the environment when
  Gradle runs. A set path with a missing file or a missing password stops the build with a clear
  `GradleException`. No secret and no path is written into the file — only `System.getenv(...)`.
- points the `release` build type at it only when `BOLID_KEYSTORE_PATH` is set; otherwise it keeps
  `signingConfigs.debug`, so `npm run android:apk` and the [android-apk skill](../.claude/skills/android-apk/SKILL.md)
  work unchanged on a dev machine.
- with `BOLID_VERSION_CODE` set at prebuild, writes it as `versionCode` (and as
  `expo.android.versionCode`, so Expo's own version step agrees).
- fails prebuild when the Expo template no longer has the expected `signingConfigs {`, `buildTypes`
  → `release` → `signingConfig signingConfigs.debug` and `versionCode` lines, rather than silently
  shipping a debug-signed build. `scripts/check-signing-plugin.mjs` checks all of this against
  `scripts/fixtures/app-build.gradle`, a copy of the file this Expo SDK generates. **After an Expo SDK
  upgrade**, refresh the fixture (the script's header says how).

A release-signed build on a dev machine (rarely needed — CI does it):

```powershell
$env:BOLID_VERSION_CODE = "1000"   # optional
npx expo prebuild --platform android --no-install
$env:BOLID_KEYSTORE_PATH = "C:\keys\bolid-release.keystore"
$env:BOLID_KEYSTORE_PASSWORD = "…"; $env:BOLID_KEY_ALIAS = "bolid"; $env:BOLID_KEY_PASSWORD = "…"
# No Sentry token on a dev machine: switch the source-map upload off or the build fails (plan 31).
# With a token instead: $env:SENTRY_AUTH_TOKEN = "…"; $env:SENTRY_ORG = "<org slug>"
$env:SENTRY_DISABLE_AUTO_UPLOAD = "true"
cd android; .\gradlew.bat assembleRelease bundleRelease --no-daemon
```

Keystores never enter git: `.gitignore` ignores `*.keystore` and `*.jks`.

## OTA updates (EAS Update)

- `expo-updates` checks only when the user taps **More → Check for updates**
  (`src/features/more/api/updates.ts`). `app.json` `updates.checkAutomatically` is
  `ON_ERROR_RECOVERY`: no silent check at launch; the only automatic check is the recovery after a
  crash during start-up.
- **Channels.** EAS Build profiles carry their channel (`eas.json`: `preview` → `preview`,
  `production` → `production`). The Gradle-built CI APK is not an EAS build, so `app.json`
  `updates.requestHeaders` sets `expo-channel-name: production` for it. Each channel reads the
  branch of the same name.
- **Shipping a JS-only hotfix** to installs of the current version: on a branch cut from the release
  tag, `eas update --branch production --message "fix: …"`. Test it first on `preview`
  (`eas update --branch preview …`) with an `eas build --profile preview` APK.
- **Rolling back an OTA:** `eas update:republish --branch production` and pick the previous group, or
  `eas update:rollback`; installs pick it up at their next check.
- Until the owner setup below is done, `updates.url` is a placeholder; a check then fails and the
  More screen reports "Updates unavailable" (the failure goes to the error log as a warning).

## Rolling back a release

- **APK / store:** re-publish the previous release's files (they stay attached to its GitHub
  Release). A store needs a _higher_ versionCode, so for Play: check out the previous tag on a new
  branch, `npm version <X.Y.Z>` with an explicit version above the bad release (bad `v0.2.1` →
  `npm version 0.2.2`; `npm version patch` would recompute the existing tag and stop), push the
  tag — CI builds the old code with a new version and code.
- **A bad tag** (CI failed, nothing published): `git push --delete origin vX.Y.Z && git tag -d
vX.Y.Z`, fix, then `npm version patch` again. Do not reuse a tag that produced a Release.

## Crash reports (plan 31)

Opt-in crash reporting ([settings → Privacy](./features/settings.md#privacy-crash-reports-plan-31))
uses Sentry through `@sentry/react-native` and its Expo config plugin
(`["@sentry/react-native/expo", { "project": "bolid-tester", "url": "https://de.sentry.io/" }]` in
`app.json`, before `./plugins/withReleaseSigning`; `metro.config.js` uses `getSentryExpoConfig` for
source-map debug ids, without Web Replay). The organisation slug comes from `SENTRY_ORG`.

| Name                         | Where                                                     | What for                                                                                |
| ---------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `SENTRY_DSN`                 | GitHub secret                                             | Becomes `EXPO_PUBLIC_SENTRY_DSN` in the CI APK / AAB and the OTA bundle                 |
| `SENTRY_AUTH_TOKEN`          | GitHub secret (and EAS secret for EAS builds)             | Source-map upload during the release build; without it the upload is switched off       |
| `SENTRY_ORG`                 | GitHub repository **variable** (and EAS env)              | The Sentry organisation slug for the upload                                             |
| `EXPO_PUBLIC_SENTRY_DSN`     | EAS environment variable (`eas env:create`), production   | The DSN for EAS-built apps                                                              |
| `SENTRY_DISABLE_AUTO_UPLOAD` | `eas.json`, every profile (`"true"`)                      | Keeps EAS builds green until the token exists; remove it from `production` once it does |
| `SENTRY_DISABLE_AUTO_UPLOAD` | `e2e.yml` build step, `npm run android:apk`, local builds | These builds never have a token; the upload step would otherwise fail the build         |

- **No DSN is committed.** Without `EXPO_PUBLIC_SENTRY_DSN` (dev builds, forks, local Gradle builds)
  the reporter is a no-op and Settings shows "Unavailable in this build".
- Even with a DSN nothing is sent until the user turns the switch on; events are scrubbed in
  `beforeSend` (`scrubEvent`) and tagged `release` = the app version, `environment: production`
  (`dev` in a dev build).
- Native crashes (Java / Objective-C / NDK) are captured by the native SDK and do not pass through
  the JavaScript scrubber; with `sendDefaultPii: false` they carry no device name. The native SDK
  attaches its own random installation ID (used to count crash-free sessions; it is not linked to
  the user). In the Sentry project, also turn on **Prevent storing of IP addresses** and keep the
  server-side data scrubbing defaults.
- The crash-free sessions figure for the store release (plan 30) comes from
  `enableAutoSessionTracking`.

## Owner setup (once)

None of this blocks the code: without it, main builds are debug-signed and OTA is skipped.

1. **Upload keystore.** Generate it locally, once, and keep it and its passwords in a password
   manager — a lost upload key means a new Play listing or a key-reset request:
   ```powershell
   keytool -genkeypair -v -keystore bolid-release.keystore -alias bolid -keyalg RSA -keysize 2048 -validity 10000
   ```
2. **GitHub secrets** (Settings → Secrets and variables → Actions):
   - `ANDROID_KEYSTORE_B64` — `[Convert]::ToBase64String([IO.File]::ReadAllBytes('bolid-release.keystore'))`
     (PowerShell) or `base64 -w0 bolid-release.keystore`;
   - `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (`bolid`), `ANDROID_KEY_PASSWORD`.
3. **Expo project.** `npx eas-cli login`, then in the repo `eas init` (writes
   `expo.extra.eas.projectId`) and `eas update:configure` (writes `updates.url`); commit the
   resulting `app.json`. Create the channels if EAS has not: `eas channel:create production` and
   `eas channel:create preview`. Add an `EXPO_TOKEN` secret (expo.dev → Access tokens) for
   `ota-publish`.
4. **Crash reports (optional, plan 31).** Create a Sentry organisation and a `bolid-tester`
   project in the **EU region** (de.sentry.io). Add the GitHub secrets `SENTRY_DSN` and
   `SENTRY_AUTH_TOKEN` and the repository variable `SENTRY_ORG`; for EAS builds add
   `EXPO_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN` and `SENTRY_ORG` as EAS environment variables of
   the production environment and delete `SENTRY_DISABLE_AUTO_UPLOAD` from the `production` profile
   in `eas.json`. In the project settings turn on **Prevent storing of IP addresses**. Then, on a
   release build, switch on Settings → Privacy → Send anonymous crash reports and press Settings →
   Developer & simulator → **Send test crash report**: the event must arrive with `***03398`,
   `<device-id>` and `<url>` in its message, no device name, and `environment: production`.
5. **First release** (the plan's step 5): when the v0.2 items are in, `npm version minor` → `v0.2.0`,
   push, and check the acceptance list below on the tag's run.

### Acceptance checks for the first signed tag

- `apksigner verify --print-certs` (the CI step output) shows the upload certificate, not "Android
  Debug"; `aapt2 dump badging` shows `versionCode` = the run number and `versionName` = the tag
  without `v`.
- A push to `main` without a tag uploads the artifact and creates no Release.
- A tag pushed before the keystore secret exists fails at **Restore release keystore**.
- On the signed build, **More → Check for updates** reports "Up to date"; a test `eas update
--branch preview` is picked up by an `eas build --profile preview` APK.
