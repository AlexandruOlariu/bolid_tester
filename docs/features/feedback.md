# Feature: feedback (Report a problem)

One tap in **More → Tools → Report a problem** (`/feedback`, plan 32) builds a **redacted problem
report**: the error log, the adapter I/O log, the app and device info, the active vehicle and the
last module scan, plus what the user types. The user hands it over through the OS share sheet, a
prefilled GitHub issue or (when configured) an email draft. **The app never sends it anywhere by
itself** — every route goes through an app the user picks — and nothing identifies the car or the
adapter unless the user turns on **Keep VIN and adapter address**.

Before this, a user had to export the error log and the adapter log separately and could not
describe the problem; the maintainer got two files with no device info.

## UI

**FeedbackScreen** (`ui/FeedbackScreen.tsx`, route `src/app/feedback.tsx`, hidden tab "Report a
problem"):

1. Title **Report a problem**, subtitle "Share what happened and the app’s logs — identifiers are
   removed unless you choose to keep them."
2. **What happened?** — a multi-line field "What were you doing? What did you expect?" (at most
   2 000 characters, `FEEDBACK_DESCRIPTION_MAX`, with a live counter).
3. **The bundle contains** — a checklist with live counts: `N errors from the error log`, `M adapter
log lines`, `app vX.Y.Z · Android 14 (API 34)`, `vehicle: <name> (VIN hidden | VIN <vin> | VIN
not read)`, `last module scan: yes/no`; after a build, **Bundle size: 14.2 KB**.
4. **Keep VIN and adapter address** switch (default off), hint "Only turn this on if the maintainer
   asked for them." The screen is a hidden tab that stays mounted, so leaving it (`useIsFocused`)
   turns the switch off again and clears the last note; a description already shared or opened is
   cleared too, while an unsent draft is kept.
5. Buttons — **Share bundle (JSON)**, **Share summary (Markdown)**, **Open GitHub issue**, and
   **Email** only when `app.json` `expo.extra.feedbackEmail` is set (it is not, in this
   repository). All are disabled while one runs. After a share: "Thanks — bundle saved to the app
   folder as bolid-feedback-<stamp>.json."
6. Footer — "Nothing is sent until you choose where to share it." and a **Privacy policy** link
   (`PRIVACY_POLICY_URL`, docs/privacy-policy.md).

Entry points: the More → Tools row (icon `MessageSquareWarning`); the **Report** button at the top of
the [Error log](./error-log.md) screen; Settings → Developer & simulator → **Preview feedback
bundle**, which opens `/feedback?preview=1` — the bundle is built on open so its size shows (the
adapter log ring buffer caps it at 300 lines; expect well under 200 KB). The root render-error
boundary's fallback text points here: "Try again, or report it from More > Report a problem".

## hooks

`hooks/useFeedbackBundle.ts`:

- `collectBundleInput(description, keepIdentifiers, getLastScanReport?)` reads the stores right
  now: `useErrorLogStore` errors, `adapterLogSnapshot()`, `useSessionStore` (`deviceId`,
  `deviceName`, `info.vin` / `protocol` / `version` / `supportedPids`), the active profile
  (`getActiveProfile()`, `vehicleLabel`) and its garage VIN, `settingsStore.adapterSource`,
  `APP_VERSION` / `APP_BUILD` (`shared/lib/appInfo.ts`), `Platform.OS` / `Platform.Version` and the
  locale. `extraVins` adds the adapter log's recorded VIN and every garage VIN, so a VIN that only
  appears in a log line is still masked.
- `useFeedbackBundle({ getLastScanReport })` returns `build(description, keep)`,
  `shareJson(description, keep)`, `shareMarkdown(description, keep)`, `openIssue(description)`,
  `email(description, keep)`, `emailAvailable`, `busy` and `sizeBytes`. Each action builds a fresh
  bundle (so it carries the latest logs). Shares go through `saveTextFile`
  (`shared/lib/saveFile.ts`): a `bolid-feedback-<stamp>.json` / `.md` file in the document directory
  plus the share sheet on the phone, a download in the browser. `openIssue` / `email` call
  `Linking.openURL`; the URL is built inside the same `try`, so any failure still shows a note.
  Failures are logged as `feedback/share`, `feedback/open-issue`, `feedback/email`.
- **A GitHub issue is public**, so `openIssue` always builds the issue body from a redacted bundle,
  whatever the switch says. The kept identifiers only ever go into the files the user shares.
- The last module scan comes from the route (`src/app/feedback.tsx` reads the module-scan slice's
  `useScanHistoryStore` and `formatAutoScanReport`) — features never import each other.

## api / model

`src/shared/lib/feedbackBundle.ts` (pure, core typecheck scope, `feedbackBundle.test.ts`):

- `BundleInput` → `redactBundle(input): FeedbackBundle` (`schema: 1`, `createdAt`, `redacted`,
  `description`, `app`, `vehicle`, `adapter`, `errors`, `adapterLog`, `lastScanReport`).
- `bundleToJson(b)` — pretty JSON with a fixed key order (the same bundle always gives the same
  text; context keys sorted).
- `bundleToMarkdown(b, { maxErrors = 10, maxLogLines = 40 })` — a header table (created, app, device,
  adapter source, adapter, vehicle, VIN, protocol, supported PIDs, identifiers removed / kept), the
  description, the newest errors, the last adapter log lines in a code block, and the last module
  scan folded in `<details>` only when there is one. The shared Markdown file lists everything.
- `issueUrl(b, repo = 'AlexandruOlariu/bolid_tester')` —
  `https://github.com/<repo>/issues/new?title=…&body=…`, title "Problem report: <first line>"; the
  body is cut to 6 000 characters and then until the whole URL is ≤ 8 000 characters, ending with
  "Summary truncated — the full bundle is attached separately." Every cut (body, 80-character
  title, 300-character error line, 200-character log line) keeps surrogate pairs whole and the
  encoder turns any lone surrogate into U+FFFD, so an emoji never makes the URL throw.
- `mailtoUrl(b, to)` — subject and a short body (description, app, vehicle, counts) with **no log
  lines**; the user attaches the bundle file.
- `findVinsInAdapterLog`, `maskVinInAdapterLog`, `platformLabel`, `utf8ByteLength`, `formatBytes`.

`src/shared/lib/scrub.ts` (pure, `scrub.test.ts`; plan 31's crash reports reuse `scrubText`):
`scrubText` (with `{ keepIdentifiers }`), `maskVin`, `maskDeviceId`, `maskKnownVins`, `findVins`,
`looksLikeVin`, `looksLikeVinInText`.

## Redaction

Applied by `redactBundle`. **Keep VIN and adapter address** (`redacted: false`) skips only the
first five rows — the VIN, the device ids and the network addresses; the URL, secret, token and coordinate rows apply
whatever the switch says.

| What                                    | Becomes                                                                                      |
| --------------------------------------- | -------------------------------------------------------------------------------------------- |
| VIN (vehicle, errors, scan report)      | `***` + last 5 (`WVWZZZ1KZ9W903398` → `***03398`)                                            |
| VIN reply in the adapter log (`49 02`)  | ASCII hex of the first 12 characters → `*`, last 5 kept — contiguous, multi-frame or chunked |
| Adapter device id                       | MAC → `AA:BB:CC:**:**:**`; UUID / Wi-Fi address → `<device-id>`                              |
| MAC / UUID inside any text              | `<device-id>`                                                                                |
| IPv4 / `host:port` inside any text      | `<address>` (the Wi-Fi adapter's `192.168.0.10:35000`, quoted by its connect errors)         |
| http(s) URL inside any text             | `<url>`                                                                                      |
| Error context key `baseUrl` / `*url*` … | `<url>`                                                                                      |
| Error context key `apiKey` / token …    | dropped                                                                                      |
| `sk-…` keys, `Bearer …` tokens          | `<token>`                                                                                    |
| GPS coordinate pairs                    | `<coords>`                                                                                   |
| Description, adapter name, car name     | kept (the names still pass through `scrubText`)                                              |

VINs come from the session, the garage, the adapter log origin, any VIN-looking word in the errors
and scan report, and any 17-byte ASCII run in the received adapter traffic once each line is
reduced to its payload (frame index `0:`, 11-bit / 29-bit CAN ID and PCI bytes, K-line `48 6B 10`
header, checksum and `49 02 0N` prefix dropped — so a headers-on or K-line VIN reply is found
too). A VIN-looking word in
free text must hold a letter outside A–F (`looksLikeVinInText`): with spaces off (`ATS0`) and
headers on (`ATH1`), a monitored 11-bit CAN frame with a 7-byte payload (`7E8064100BE3FA813`) is
exactly 17 hex digits and must stay readable. A known VIN is masked wherever it occurs, whatever
its letters. No API key, secret or
email address is ever part of the bundle, and `app.json` ships no feedback address.

## Simulator

Works fully in simulator mode: connecting the Golf simulator fills the adapter log (including the
multi-frame `0902` VIN reply, `0:490201575657` / `1:5A5A5A314B5A39` / `2:57393033333938`), errors
come from any failure (e.g. the ignition-off scenario), and a Golf module scan populates the last
scan. Nothing hardware-specific.

## Acceptance

- Simulator Golf connected, one injected error: Report a problem shows `1 error`, the adapter log
  count and `vehicle: VW Golf Plus 2009 … (VIN hidden)`; **Share bundle (JSON)** hands the share path
  a JSON with `***03398`, no full VIN, no VIN hex, no `http` URL and no API key
  (`FeedbackScreen.test.tsx`).
- **Keep VIN and adapter address** on → the JSON has the full VIN and `redacted: false`, and still
  no `http` URL and no API key.
- **Open GitHub issue** opens `github.com/AlexandruOlariu/bolid_tester/issues/new` with the title and
  the redacted Markdown summary; the URL stays ≤ 8 000 characters for a 500-error bundle.
- The share buttons are disabled while a share runs; the Email button is hidden with no address.
- The error boundary's fallback points to More > Report a problem.
