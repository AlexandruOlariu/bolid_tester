# Bolid Tester — Privacy policy

Last updated: 2026-11-10

Bolid Tester is an OBD2 diagnostics app. This policy says what it stores, what it sends and where.
The same text is shown in the app under **Settings → About → Privacy policy**
(`src/features/settings/model/privacyPolicy.ts`; `privacyPolicy.test.ts` keeps the two in step).
This page is also the privacy-policy URL of the Google Play and App Store listings
([plan 30](./plans/30-store-release-prep.md)); the store data-safety answers derived from it are in
[`store/compliance/`](../store/compliance/).

## What stays on your phone

Everything the app reads from your car — fault codes, live data, the VIN, scans, trips and their GPS
points, maintenance entries, backups, bus captures and the error log — is stored only on this phone,
in the app’s private storage.

There are no accounts, no analytics, no advertising and no tracking. The developer receives nothing
from the app unless you turn on crash reports (below).

## When the app uses the internet

- AI assistant: off until you set up a provider. When you pick one (your own local server, OpenAI,
  Anthropic or another server you enter), each diagnosis and each follow-up question sends that
  provider a summary of the scan: fault codes, readiness monitors, the freeze frame, a few live
  values, the vehicle make, model and engine, the VIN and the car’s known checks for those codes,
  plus your question and the earlier answers. It goes only to the provider you chose. A local
  server stays on your network; a cloud provider (OpenAI or Anthropic) receives it over the
  internet and handles it under its own privacy policy and terms. API keys are kept in the phone’s
  secure storage, one per provider, never in backups, and each is sent only to its own provider.
- App updates: when you tap More → Check for updates, the app asks the Expo update server (run by
  Expo, expo.dev) whether a newer version exists and downloads it only if you accept. The request
  carries the app version, the update channel, the platform and a random installation ID created by
  the update library; like any web request, the server also sees your IP address. The app does not
  check on its own at launch; the only automatic check happens when the app restarts after crashing
  during start-up, to recover with a working version.
- Web search: on a fault code’s detail sheet, Search the web opens your browser with a search for
  that code and, when a car is selected, its name. From there the browser and the search engine apply their own privacy policies.
- Rate this app: Settings → About → Rate this app opens the app’s page in Google Play or the App
  Store. The app sends nothing itself; the store applies its own privacy policy.

## Crash reports (optional)

Crash reports are off unless you turn on Settings → Privacy → Send anonymous crash reports. When on, a crash or an unexpected error sends a report to Sentry (Functional Software, Inc.), a crash-reporting service, stored in its EU region (Germany). A report contains the app version, the phone model and system version, the error message and where in the app it happened, the last screens opened and the connection status changes before it. Before a report of an error in the app’s own code leaves the phone, the app removes VINs, adapter names and addresses, server addresses, API keys, e-mail addresses and GPS coordinates. A crash inside the phone’s system code or a built-in library is reported by the crash-reporting library directly, without that clean-up: it holds the technical error details and could, rarely, include a Bluetooth adapter’s address. A report never contains trip data, live values or your location. No account or user ID is set; the crash-reporting library adds its own random installation ID to count crash-free sessions, and the service sees your IP address like any web request but is set not to store it.

Reports are kept for 90 days and used only to find and fix bugs. The legal basis is your consent, which you withdraw by turning the switch off: nothing more is sent from then on. Reports already sent cannot be deleted from the phone, but they are not linked to you.

## Bluetooth, location and notifications

- Bluetooth is used only to find and talk to your OBD2 adapter. The Bluetooth scan is declared as
  not used to work out your location.
- Location is used only while you record a trip with GPS (and, on older Android versions, because
  the system requires it for Bluetooth scanning). The GPS track is stored on the phone only.
- Notifications are reminders and alerts created on the phone. There is no push server.

## Sharing and exports

Files leave the phone only when you share or export them yourself — a report, a capture, a fixture,
a backup or the error log — and they go to the app you pick in the share sheet.

Sharing a problem report: More → Report a problem builds one file with the error log, the adapter log, the app version, the phone’s system version, the selected car and the last module scan, plus anything you type. The VIN and the adapter’s address are removed unless you turn on Keep VIN and adapter address, and AI server addresses and keys are never included. Nothing is sent until you choose where it goes: the share sheet, an email draft, or Open GitHub issue, which opens your browser on a new public issue on the project page with a summary filled in (always without the VIN and the adapter address); you see it and submit it yourself.

A backup (Settings → Data → Backup & restore) is one plain-text file that you create and keep where
you choose. It holds everything listed above, including your VINs, and is not encrypted, so keep it
somewhere private. It never contains an AI API key.

## Deleting your data

History, trips and the error log have their own delete or clear buttons.

To erase everything, uninstall the app, or open Android Settings → Apps → Bolid Tester → Storage and
tap Clear storage.

## Changes and questions

Changes to this policy ship with app updates and are noted in the release notes; the date above
shows the current wording. Questions: open an issue on the project page,
github.com/AlexandruOlariu/bolid_tester.

---

_Technical notes (not part of the policy text):_ the AI request is built by
`buildDiagnosisMessages` (`src/shared/obd-core/analysis/aiDiagnosis.ts`) and sent by
`src/shared/ai/openaiClient.ts`; the update check is `src/features/more/api/updates.ts`, configured
in `app.json` `updates` (`checkAutomatically: "ON_ERROR_RECOVERY"`); the web search link is
`dtcWebSearchUrl` (`src/features/fault-codes/model/dtcDetail.ts`); the backup file is built by
`src/shared/lib/backup.ts` (`redactBackup` blanks any API key) and written by
`src/features/backup/api/backupService.ts`, with no network call; the problem report is built by
`redactBundle` (`src/shared/lib/feedbackBundle.ts`) and handed to the share sheet, the mail app or
the browser by `src/features/feedback/hooks/useFeedbackBundle.ts`, with no network call of its own;
crash reports are sent only by `src/shared/telemetry/crashReporting.ts` (Sentry, initialised only
after the Settings → Privacy switch is turned on, and only in builds with `EXPO_PUBLIC_SENTRY_DSN`),
every JavaScript event passing `scrubEvent` (`src/shared/lib/scrub.ts`) first; native crashes
(Java / Objective-C / NDK / ANR) are sent by the native Sentry SDK without that scrubber, as the
policy text says.
A new network call anywhere in the app must be added here first.
