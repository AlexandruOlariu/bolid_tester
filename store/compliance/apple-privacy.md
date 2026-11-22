# App Store — App Privacy ("nutrition label") answers

The answers for App Store Connect → **App Privacy**, derived from what the code does (plan 30).
Keep this sheet, the [Play sheet](./play-data-safety.md) and the
[privacy policy](../../docs/privacy-policy.md) in step; `storeConfig.test.ts` fails when a row
cites no code path or a path that no longer exists.

**Apple's definitions used here.** _Collect_ = transmit data off the device in a way that lets the
developer or a third-party partner access it for longer than needed to serve the request in real
time. Data processed only on the device is not collected. _Linked to you_ = tied to an identity
(account, e-mail, device id used across apps). _Tracking_ = linking data with other companies' data
for advertising, or sharing it with a data broker.

## Summary

- **Tracking: No.** No advertising SDK, no IDFA, no data broker — so no App Tracking Transparency
  prompt and no `NSUserTrackingUsageDescription` (`app.json` `ios.infoPlist` has none).
- **Data Not Linked to You:** Diagnostics → Crash Data and Diagnostics → Other Diagnostic Data
  (both **optional**); Identifiers → Device ID (the update library's id is sent with every update
  check, including the automatic one after a start-up crash, so it is not optional) — all for
  **App Functionality**.
- **Data Linked to You:** none.
- Everything else: **Data Not Collected**.

## Data types

| Apple category → type                                                                                         | Answer                                                                                                                                                                                                                                                                                                                        | Purpose           | Derived from                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Diagnostics → Crash Data                                                                                      | **Collected, not linked, optional** — only after the user turns on Settings → Privacy → Send anonymous crash reports (off by default); scrubbed before it leaves the phone                                                                                                                                                    | App Functionality | `src/shared/telemetry/crashReporting.ts` (`beforeSend` gate, `sendDefaultPii: false`), `src/shared/lib/scrub.ts`, `src/shared/state/settingsStore.ts` (`crashReports`) |
| Diagnostics → Other Diagnostic Data                                                                           | **Collected, not linked, optional** — same switch: app version, device model, OS version, the last screens and connection changes before an error                                                                                                                                                                             | App Functionality | `src/shared/telemetry/crashReporting.ts`                                                                                                                               |
| Identifiers → Device ID                                                                                       | **Collected, not linked** — the crash library's random installation id (only with crash reports on) and the update library's random installation id (every update check: More → Check for updates, and the one automatic check when the app restarts after crashing during start-up, `checkAutomatically: ON_ERROR_RECOVERY`) | App Functionality | `src/shared/telemetry/crashReporting.ts` (`enableAutoSessionTracking`), `src/features/more/api/updates.ts` (`expo-updates`), `app.json` (`updates.checkAutomatically`) |
| Location → Precise / Coarse Location                                                                          | **Not collected** — GPS points are recorded only while a trip is recorded and stay on the device; coordinates are removed from crash reports                                                                                                                                                                                  | —                 | `src/features/trip-recording/api/trackRecorder.ts` (when-in-use only), `src/shared/lib/scrub.ts`                                                                       |
| Contact Info, Health, Financial, Contacts, User Content, Browsing / Search History, Purchases, Sensitive Info | **Not collected** — no accounts; exports leave the device only through the share sheet, to an app the user picks                                                                                                                                                                                                              | —                 | `src/shared/lib/saveFile.ts` (`expo-sharing`), `src/features/backup/api/backupService.ts`                                                                              |
| Identifiers → User ID                                                                                         | **Not collected** — no accounts, no user id on crash reports                                                                                                                                                                                                                                                                  | —                 | `src/shared/telemetry/crashReporting.ts`                                                                                                                               |
| Usage Data (product interaction, advertising data)                                                            | **Not collected** — no analytics, no ads                                                                                                                                                                                                                                                                                      | —                 | `src/shared/telemetry/crashReporting.ts` (the only telemetry, and opt-in)                                                                                              |
| Other Data (vehicle data, VIN)                                                                                | **Not collected by the developer** — the AI assistant sends a scan summary only to the AI provider the user configured, with the user's own key (see below)                                                                                                                                                                   | —                 | `src/shared/ai/openaiClient.ts`, `src/shared/ai/anthropicClient.ts`, `src/shared/state/secureApiKey.ts`                                                                |

### The AI assistant

As in the Play sheet: the developer runs no AI server and receives nothing. The user picks the
provider (their own local server, OpenAI, Anthropic or a custom URL) and supplies the key; the
request goes straight from the phone to that provider. If App Review asks, answer in the review
notes and point to the privacy policy; the conservative alternative label is _Other Data → Other
Data Types_, not linked, optional, App Functionality.

## Other App Store Connect answers

| Field              | Answer                                                                                                                                                                           | Source                                                         |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Export compliance  | `ITSAppUsesNonExemptEncryption: false` — only the OS HTTPS stack (exempt); TestFlight skips the question                                                                         | `app.json` `ios.infoPlist`                                     |
| Privacy policy URL | https://github.com/AlexandruOlariu/bolid_tester/blob/HEAD/docs/privacy-policy.md                                                                                                 | `src/shared/lib/appInfo.ts` (`PRIVACY_POLICY_URL`)             |
| Usage strings      | Bluetooth (adapter), local network (Wi-Fi adapter), location when in use (trip GPS track); no Always location, no motion                                                         | `app.json` `ios.infoPlist`, `src/shared/lib/iosConfig.test.ts` |
| Privacy manifest   | Expo SDK modules ship their own `PrivacyInfo.xcprivacy`; check the first upload's email for missing required-reason APIs and add them under `ios.privacyManifests` in `app.json` | `app.json`                                                     |
| Category           | Utilities (secondary: Productivity)                                                                                                                                              | store/README.md                                                |
| Age rating         | 4+ (no objectionable content, no web view, no user-generated content shown to others)                                                                                            | store/README.md                                                |
