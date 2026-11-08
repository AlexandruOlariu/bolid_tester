# Bolid Tester — Privacy policy

Last updated: 2026-11-09

Bolid Tester is an OBD2 diagnostics app. This policy says what it stores, what it sends and where.
The same text is shown in the app under **Settings → About → Privacy policy**
(`src/features/settings/model/privacyPolicy.ts`; `privacyPolicy.test.ts` keeps the two in step). A
hosted copy for the app stores follows with [plan 30](./plans/30-store-release-prep.md).

## What stays on your phone

Everything the app reads from your car — fault codes, live data, the VIN, scans, trips and their GPS
points, maintenance entries, backups, bus captures and the error log — is stored only on this phone,
in the app’s private storage.

There are no accounts, no analytics, no advertising and no tracking. The developer receives nothing
from the app.

## When the app uses the internet

- AI assistant: off by default. If you turn it on and enter a server address, each diagnosis sends
  that server a summary of the scan: fault codes, readiness monitors, the freeze frame, a few live
  values, the vehicle make, model and engine, and the VIN. It goes only to the server you entered,
  and that server’s operator decides what happens to it. An API key, if you enter one, is kept in
  the phone’s secure storage and sent only to that server.
- App updates: when you tap More → Check for updates, the app asks the Expo update server (run by
  Expo, expo.dev) whether a newer version exists and downloads it only if you accept. The request
  carries the app version, the update channel, the platform and a random installation ID created by
  the update library; like any web request, the server also sees your IP address. The app does not
  check on its own at launch; the only automatic check happens when the app restarts after crashing
  during start-up, to recover with a working version.
- Web search: on a fault code’s detail sheet, Search the web opens your browser with a search for
  that code and, when a car is selected, its name. From there the browser and the search engine apply their own privacy policies.

## Bluetooth, location and notifications

- Bluetooth is used only to find and talk to your OBD2 adapter. The Bluetooth scan is declared as
  not used to work out your location.
- Location is used only while you record a trip with GPS (and, on older Android versions, because
  the system requires it for Bluetooth scanning). The GPS track is stored on the phone only.
- Notifications are reminders and alerts created on the phone. There is no push server.

## Sharing and exports

Files leave the phone only when you share or export them yourself — a report, a capture, a fixture,
a backup or the error log — and they go to the app you pick in the share sheet.

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
`dtcWebSearchUrl` (`src/features/fault-codes/model/dtcDetail.ts`). A new network call anywhere in
the app must be added here first.
