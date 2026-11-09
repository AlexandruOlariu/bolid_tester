# Implementation Log

A running record of what was actually built, newest first. (Documentation-driven: specs live in the
other docs; this file is the "what we did" history.)

---

## Plan 32 — Feedback and log bundle (2026-11-09)

[Plan 32](./plans/32-feedback-log-bundle.md) landed: **More → Tools → Report a problem** builds a
**redacted problem report** — error log, adapter I/O log, app and device info, active vehicle, last
module scan and the user's description — and hands it to the OS share sheet (JSON bundle or Markdown
summary), a prefilled GitHub issue or an email draft. The app sends nothing by itself. The plan has
no deferred / owner section; roadmap ✅.

- **Scrubbing (`src/shared/lib/scrub.ts`, new, core scope).** Plan 31 had not landed, so this plan
  owns the file: `scrubText` (VIN → `***` + last 5, MAC / UUID → `<device-id>`, http(s) URLs →
  `<url>`, `sk-…` / `Bearer …` → `<token>`, coordinate pairs → `<coords>`; idempotent), `maskVin`,
  `maskDeviceId` (MAC keeps the maker prefix `AA:BB:CC:**:**:**`, anything else `<device-id>`),
  `maskKnownVins`, `findVins`, `looksLikeVin`, `looksLikeVinInText` (a free-text VIN also needs a
  letter outside A–F, so a 17-hex-digit CAN frame — `ATS0` + `ATH1`, 11-bit header, 7-byte payload
  — is never masked). `scrubText(s, { keepIdentifiers })` skips only the VIN and MAC / UUID rules.
  Plan 31 adds `scrubEvent` / `scrubBreadcrumb` here.
- **Bundle core (`src/shared/lib/feedbackBundle.ts`, new, core scope).** `redactBundle` (schema 1),
  `bundleToJson` (fixed key order, sorted context keys), `bundleToMarkdown` (header table,
  description, newest 10 errors, last 40 adapter lines, scan report in `<details>` only when present),
  `issueUrl` (body cut to 6 000 characters, then until the URL is ≤ 8 000, with "Summary truncated —
  the full bundle is attached separately."), `mailtoUrl` (no log lines), `platformLabel`
  ("Android 14 (API 34)"), `utf8ByteLength`, `formatBytes`. VIN masking in the adapter log:
  `findVinsInAdapterLog` decodes every 17-byte ASCII run of the received traffic (so a VIN read
  earlier but no longer in the session is still found) and `maskVinInAdapterLog` stars the hex of the
  first 12 VIN bytes whether the reply is contiguous, multi-frame (`0:490201575657` /
  `1:5A5A5A314B5A39` / `2:57393033333938` — the real simulator traffic), spaced with headers on, or
  split mid-byte across BLE chunks. Error context: secret keys (`apiKey`, token, secret, password,
  authorization) dropped, address keys (`*url*`, host, endpoint) → `<url>`, texts scrubbed.
  **Keep VIN and adapter address** (`keepIdentifiers`, `redacted: false`) keeps only the VIN and the
  device ids: secret keys are still dropped and URLs, tokens and coordinates still scrubbed
  everywhere, so the privacy policy's "AI server addresses and keys are never included" holds.
- **Feature slice `src/features/feedback/`.** `hooks/useFeedbackBundle.ts` (`collectBundleInput`
  reads the error log, `adapterLogSnapshot()`, the session, `getActiveProfile()`, the garage VINs,
  `adapterSource`, `APP_VERSION` / `APP_BUILD`, `Platform`, the locale; `shareJson` / `shareMarkdown`
  write `bolid-feedback-<stamp>.json|md` through `saveTextFile` and open the share sheet;
  `openIssue` / `email` use `Linking.openURL`; failures logged as `feedback/*`).
  `ui/FeedbackScreen.tsx` (description ≤ 2 000 characters, live checklist, **Keep VIN and adapter
  address** switch off by default, four buttons disabled while busy, "Thanks — bundle saved…" line,
  bundle size, footer "Nothing is sent until you choose where to share it." + privacy-policy link).
  Route `src/app/feedback.tsx` (hidden tab "Report a problem") hands in the last scan from the
  module-scan slice (`module-scan/index.ts` now exports `useScanHistoryStore` and
  `formatAutoScanReport`).
- **Entry points.** More → Tools row (`MessageSquareWarning`, exists in lucide-react-native 1.17);
  **Report** button on the Error log screen; Settings → Developer & simulator → **Preview feedback
  bundle** (`/feedback?preview=1`, builds on open and shows the size); `RootErrorBoundary` fallback
  now reads "Try again, or report it from More > Report a problem".
- **App info.** `FEEDBACK_EMAIL` (from `app.json` `expo.extra.feedbackEmail`; not set, so the Email
  button is hidden) and `PRIVACY_POLICY_URL` in `shared/lib/appInfo.ts`.
- **Privacy policy.** New "Sharing a problem report" paragraph under Sharing and exports (in-app text
  and `docs/privacy-policy.md`, kept in step by `privacyPolicy.test.ts`) plus the technical note.
- **Tests (+4 suites).** `scrub.test.ts` (each rule with a near miss, idempotence, helpers),
  `feedbackBundle.test.ts` (VIN in vehicle / error message / context / scan report / contiguous,
  multi-frame and chunked `49 02` frames, VIN found only in the log, MAC masking, `apiKey` dropped,
  `keepIdentifiers` keeps only the VIN and the MAC (secrets / URLs / tokens / coordinates still
  removed), a 17-hex-digit CAN frame left alone, input not mutated, stable JSON, Markdown caps and `<details>`, issue URL ≤ 8 000
  for 500 errors with multi-byte text, mailto without logs), UI `FeedbackScreen.test.tsx`
  (simulator Golf + one error: counts, redacted JSON with no VIN / VIN hex / URL / key, keep switch
  with the VIN but still no URL / key,
  scan report in the Markdown, redacted issue URL, buttons disabled while busy, preview size) and
  `RootErrorBoundary.test.tsx`; extended `sections.test.ts`, `MoreScreen.test.tsx`,
  `ErrorLogScreen.test.tsx`, `SettingsScreen.test.tsx`, `appInfo.test.ts`.
- **Docs.** New `docs/features/feedback.md` (UI / hooks / api / model / Redaction table /
  Simulator / Acceptance); `error-log.md` (Report button, relationship), `more.md` (row, 26 hidden
  routes), `settings.md` (Preview feedback bundle), `phase2-mobile-app.md` / `README.md` (34
  slices), privacy policy, roadmap ✅.

Review fixes:

- **VIN in a headers-on log.** `findVinsInAdapterLog` now reduces each received line to its payload
  (`rxPayloadHex`: frame index, 11-bit / 29-bit CAN ID + PCI bytes, K-line header / checksum /
  `49 02 0N` prefix dropped), so a VIN only the log knows is found in `ATH1` multi-frame replies
  (spaced or `ATS0`, chunked) and K-line replies too, not just in the headers-off `0:/1:/2:` form.
- **No `URIError` from a cut emoji.** `oneLine` cuts through `cutAt` (no lone high surrogate in the
  80-character title or the error / log lines), the URL builders encode through `encodeText`
  (lone surrogate → U+FFFD), and the hook builds the issue / mailto URL inside `open`'s `try`, so a
  failure is logged and shown instead of becoming an unhandled rejection.
- **Switch reset per visit.** `/feedback` is a hidden tab that stays mounted: on blur
  (`useIsFocused`) the screen turns **Keep VIN and adapter address** off and clears the note, and
  clears the description once it was handed over (an unsent draft is kept).
- Tests: headers-on 11-bit / 29-bit / `ATS0` chunked / K-line VIN discovery, emoji at the title and
  error-line cut points, a lone surrogate in an error message, and the switch reset on blur.

Second review fixes:

- **No file written is logged.** `saveTextFile` returns null without throwing when the device has
  no document directory; `share` now logs a `feedback/share` entry in that case too, so the
  screen's "See More → Error log for details" note always finds one (UI test added).
- **Docs.** `phase2-mobile-app.md` feature ↔ code map gains the `feedback` row (Tier A, after
  `more`) and reads "All 34 slices", as does `docs/README.md`; `features/settings.md` lists the
  Developer & simulator **Problem report** block (**Preview feedback bundle**) between the Adapter
  log and Hints and app data.

Deviations from the plan:

- **No `expo-constants`.** The version and build come from the existing `APP_VERSION` / `APP_BUILD`
  (`shared/lib/appInfo.ts`, read from `app.json`), as plan 29 did — no new dependency.
- **Hook API.** `shareJson`, `shareMarkdown`, `openIssue` and `email` take the description (and the
  switch) and build a fresh bundle each time, instead of `build()` first and argument-less actions;
  a file is written per share (via `saveTextFile`, so the browser downloads it) rather than both
  files at build time. `build()` is still exposed (preview).
- **The GitHub issue body is always redacted**, even with **Keep VIN and adapter address** on: an
  issue is public. Kept identifiers only go into the files the user shares.
- **Last module scan via the route**, not read by the hook: features never import another feature's
  store, so `src/app/feedback.tsx` passes `getLastScanReport` (the plan 07 `resetAppData` pattern).
- **Wider redaction than listed.** VINs are also collected from the log traffic, the garage and the
  adapter log origin; the log masking tolerates multi-frame / chunked replies; context keys for
  tokens / passwords are dropped and address keys (`host`, `endpoint`) become `<url>`; the VIN rule
  needs a letter and a digit (no 17-digit counters), and the token rule accepts `-` / `_` so
  `sk-ant-…` keys match. `adapterSource` is typed as a string (it is now `mock` / `ble` / `wifi` /
  `spp`).
- **Privacy link** opens the published `docs/privacy-policy.md` (there is no in-app policy route;
  the same text is in Settings → About).
- **No "Send test error" button**: the plan's Simulator note assumes one exists; it does not and was
  not added (errors are provoked with the ignition-off scenario or any failing flow).
- The UI test mocks `saveTextFile` (the `ui` Jest project cannot run its variable-specifier
  `import()`), as `AdapterHealthScreen.test.tsx` does.

---

## Plan 29 — Adapter compatibility matrix (2026-11-09)

[Plan 29](./plans/29-adapter-compatibility-matrix.md) landed: every adapter-health run can be shared
as a structured **schema-v1 JSON report**, a script turns the reports committed under
`docs/adapters/reports/` into [`docs/adapters/matrix.md`](./adapters/matrix.md), one page per adapter
and the in-app **Known adapters** list, and CI enforces that the generated files are current. The
pipeline is complete and tested with zero reports. What waits (the plan's "Deferred" section, roadmap
"on-car pending"): the owner runs the check on the Vgate iCar Pro (Android, later iOS / web) and on
any Wi-Fi / SPP adapter, commits the JSON files and runs `npm run adapters:build`.

- **Shared pure module.** `src/shared/adapters/adapterMatrix.ts` — no imports, erasable types only,
  so both the app and the build script use it (the script through Node type stripping, like the
  capture analyzer): `AdapterReportJson` (schema 1), `validateAdapterReport(value, { allowMock })`
  (schema, types, ISO `ranAt`, link / grade / platform enums; **rejects any unexpected top-level
  field and anything in `vehicle` besides `profileId` / `protocol`**, so a VIN or location cannot be
  added by hand; refuses `link: "mock"` unless allowed), `adapterSlug` (`"IOS-Vlink"` +
  `"ELM327 v2.2"` → `ios-vlink__elm327-v2-2`; null / empty → `unknown`), `reportFileName`
  (`<slug>__<yyyy-mm-dd>.json`), `groupAdapterReports` (count, grade distribution, typical grade =
  mode with ties to the worse grade, median of medians, links / protocols / platforms, clone ratio,
  last date) and `buildAdapterMatrix` (matrix + pages + `knownAdapters.json`, deterministic).
- **App report.** `features/adapter-health/api/adapterReportJson.ts` — `buildAdapterReportJson(report,
ctx)` and `reportLinkFor(linkKind, platform)` (no link kind → `mock`; BLE in a browser →
  `web-ble`). The run sequence moved out of the hook into `api/runHealthCheck.ts` (injectable clock,
  phase callback, stop check) so the simulator test drives the exact production path.
  `useAdapterHealth.share(format: 'txt' | 'json')`; `adapterReportContext()` reads `APP_VERSION`,
  `Platform.OS` / `Platform.Version`, `sessionStore.deviceName`, `curatedProfileId(getActiveProfile())`
  (a garage car reports its registry base, never its random local `user:` id) and the link store.
  The screen gains **Share JSON (for the compatibility matrix)** and the community line
  ("Community: 3 community reports · typically GOOD · ~28 ms" / "No community reports for this
  adapter yet — share the JSON to add one.").
- **Link store moved.** `features/connection/model/linkStore.ts` → `shared/state/linkStore.ts`
  (`ConnectStage` now defined there, re-exported by `diagnoseFailure.ts`) so adapter-health reads the
  link kind and MTU without a feature → feature import; four import sites updated.
- **Build script.** `scripts/build-adapter-matrix.mjs [--check] [--reports <dir>] [--out <dir>]`,
  no dependencies: validates every report (one line per problem, exit 1, nothing written), writes
  `matrix.md` (Adapter · Firmware · Link · Reports · Typical grade · Median ms · Protocols · Platforms
  · Page · Guide), `<slug>.md` pages (every report row and every note) and
  `src/shared/adapters/knownAdapters.json`; removes the page of an adapter with no reports left
  (generated files carry a marker line); `--check` exits 1 on any missing / out-of-date / stale
  output (CRLF-tolerant). `EXTRA_DOCS` links `ios-vlink` to `adapter-vgate-icar-pro.md`.
  `npm run adapters:build` / `adapters:check`; the check runs in the CI `verify` job after lint and
  in `npm run ci`. `.prettierignore` (new) skips the generated files so `npm run format` cannot
  break the byte-for-byte check.
- **Known adapters.** `src/shared/adapters/index.ts` — `KNOWN_ADAPTERS` (the generated JSON, `[]`
  today), `matchKnownAdapter(name, firmware?, list?)` (exact case-insensitive name-hint match,
  firmware tie-break, then most reports — generic names like "OBDII" never borrow a grade),
  `communitySummary`, `knownAdapterChip`. `DeviceRow` shows a green / amber / red **known good / ok /
  poor** chip (`known-adapter-chip`) with a screen-reader summary.
- **Tests (+5 suites).** `adapterMatrix.test.ts` (slug, validator incl. VIN / location rejection,
  grouping, rendering), `buildAdapterMatrix.test.ts` (spawns the script on temp dirs: zero reports,
  2 + 1 reports → two rows / median of medians / pages / two known entries, mock → exit 1, malformed
  → exit 1, hand edit / new report → `--check` exit 1, stale page removal, committed outputs
  current), `knownAdapters.test.ts`, `adapterReportJson.test.ts` (shape, ISO date, privacy, link
  mapping, **simulator end to end**: `ELM327 v2.2`, 12.3 V, CAN, 10/10 answers → valid `mock` report
  the matrix refuses), and UI `DeviceRow.test.tsx` (seeded list → chip) +
  `AdapterHealthScreen.test.tsx` (simulator → run → Share JSON → valid report saved as
  `application/json`). `gradeAdapter.test.ts` unchanged.
- **Docs.** `docs/adapters/README.md` (contribute, schema, privacy, grades, columns, how it is
  built), generated `docs/adapters/matrix.md`, features adapter-health (JSON share, community line,
  matrix) and connection (chip, link store location), root `README.md` and `docs/README.md` links,
  roadmap ✅ (on-car pending).

Deviations from the plan:

- **No `expo-constants`.** The app version comes from the existing `APP_VERSION`
  (`shared/lib/appInfo.ts`, read from `app.json`, kept in sync by `check-version-sync.mjs`) — the
  same source every other export uses — so no new dependency was added.
- **Schema type lives in `@/shared/adapters`**, not in `adapterReportJson.ts` (which re-exports it):
  the build script imports the validator / slug / renderers from that pure module, so there is one
  implementation. The script therefore needs Node ≥ 22.18 (type stripping, as `analyze-capture.mjs`
  already does; CI uses 24) instead of "Node ≥ 20".
- **The matrix header names the latest report's date**, not the build date, so `--check` does not
  fail the day after a build ("from N reports (latest yyyy-mm-dd)").
- **Pure-module tests live in `src/shared/adapters/`**; the core `tsconfig.json` include list was
  extended with `src/shared/adapters/**/*.ts` (the plan's second option).
- **`linkStore` moved to `shared/state`** (the plan assumed adapter-health could read it; the repo's
  layering rule forbids a feature → feature import).
- **`profileId` is the registry profile** (`curatedProfileId`), so garage cars do not leak a random
  local id into a public report.
- Added a stale-page cleanup, `.prettierignore` and `runHealthCheck` (not in the plan) — needed for a
  stable check and a real simulator test.

Review fixes:

- **Report context captured at run time (major).** `adapterReportContext()` used to run when Share
  was tapped, while the report stays in the module-level `adapterHealthStore` across reconnects —
  so a simulator run shared after connecting a real BLE adapter carried the simulator's firmware and
  latencies under the real adapter's name, `link: "ble"` and MTU, and passed the validator. The hook
  now captures the context when the run starts and stores it on the report
  (`AdapterHealthReport.context`); Share JSON and the screen's community line read
  `report.context`, never the live stores. `adapterHealthStore` joined `test/resetStores.ts`.
- **Allowlist on every object.** `validateAdapterReport` now rejects unknown keys in `app`,
  `adapter`, `measurements`, `measurements.latency` and `grade` too (not only the top level and
  `vehicle`), so `adapter.mac` / `app.location` / `measurements.gps` cannot be added by hand.
- **Stand-in connection names are not identities.** `WIFI_DEVICE_NAME`, `WEB_BLE_DEVICE_NAME` and
  `SPP_DEVICE_NAME` moved into `shared/adapters/adapterMatrix.ts` (`PLACEHOLDER_DEVICE_NAMES`;
  `connectionService` imports and re-exports them from the pure module, not the index, so the
  bundled JSON is not loaded by the test setup before a test's `jest.mock`). `buildAdapterReportJson`
  writes them as `deviceName: null` (`reportDeviceName`), the validator refuses a report carrying
  one, and `matchKnownAdapter` never matches one — two Wi-Fi adapters no longer share a slug by name
  or borrow each other's grade. Unnamed adapters group by firmware only (`unknown__<firmware>`).
- **No stuck run after leaving the screen (minor, predates plan 29).** `useAdapterHealth.run()`
  cleared `running` / `phase` only while the screen was mounted, but `adapterHealthStore` is
  module-level: leaving mid-run left `running: true` until an app restart, and the remounted
  screen's button stayed disabled on the last phase label. The `finally` now always resets them;
  the cut-short report is still dropped.
- +7 tests: nested-extras rejection, stand-in refusal, `reportDeviceName`, stand-in never matched,
  stand-in → null in the built report, the screen test "shares the adapter the run was made on"
  (run on the simulator, switch the stores to a real BLE adapter, Share JSON → still `mock`), and
  "leaving the screen mid-run does not leave the check stuck as running" (unmount mid-run → store
  idle, no partial report, a fresh mount runs again).

---

## Plan 28 — Web Bluetooth PWA (2026-11-09)

[Plan 28](./plans/28-web-bluetooth-pwa.md) landed: the app builds as a static Expo web site, connects
to a Bluetooth LE ELM327 from Chrome / Edge through a `WebBluetoothTransport`, persists its stores in
`localStorage`, and every native-only feature either has a web replacement or says "Not available on
web yet" — nothing crashes. A GitHub Pages workflow deploys it on every push to `main`. What waits
(the plan's "Deferred" section, roadmap "on-car pending"): the Vgate from Chrome on Android and on a
laptop (chooser name, service UUID, latency grade into plan 29), whether it needs the 20-byte
chunking, and the owner enabling Pages (Settings → Pages → Source: GitHub Actions).

- **Transport.** `src/shared/transports/web-ble/WebBluetoothTransport.ts` — pure (no React Native,
  no ble-plx), written against narrow `WebBluetoothLike` / `WebBt*` interfaces. `pickDevice(bt)`
  (`acceptAllDevices` + `optionalServices: OBD_SERVICE_UUIDS`; must run in a user gesture);
  `connect()` = `gatt.connect()` → first primary service with notify/indicate **and** write →
  `startNotifications()`; no such service → `error` + GATT closed; a disconnect during connect tears
  the half-built link down. Writes in 20-byte chunks (`writeValueWithoutResponse` when allowed, else
  `writeValueWithResponse` / `writeValue`) with the native `LINE_FLUSH` on a partial failure;
  `gattserverdisconnected` → `disconnected` once; `linkInfo` MTU 23 / payload 20.
  `describeWebBluetoothError` turns `NotFoundError` / `SecurityError` / `NotAllowedError` /
  `NetworkError` into plain English; `isWebBluetoothAvailable` / `getWebBluetooth`.
- **Shared GATT facts.** `OBD_SERVICE_UUIDS` → `shared/transports/common/obdServiceUuids.ts`;
  `DEFAULT_ATT_MTU`, `MIN_PAYLOAD`, `LINE_FLUSH`, `payloadForMtu`, `BleLinkInfo` →
  `common/gatt.ts`. Both re-exported from their old homes (`ble/manager.ts`, `BleTransport.ts`).
- **Gating.** `getBleManager()` throws "Bluetooth LE via react-native-ble-plx is not available on
  web"; the Connect screen calls `useBluetoothState(false)` there. `ConnectTarget.webDevice` carries
  the pick so `lastTarget` / auto-reconnect reopen it with no second chooser.
  `connectionService.chooseWebAdapterAndConnect()` (+ `pickWebBluetoothAdapter`,
  `isWebBluetoothSupported`, test seam `setWebBluetooth`); a cancelled chooser leaves the app
  disconnected with "No adapter was chosen…" (no diagnostics panel; a live session is left alone —
  see review fixes). `ui/WebBluetoothConnect.tsx`:
  one **Choose adapter & connect** button + the browser note, or a blocking "not supported in this
  browser" panel with **Use the simulator**. `isAdapterSourceSupported('wifi'|'spp', 'web')` is
  false: Settings hides them and a stored one falls back to BLE with `WEB_SOURCE_FALLBACK_NOTICE`.
- **Persistence.** `persistStorage.ts`: with no document directory (web) `fileStateStorage` uses
  `webStateStorage()` over `localStorage` with the same `bolid.<area>` keys; quota / blocked
  storage → `persist` warning, never a throw; `persistBackend()` reports `file | localStorage | none`.
- **Exports.** `src/shared/lib/saveFile.ts` — `saveTextFile(name, body, mime, { dialogTitle })`:
  Blob + object URL + temporary `<a download>` (URL revoked after 1 s) on web, legacy
  `expo-file-system` + `expo-sharing` on native; `fileStamp()`. `isWebRuntime()`
  (`shared/lib/webRuntime.ts`, "is there a DOM") lets Node-tested shared code branch without
  importing React Native. New `toastStore` + `shared/ui/Toast` (mounted in the root layout) for
  `NOT_ON_WEB_YET`.
- **Expo web target.** `react-native-web` 0.21.2, `@expo/metro-runtime` 56.0.21, `react-dom`
  19.2.3 moved to `dependencies`; `app.json` `web: { bundler: metro, output: single, favicon }`,
  `experiments.baseUrl: "/bolid_tester"`. `npx expo export --platform web --output-dir web-build`
  **succeeds** (3,535 modules, ~6 s warm, 4.7 MB entry bundle). Smoke-tested from the export in
  headless Chrome under `/bolid_tester/`: Connect screen renders with **Choose adapter & connect**,
  a `bolid.settings` seeded in `localStorage` survives a reload, **Connect to simulator** reaches
  Connected and opens Vehicle, no console errors.
- **Deploy.** `.github/workflows/web.yml` (push to `main` + dispatch): Node 24, `npm install
--legacy-peer-deps --ignore-scripts`, export, `.nojekyll`, `upload-pages-artifact@v3`,
  `deploy-pages@v4` (`pages: write`, `id-token: write`, environment `github-pages`); `index.html`
  copied to `404.html` so deep links load the app (review fix).
- **Tests.** `WebBluetoothTransport.test.ts`, `WebBluetoothTransport.session.integration.test.ts`
  (fake GATT over `bridgeToMock`: identify, `010C`, `03`), `persistStorage.test.ts` (web backend
  round-trip, no storage, failures logged, blocked getter, native keeps files), `saveFile.test.ts`,
  `webDegradation.test.ts` (toast, exchange import/export, memory-only AI key),
  `useErrorLogExport.test.tsx` (downloads a `.md`), `Toast.test.tsx`, and web cases in
  `connectionService.test.ts`, `ConnectionScreen.test.tsx`, `SettingsScreen.test.tsx`,
  `settingsStore.test.ts`. Fake: `web-ble/testing/fakeWebBluetooth.ts` (`webDeviceOverBridge`
  notifies in 20-byte `DataView`s at an offset in a larger buffer).
- **Docs.** New `docs/web.md`; `features/connection.md` (Web Bluetooth section),
  `architecture.md` (diagram — the "future" note is now current), `phase2-mobile-app.md` (web
  target), `features/settings.md`, `features/error-log.md`, `features/live-charts.md`,
  `simulator.md`, root `README.md` ("Try it in the browser"), `docs/README.md`, roadmap ✅.
- **Deviations.**
  - Instead of an optional pre-step inside `useConnect().connect()`, a separate
    `useConnect().chooseAndConnect()` → `connectionService.chooseWebAdapterAndConnect()` (keeps the
    native `connect(target)` signature untouched; the chooser still opens synchronously in the
    press handler).
  - The plan migrated five export hooks to `saveTextFile` and gave the other four a toast; this
    migrates **every text export** (error log, DTC report, auto-scan, adapter health, chart CSV,
    measuring log, car backup, garage JSON, bus capture, replay fixture — `useLogFixtureExport` is
    `settings/api/replayFixtureFile.ts`). The toast covers what is not a single text file: vehicle
    report (HTML/PDF via expo-print), history re-share, trip CSV share, full backup / restore,
    profile / label-pack import / export. Side fix: the hooks that used the root `expo-file-system`
    (no `documentDirectory` on this SDK) now go through the legacy entry point.
  - `WebBtCharacteristic` write methods take `Uint8Array` (not `BufferSource`) and the value event
    is a `WebBtValueEvent`, so the core typecheck needs no DOM lib; `getWebBluetooth()` added.
  - Wi-Fi is also unsupported on web (`isAdapterSourceSupported`) with its own fallback notice — the
    plan only listed SPP implicitly.
  - Location: `expo-location` ships a web module (browser geolocation), so the GPS toggle stays on.
  - Local preview serves the export under a `bolid_tester/` folder (the baseUrl), not `npx serve
web-build` directly.
  - `saveFile.test.ts` mocked the native modules with `{ virtual: true }`, which failed in the full
    `npm test` run (the real ESM `expo-file-system/legacy` was loaded); plain `jest.mock` now.
- **Review fixes.**
  - **Alerts did nothing in the browser.** react-native-web's `Alert.alert` is an empty stub, so the
    Error log's Export (a Markdown / JSON chooser) never exported, and every confirm (Clear fault
    codes, Clear error log, Reset all data, delete car / backup / label pack / plugin, OTA prompts)
    and "Export unavailable" notice was a silent no-op. New `appAlert()` (`shared/ui/appAlert.ts`,
    same arguments, forwarded unchanged to `Alert.alert` on the phone) queues the alert in
    `shared/state/dialogStore.ts` on the web, rendered by `shared/ui/AlertDialog.tsx` (mounted in
    the root layout next to `Toast`): any number of buttons, a follow-up alert from a button shows
    next (two-step confirms), tap outside / Escape = Cancel. All 23 `Alert.alert` call sites
    switched; `.eslintrc.cjs` `no-restricted-properties` forbids `Alert.alert` outside the wrapper.
    Tests: `AlertDialog.test.tsx`, and `error-log/ui/ErrorLogScreen.test.tsx` drives the real
    button path on web (Export → Markdown → a `.md` download; Clear → Cancel / Clear all).
  - **Deep links 404'd on Pages.** `output: single` emits only `index.html`; Pages serves a missing
    path's `404.html`, so `web.yml` now copies `index.html` → `404.html` (reloading `/vehicle` or
    `/settings` gets the app). `docs/web.md` and the `app.json` comment no longer claim no rewrite
    is needed.
  - **Cancelled chooser left a stale state.** `chooseWebAdapterAndConnect` only set the error: after
    a failed attempt the status stayed `error` (diagnostics described the old attempt), and while
    connected a red error sat over the live session. Now an idle / `error` state becomes
    `disconnected` + message, and a live or connecting session is left alone with the message as a
    toast. Two new `connectionService.test.ts` cases.
  - **Web discovery only sees listed services.** Chrome hides any service not in `optionalServices`,
    so the web search is not UUID-agnostic like native. `OBD_SERVICE_UUIDS` gains the vendor 128-bit
    service widely reported for the Vgate iCar Pro BLE 4.0 (`e7810a71-73ae-499d-8c15-faa9aef0c3f2`,
    the owner's adapter; unconfirmed until the on-car session — harmless if absent, also used by the
    native already-connected lookup). `docs/web.md` explains the limit and the failure it causes.
- **Second review fixes.**
  - **Two contradicting messages per tap in the browser.** With every alert now visible on the web
    (`appAlert`), the callers of the web guards added their native "unavailable" follow-up after the
    "Not available on web yet" toast. Vehicle report: Share PDF ran the guard twice (PDF, then the
    HTML fallback) and then opened "Share unavailable"; history re-share added "Sharing
    unavailable"; Backup's Back up now / Choose file / export added "see the Error log" (nothing was
    logged) or "needs a newer build"; profile / label-pack import added "needs the file picker" and
    their export "Could not export…". Each caller now stops after the toast when `isWebRuntime()`
    (`ReportScreen` skips the HTML retry on web), so the toast is the one message. Test: a web case
    in `ReportScreen.test.tsx` (one toast, one loader call, no alert).
  - **Cancelled chooser during an auto-reconnect.** The "live session" check covered only
    `connected` / `connecting`; an attempt in `initializing` (or an auto-reconnect between attempts,
    when the status can read `error`) was overwritten with `disconnected` + the chooser message,
    while the web button was still enabled (useConnect idle). Now `initializing` and a running
    reconnect count as live → toast only. New `connectionService.test.ts` case.
  - **Overlapping GATT writes.** `WebBluetoothTransport.write()` ordered chunks within one call but
    not across calls; the ELM327 client fires writes without awaiting them, so a stalled write
    (e.g. a wake that timed out) overlapped the next command, which Chrome rejects ("GATT operation
    already in progress"; ble-plx queues on the phone). Writes now go through a promise-chain queue
    (a failed write does not block the next; reset on teardown so a write hung on a dead link never
    holds up a new connection). Two new `WebBluetoothTransport.test.ts` cases; whether real adapters
    ever stall that long stays with the deferred on-car check.

## Plan 27 — Classic Bluetooth (SPP) transport, Android (2026-11-09)

[Plan 27](./plans/27-bluetooth-spp-transport.md) landed: the cheap "Bluetooth 3.0" ELM327 adapters
(Serial Port Profile) connect on Android through an `SppTransport` behind the same `Transport`
interface, picked from the phone's paired devices, with a one-tap jump to the system Bluetooth
settings; iOS cannot open non-MFi classic accessories, so the option is hidden there and a stored
`'spp'` source falls back to Bluetooth LE. What waits for hardware (the plan's "Deferred" section,
roadmap "on-car pending"): pairing and connecting a real SPP adapter on the owner's phone (name,
PIN, `ATI`, grade into plan 29), and deciding the `ATMA` question — the installed library's Android
source (`DelimitedStringDeviceConnectionImpl`) **does** accept an empty `delimiter` (each read
handed over as-is), so on a real adapter the next step is to try `delimiter: ''`, drop the prompt
re-append and flip `capabilities.monitor`. That mode is undocumented in the README and untested on
hardware, so v1 ships the plan's delimited design.

- **Dependency.** `react-native-bluetooth-classic` **1.73.0-rc.17**, pinned exactly (the package has
  published only release candidates; `latest` is this rc). Autolinked, no config plugin; its
  manifest adds `BLUETOOTH` / `BLUETOOTH_ADMIN` (≤ API 30) and `BLUETOOTH_CONNECT` / `BLUETOOTH_SCAN`
  (API 31+), which `app.json` already declares — nothing added. The API matched the plan's assumed
  surface (`connectToDevice(address, { delimiter, charset })`, `device.onDataReceived`,
  `device.write`, `onDeviceDisconnected`, `getBondedDevices`, `isBluetoothEnabled`) plus
  `createBluetoothEventSubscription` for the per-device disconnect event. Installed with `npx expo install … -- --legacy-peer-deps` (a first plain
  install pulled reanimated / gesture-handler / worklets in as peers; reverted).
- **`Transport.capabilities`** (`obd-core/transport/Transport.ts`): optional
  `TransportCapabilities { monitor: boolean }` (absent = can stream), `canStreamMonitor(t)` and
  `MONITOR_UNAVAILABLE_MESSAGE` ("Bus monitoring is not available over this adapter link").
  `DiagnosticSession.canMonitor` / `Elm327Client.canMonitor`; `startSniffer()` rejects with the
  message **before** sending `ATH1`, and `Elm327Client.startMonitor()` refuses the same way (over
  SPP it would otherwise hold the command queue forever). TP2.0: `Elm327RawCanLink.begin()` checks
  `client.canMonitor` before its first AT command and restores ATCAF1/ATH0/ATS0 + filters itself if
  `startMonitor` fails (`end()` skips the restore when `started` is false), and Module scan replaces
  **Scan gateway (TP2.0)** with `TP20_MONITOR_UNAVAILABLE` on a non-mock link that cannot monitor —
  `scanGateway` refuses before touching the adapter (review fix: the probe used to leave the
  adapter in raw-CAN formatting for the rest of the connection). connectionService's
  adapter-log wrapper (`withLog`) forwards `capabilities`.
- **`src/shared/transports/spp/SppTransport.ts`.** `SppDeviceLike`, `SppModuleLike`,
  `SppModuleLoader`, `BondedAdapter`, `SppTransport(address, loadModule = defaultSppModule)` with
  `capabilities = { monitor: false }`: connects with `{ delimiter: '>', charset: 'ascii' }`,
  re-appends `>` to every delimiter-stripped message, writes ASCII strings; a socket failure →
  `error` with `Could not open the Classic Bluetooth adapter <MAC>: <library error>`; a drop →
  `disconnected` once: the global device-disconnected event for **this** address (others ignored;
  the library sends it only when the ACL link drops), the per-device `DEVICE_DISCONNECTED@<MAC>`
  event (only the RFCOMM socket closed; `createBluetoothEventSubscription`), or a failed write
  (rejection such as "Not connected to <MAC>", or a `false` result — the native connection is
  closed best-effort) — review fix: a socket-only close used to leave the status `connected`, so
  no drop banner or auto-reconnect while every command failed; manual `disconnect()` unsubscribes
  first and emits only `disconnected`; a disconnect during a connect cancels it
  (`SppConnectCancelledError`) and closes the late socket. (Review fix: an "Already connected"
  retry branch was removed — the installed library's `connectToDevice` never rejects that way, it
  resolves with the connection it already holds, which this app always opens with the same
  options.) `listBondedAdapters(load)` (refuses while
  Bluetooth is off; likely adapters first, then by name). `defaultSppModule` loads the module
  through a variable specifier ("Classic Bluetooth is not available in this build…").
- **Name hints.** `ADAPTER_NAME_HINTS` / `looksLikeAdapter` moved to the pure
  `src/shared/transports/adapterNames.ts` (re-exported by `ble/manager.ts`) so the SPP transport
  and its Node tests do not load `react-native-ble-plx`; `elm327` added to the hints.
- **Test fakes / simulator.** `src/shared/transports/spp/testing/fakeSppModule.ts`:
  `FakeSppDevice` (scriptable write result / rejection), `FakeSppModule` (bonded list, radio state,
  global and per-device disconnect events) and
  `sppDeviceOverBridge(bridgeToMock(scenario))`, which re-chunks the simulator's output by `>` and
  strips it like the library — the plan-26 bridge reused, no protocol change.
- **Settings.** `AdapterSource` adds `'spp'`; `isAdapterSourceSupported(source, os)`,
  `setSettingsPlatform(os)` (called with `Platform.OS` from `src/app/_layout.tsx`),
  `SPP_FALLBACK_NOTICE` and the runtime-only `adapterSourceNotice` /
  `dismissAdapterSourceNotice()`. The `merge` rule turns a stored `'spp'` into `'ble'` on a
  non-Android platform and sets the notice, and `onRehydrateStorage` writes that fallback back to
  the file (persist only rewrites after a migration, so the notice would otherwise return on every
  launch — review fix); `setSettingsPlatform` applies the same fallback when hydration already
  ran. No version bump (no shape change). Settings → Developer & simulator →
  Adapter source gains **Classic Bluetooth** only on Android, with a pairing / no-sniffer note
  (`settings-spp`).
- **Connection flow.** `connectInternal`'s SPP branch: a picked target is required,
  `requestClassicBluetoothPermissions()` (new in `ble/permissions.ts`: only `BLUETOOTH_CONNECT` on
  API 31+, no runtime prompt below — review fix: the BLE helper asked for fine location on Android
  ≤ 11, which Classic Bluetooth does not need, and its denial text named the Android 12+ "Nearby
  devices"), `new SppTransport(target.deviceId)`, `wakeAfterIdleMs` as for BLE,
  attempt device `{ id: <MAC>, name: <name> ?? 'Classic Bluetooth adapter' }`,
  `linkStore.kind = 'spp'` (`LinkKind` gains it), `lastTarget` = the target, so auto-reconnect
  replays the MAC. `listPairedAdapters()` and the test seam `setSppModuleLoader(loader?)`.
  `ConnectionScreen` SPP branch (`ui/SppConnect.tsx`, `testID="connect-spp"`): **Paired adapters**
  as `DeviceRow`s, the empty state "Pair the adapter first: Android Settings → Bluetooth → pair
  OBDII (PIN 1234 or 0000), then come back." (`connect-spp-empty`), **Open Bluetooth settings**
  (`Linking.sendIntent('android.settings.BLUETOOTH_SETTINGS')`, `openSettings()` fallback),
  **Refresh**, a list error (`connect-spp-error`) and **Use a Bluetooth LE adapter**; the BLE branch
  gains an Android-only **Using a classic Bluetooth (3.0) adapter instead?** link; the one-time
  fallback notice (`adapter-source-notice`). `hooks/usePairedAdapters.ts` re-reads the list on
  Refresh and when the app returns to the foreground; the foreground re-read only checks the
  permission (`checkClassicBluetoothPermissions()`, `PermissionsAndroid.check`) and
  is skipped while a request is in flight, since closing the permission dialog itself resumes the
  activity (review fix: a denial was asked twice). `DeviceRow`'s button is labelled "Connect
  to _name_".
- **Diagnostics.** Rule 1c — SPP and /socket|read failed|connection refused|service discovery
  failed/i → "The adapter is paired but not reachable" (power-cycle it; no other app such as
  Torque may hold the connection; keep close; re-pair with PIN 1234 / 0000). Stage chip "Classic
  Bluetooth link", Details "Link: Classic Bluetooth (serial port) to <MAC>", report source
  "Classic Bluetooth adapter"; rule 2 (no BLE serial characteristics) now points to the Classic
  Bluetooth source instead of "not supported yet"; rule 4's last suggestion on SPP is to close
  other OBD2 apps.
- **Sniffer.** `useSniffer()` returns `canMonitor`; `SnifferScreen` shows the unavailability
  message and the reason (`sniffer-unavailable`) instead of **Start monitoring**.
- **Tests.** `SppTransport.test.ts` (connect options, prompt re-append, writes, write failure,
  connect failure, module missing, drop for this address only, manual disconnect, disconnect during
  connect, per-device socket-closed event, write rejection / `false` as a drop, reconnect with a
  fresh device, capability, bonded list, Bluetooth off,
  default loader against a virtual module); `SppTransport.session.integration.test.ts`
  (`DiagnosticSession` over the delimiter-chunked Golf: CAN 11/500, VIN, PIDs, `010C`,
  `readDtcs('03')`, sniffer refused with nothing sent); `sniffer.integration.test.ts`
  (`capabilities` undefined → monitoring allowed; `monitor: false` → session and client refuse);
  `settingsStore.test.ts` (platform support, fallback on hydrate written back to the file with no
  other change and absent on the next cold start, late platform, other sources untouched);
  `elmRawCan.test.ts` (begin / probe refuse with nothing sent when the client cannot monitor; a
  failed `startMonitor` restores OBD formatting); `ModuleScanScreen.test.tsx` (TP2.0 explained, no
  Scan gateway button, over SPP); `usePairedAdapters.test.tsx` (resume re-read checks without
  prompting, skipped while the dialog is open, denial not asked twice); `diagnoseFailure.test.ts` (rule 1c, report); `connectionService.test.ts` (connect +
  `canMonitor` through the log wrapper, nameless device, no target / no permission (and never the
  BLE permission), socket failure → diagnosis, drop = link loss, socket-only close = link loss,
  auto-reconnect replays the MAC, paired list); new `ble/permissions.test.ts` (Classic Bluetooth
  asks only CONNECT on API 31+ and nothing below; BLE asks SCAN + CONNECT / fine location);
  `ConnectionScreen.test.tsx` (paired list + connect without a `BleManager`, empty state + Open
  Bluetooth settings + Refresh, Bluetooth off, unreachable adapter diagnosis, source switch, no
  link on iOS, fallback notice); `SettingsScreen.test.tsx` (segment on Android, absent on iOS);
  new `SnifferScreen.test.tsx` (Start over the simulator, notice over SPP).
- **Docs.** connection (§ Classic Bluetooth, UI, hooks, api, linkStore, diagnostics rule 1c / rule
  2, troubleshooting, acceptance), can-sniffer (§ Link capability, flow, acceptance, tests),
  architecture (`SppTransport`, `capabilities`, diagram), adapter-vgate-icar-pro (BLE vs classic vs
  Wi-Fi variants table), settings (segment, note, platform fallback), simulator (SPP bridge
  example), roadmap (✅, on-car pending).
- **Deviations.** `listBondedAdapters` returns `BondedAdapter` (structurally the Connect screen's
  `ScannedDevice`) instead of importing `ScannedDevice` — shared code must not import a feature.
  The "one-time info toast" is a dismissible notice on the Connect screen (the app has no toast
  component). The iOS fallback needs the platform, which `settingsStore` (Node-tested, no React
  Native import) learns through `setSettingsPlatform` rather than `Platform.OS` inside `merge`.
  `Elm327Client.startMonitor()` is guarded too (not only the session). The plan said to reuse
  `requestBlePermissions()`; SPP uses its own `requestClassicBluetoothPermissions()` so Android ≤ 11
  is never asked for location. The Bluetooth radio prompt (`useBluetoothState`) stays
  BLE-only: the SPP list reports "Bluetooth is off" itself, so SPP never constructs a `BleManager`.
- **Not done.** The USB OTG appendix (an optional stretch, "do not schedule before an owner asks").

---

## Plan 26 — Wi-Fi ELM327 transport (TCP) (2026-11-09)

[Plan 26](./plans/26-wifi-tcp-transport.md) landed: Wi-Fi ELM327 adapters (the `WiFi_OBDII` class,
`192.168.0.10:35000`) connect through a `TcpTransport` that implements the existing `Transport`
interface, selectable in Settings as a third adapter source; the ELM client, the session and every
feature are unchanged above it. What waits for hardware (the plan's "Deferred" section, roadmap
"on-car pending"): a real Wi-Fi adapter on Android and iOS (adapter, endpoint, `ATI`, latency grade
into `docs/adapters/` with plan 29), the Android "no internet" behaviour and whether mobile data
must be off (then adjust the Connect-screen copy), and — new — that `react-native-tcp-socket` 6.4.3
runs under the New Architecture (`newArchEnabled: true`, RN 0.85) through the interop layer; if it
does not, only `defaultSocketFactory` changes.

- **Dependency.** `react-native-tcp-socket` 6.4.3 (autolinked, no config plugin). Its API matches
  the plan except the timeout option, `connectTimeout`; `data` arrives as a `Buffer`.
- **`src/shared/transports/tcp/endpoint.ts` (pure).** `TcpEndpoint`, `DEFAULT_WIFI_ENDPOINT`
  (frozen), `parseEndpoint('host:port')` (IPv4 or RFC 1123 host name — an all-numeric name must be
  a valid IPv4 — and a port 1–65535, else null), `formatEndpoint`, `isValidHost`, `isValidPort`,
  `isValidEndpoint`.
- **`src/shared/transports/tcp/TcpTransport.ts`.** `TcpSocketLike`, `TcpSocketFactory`,
  `TcpTransport(endpoint, factory = defaultSocketFactory, connectTimeoutMs = 5000)`.
  `connecting` → `connected` on the socket's `connect`; an `error` / `close` before it, or no
  connect within 5 s, → `error`, socket destroyed, a message naming the address
  (`Could not reach the Wi-Fi adapter at …: <error>` / `No answer from the Wi-Fi adapter at …
within 5 s (ETIMEDOUT)` / `… closed the connection before it opened (ECONNREFUSED)`). After
  connecting, an unsolicited `close` → `disconnected` (once), an unsolicited `error` → `error`, and
  the dead socket's later events are ignored — so `connectionService.watchStatus` handles a Wi-Fi
  drop like a BLE one, auto-reconnect included. `disconnect()` destroys the socket and emits only
  `disconnected`; during a connect it cancels it (`TcpConnectCancelledError`, no `error` status).
  A socket the factory delivers after a timeout or cancel is destroyed, never leaked. String chunks
  → `stringToBytes`, Buffers → `Uint8Array.from`. `defaultSocketFactory` loads the module with
  `import('react-native-tcp-socket' as string)` (absent under Jest / web → "Wi-Fi adapters need the
  TCP socket module…"), opens `createConnection({ host, port, connectTimeout })`, turns Nagle off
  on connect and replays the connect callback to a `'connect'` listener added after it fired.
- **Test bridge.** `src/shared/obd-core/transport/testing/bridge.ts` → `bridgeToMock(scenario)`
  (`{ write, onData, mock }`, not in the core barrel; reused by plans 27 / 28), and the test-only
  `src/shared/transports/tcp/testing/fakeSocket.ts` (`FakeSocket`, `socketOverBridge(bridge)` —
  replies alternate Buffer-like and string chunks).
- **Settings.** `AdapterSource = 'mock' | 'ble' | 'wifi'`; `wifi: TcpEndpoint` (default
  `192.168.0.10:35000`, persisted) and `setWifi(patch)` (an invalid result is ignored);
  `SETTINGS_VERSION` 7 with `migrateSettings` v6 → v7 `wifi: p.wifi ?? DEFAULT_WIFI_ENDPOINT`;
  `merge` keeps the current endpoint when a restored / hand-edited file carries an unusable one.
  Settings → Developer & simulator → Adapter source gains **Wi-Fi adapter**; while selected, host
  and port fields (`settings-wifi`) save every valid pair at once and explain an invalid one
  (`settings-wifi-error`), plus **Use the default address**.
- **Connection flow.** `connectInternal`'s Wi-Fi branch: `new TcpTransport(settings.wifi)`, no
  permission request, `wakeAfterIdleMs` as for BLE, attempt device `{ id: '<host>:<port>', name:
'Wi-Fi ELM327' }`, adapter-log origin `{ source: 'car', deviceId: '<host>:<port>' }`,
  `lastTarget` undefined (auto-reconnect re-reads settings). `setTcpSocketFactory(factory?)` is the
  test seam. `linkStore.kind: 'ble' | 'wifi' | null`. `ConnectionScreen`: a Wi-Fi branch
  (`connect-wifi`: join-the-network panel with the Android _Stay connected_ note, the address,
  **Connect over Wi-Fi**, **Use a Bluetooth adapter**) and `useBluetoothState(adapterSource ===
'ble')`, so neither the simulator nor Wi-Fi constructs a `BleManager`. Diagnostics: rule 1b —
  Wi-Fi and `ECONNREFUSED | ETIMEDOUT | EHOSTUNREACH | ENETUNREACH` (or the text forms / the
  transport's wording) → "The phone is not on the adapter's Wi-Fi network, or the adapter uses a
  different address" (join `WiFi_OBDII`, check `192.168.0.10`:`35000`, mobile data off, iOS Local
  Network); the stage chip reads "Wi-Fi link" (`stageLabel`); the Details show the socket; the
  report names "Wi-Fi adapter".
- **`app.json`.** `ios.infoPlist.NSLocalNetworkUsageDescription`: "Bolid Tester connects to a
  Wi-Fi OBD2 adapter on your local network." (Android needs only `INTERNET`, which Expo's template
  already declares.)
- **Tests.** `endpoint.test.ts`; `TcpTransport.test.ts` (connect, error / close / factory failure
  before connect, 5 s timeout, late socket after a timeout, write, string + Buffer chunks,
  unsolicited close once, unsolicited error, manual disconnect, disconnect during connect,
  reconnect with a fresh socket, `defaultSocketFactory` against a virtual module);
  `TcpTransport.session.integration.test.ts` (`DiagnosticSession` over `TcpTransport` with the
  bridged Golf: `ISO_15765_4_CAN_11_500`, VIN, 16 PIDs, `010C`, `readDtcs('03')`);
  `settingsStore.test.ts` (v7, migration fills / keeps `wifi`, rehydration, invalid stored
  endpoint, `setWifi`); `diagnoseFailure.test.ts` (rule 1b, Wi-Fi wording, report);
  `connectionService.test.ts` (connect over the bridge, refused → diagnosis, fails within 5 s,
  unsolicited close = link loss); `ConnectionScreen.test.tsx` (Wi-Fi branch, no `BleManager`
  unless Bluetooth, network suggestion on a refused connect, source switch);
  `SettingsScreen.test.tsx` (segment + fields, validation).
- **Docs.** connection (§ Wi-Fi adapters, diagnostics rule 1b, linkStore, acceptance), settings
  (source, fields, v7), architecture (transport diagram + `TcpTransport`), simulator (test bridge);
  roadmap item ✅ (on-car pending) and the Connect row of the feature map. Context graph: the builder
  now scans `shared/transports/tcp`; curated concept `wifi-adapter`.

**Deviations.**

- `npx expo install react-native-tcp-socket` also wrote the optional peers it resolves without
  `--legacy-peer-deps` (react-native-reanimated, -gesture-handler, -worklets, @testing-library/dom
  and more) into `package-lock.json`. Reverted, and the same version was installed with
  `npm install react-native-tcp-socket@^6.4.3 --legacy-peer-deps`, the way the lockfile was built:
  it gains only the package and its three dependencies (buffer, eventemitter3, ieee754).
- The library's option is `connectTimeout`, not `timeout`. The factory resolves once the socket
  exists and the transport waits for `'connect'` with its own 5 s timer (which also covers a slow
  module load); the default factory replays a connect that fired before the listener was added,
  and calls `setNoDelay(true)` — none of this was in the plan's sketch.
- A `close` before connecting is an `error` (refused); a `disconnect()` during a connect rejects it
  with `TcpConnectCancelledError` (BLE resolves silently) so `session.connect()` never proceeds on
  a closed socket.
- `linkStore.kind` is `'ble' | 'wifi' | null` (null for the simulator), and `beginAttempt` takes it
  as an optional third argument, before `now`.
- The classifier matches more than the plan's three errno names (ENETUNREACH, "connection refused",
  "no route to host", "network is unreachable", and `TcpTransport`'s own wording), adds an iOS
  Local Network suggestion, skips the Bluetooth-permission rule on Wi-Fi and words rules 4, 7 and 8
  for the Wi-Fi link.
- Added (not in the plan): the `setTcpSocketFactory` test seam; a per-source Connect subtitle with
  **Using a Wi-Fi adapter instead?** / **Use a Bluetooth adapter** buttons (the Wi-Fi segment
  otherwise lives only in the collapsed Developer & simulator section); `setWifi` / `merge`
  validation; **Use the default address**; `isValidHost` / `isValidPort` / `isValidEndpoint`.
- The existing `migrateSettings` tests now expect the `wifi` field on every pre-v7 migration.

**Review follow-ups.**

- `useScan`'s `stop()` (also its unmount cleanup) called `getBleManager().stopDeviceScan()` for
  every source, so leaving the Connect screen in Simulator or Wi-Fi mode still constructed a
  `BleManager` (on iOS that can raise the Bluetooth prompt). `stop()` now touches the BLE stack only
  once `start()` has run. The ConnectionScreen test unmounts before checking the spy, and a
  remount in Wi-Fi mode stays BLE-free too.
- `WifiEndpointSection` copied the stored address into local state once, at mount. A change made
  elsewhere while it stayed mounted (a restore from Backup, pushed on top of Settings) left stale
  text in the fields, and the next keystroke saved the stale other field over the restore. The
  fields now follow the stored address whenever it changes to something they did not just save
  (new SettingsScreen test).

---

## Plan 21 — Tablet and landscape layout (2026-11-09)

[Plan 21](./plans/21-tablet-layout.md) landed: on windows ≥ 600 dp the app uses the space — a side
tab rail, Live as gauges | values, Charts with measured plots two per row, two-column More and
Vehicle lists, and every `Screen` capped at a centred 1100 dp column. Portrait phones are unchanged.
What waits for hardware: the plan's Acceptance checks on a Pixel Tablet emulator / real tablet and
a phone in landscape (pinch / pan / tap on a 600 dp panel, the Server URL input with the keyboard
open), recorded as "device pending" on the roadmap. The Android half of the keyboard check is
open: `automaticallyAdjustKeyboardInsets` is iOS-only and the app runs edge-to-edge on Android
(Expo 56 / RN 0.85; RN's `ReactRootView` only reports IME insets as keyboard events), so whether
`adjustResize` still shrinks the window is unverified. Procedure: Android phone in landscape →
Settings → focus Server URL; if the field ends up under the keyboard, give `Screen` an Android
keyboard path (e.g. a `KeyboardAvoidingView` with the header height as `keyboardVerticalOffset`).

- **Layout classes (`src/shared/ui/layoutClass.ts`, pure).** `classify(width)` → `compact` < 600,
  `medium` 600–839, `expanded` ≥ 840 (Material 3 window-size classes; Tamagui v3 has no 768 edge),
  `layoutInfo`, `isTwoPane` (not compact), `usesSideRail` (expanded, or medium in landscape, and
  the window at least `railMinHeight(fontScale)` tall — ~555 dp at font scale 1: the navigator's
  rail is a non-scrolling column, so 7 tabs × ~69 dp must fit or Settings / More fall off-screen),
  `CONTENT_MAX_WIDTH = 1100`. `useLayoutClass()` (`useLayoutClass.ts`) feeds it from
  `useWindowDimensions()`. All exported from `@/shared/ui`.
- **Screen.** Padding 16 → 24 on medium / expanded; content wrapped in a centred `YStack`
  (`testID="screen-content"`) capped at 1100 dp unless the new `wide` prop is set (Live, Charts, the
  bus sniffer); `automaticallyAdjustKeyboardInsets` on the `ScrollView` (iOS keyboard; Android
  unverified, see above).
- **Side rail.** `_layout.tsx`: `tabBarPosition: 'left'`, `tabBarVariant: 'material'`,
  `tabBarLabelPosition: 'below-icon'` and a right border on the rail; the phone bar keeps
  `'bottom'` / `'uikit'` and no label position (the navigator throws on `below-icon` + `uikit` on a
  side, and on `material` at the bottom — both combinations avoided).
- **Live.** Two-pane on non-compact: the row (`live-row`) measures itself with `onLayout` (window
  minus padding until the first layout) and `live-data/model/twoPaneGrid.ts` (pure) sizes it —
  `live-left` is 45 % of the measured row, at most 360 dp (gauges, then the fuel-economy card), and is
  dropped when empty (every gauge hidden, no fuel economy); `live-right` holds the value cards (or the
  Customize list), each given an exact `ValueCard width` (new prop; replaces the 150 dp minimum) for
  as many ≥ 150 dp cards per row as fit, at most 3 on expanded / 2 on medium. Review fix: the first
  cut used 45 % of the _window_ and fixed `31%` / `48%` flex bases with `minWidth 150` and no grow, so
  on an 800 × 600 window with a rail (card column ~296 dp) or a 640 × 360 phone each card was forced
  to 150 dp and sat alone with half the row empty, and an all-hidden gauge column stayed as an empty
  270–360 dp strip. Gauges 180 dp on expanded. The switch and Customize toolbar stay on
  top; All sensors unchanged.
- **Charts.** Geometry extracted to `live-charts/api/chartGeometry.ts` (`toScreen(pts, w, h)`,
  `msPerPx`, `chartHeight` = 3 : 8 capped at 220, `DEFAULT_CHART_WIDTH` 320). Each panel measures its
  plot with `onLayout` (`testID="chart-plot-<id>"`); the `PanResponder` reads the width from a ref.
  Non-compact: panels in a wrap grid (`chart-panels-grid`, `flexBasis 49%`); panel buttons wrap.
  Compact and two-pane render the same element tree (the wrapper only flips row / column), so a
  rotation does not remount the panels and drop their zoom / pan / inspect state.
- **Lists.** New `CardGrid` (`src/shared/ui/CardGrid.tsx`): one column on compact, two (`49%`
  cells, `<testID>-cell`) otherwise — used by every More section (`more-grid-<section>`) and the
  garage / built-in profile cards (`garage-grid`, `profiles-grid`).
- **Test harness.** RN's jest mock reports a 750 dp ("medium") window, so `jest.setup.ui.ts` now
  mocks `react-native/Libraries/Utilities/useWindowDimensions` with `test/mocks/window.ts`
  (default 390 × 844 phone; `setMockWindow`, `TABLET_WINDOW`; reset in `resetStores`). The stand-in
  `Tabs` records `lastTabsScreenOptions`.
- **Tests.** `classify.test.ts` (360 / 599 / 600 / 839 / 840 / 1280, landscape, two-pane, rail;
  no rail at 640 × 360, 780 × 360, 915 × 412 or 932 × 430; larger font scales need more height),
  `chartGeometry.test.ts` (x spans `[0, w]`, y `[0, h]`, `msPerPx`, `chartHeight`),
  `Screen.test.tsx` (cap, padding, `wide`, keyboard insets), `RootLayout.test.tsx` (bottom bar on a
  phone, a medium portrait window and a landscape phone (760 × 360, 915 × 412); rail on a tablet and
  an 800 × 600 medium landscape window),
  `DashboardScreen.test.tsx` (`live-left` / `live-right` at 1280 and 760 × 360, Customize in the right
  column, `live-left` 266 dp / 150 dp cards at 640 × 360, 302 dp / 172 dp cards on a measured 672 dp
  row, one full-width card in a 290 dp column, 2 then 3 per row on expanded, no `live-left` with every
  gauge hidden, neither at 390), `twoPaneGrid.test.ts` (column / card widths), `ChartsScreen.test.tsx` (320 × 120 until measured, then 400 × 150 and
  600 × 220; grid on a tablet, stacked on a phone, panels stay mounted across a rotation), `MoreScreen.test.tsx` and
  `VehicleSelectScreen.test.tsx` (two-column cells on a tablet, none on a phone).
- **Docs.** architecture § UI ("Layout classes"), live-data, live-charts ("Layout"), more,
  vehicle-select, testing (`mocks/window.ts`); roadmap item ✅ (device pending) and the Live row of
  the feature map (fuel presets and the grouped view shipped with plan 07, tablet two-pane now).

**Deviations.**

- The pure breakpoints live in `layoutClass.ts` (the hook in `useLayoutClass.ts` re-exports them) so
  `classify.test.ts` runs under the `core` Jest project without React Native.
- A Pixel 7 in landscape (915 dp) is **expanded** by width, not "medium" as the plan's Simulator
  note says; it gets the same two-pane layout (plus 180 dp gauges) but keeps the bottom bar.
- The plan puts landscape phones (medium + landscape) on the side rail. The rail also requires the
  window height to hold all seven tabs (`railMinHeight`), because expo-router's rail neither
  scrolls nor shrinks its items: on a 360–430 dp tall phone Settings and More would sit off-screen.
  So in practice the rail is for tablets; a phone on its side keeps the bottom bar.
- **Add panel** already existed (plan 14's picker, `addPanel` → `p3`, `p4`, …), so no second
  "next unused PID" button was added; tablets add panels through the picker.
- The phone bar gets no `tabBarLabelPosition` (the plan floated `'beside-icon'` with a question
  mark); it keeps today's platform default, so portrait phones are unchanged. Only the rail sets
  `'below-icon'`.
- The optional three-column Faults layout was not built (optional in the plan; the DTC rows are
  not stretch-safe in a third of the width).
- The plan's Dashboard test mocks `useWindowDimensions` per test; here a shared default-phone
  double (`test/mocks/window.ts`) does it for every UI test, because RN's 750 dp default would
  otherwise switch every existing screen test to the medium layout.

---

## Plan 16 — Per-car timeline (2026-11-09)

[Plan 16](./plans/16-per-car-timeline.md) landed: **History is now the per-car timeline** — one
chronological view that merges AI runs, fault-code checks, saved module scans, trips, maintenance
entries, coding backups and generated reports, grouped by day, filterable by car, kind and text,
with deep links. Same slice, same `/history` route, title "History", subtitle "Everything that
happened to this car". The plan has no deferred section, so nothing waits for the car.

- **Pure merge (`src/shared/lib/timeline.ts`).** `TimelineKind` / `TimelineItem` / `TimelineDay` /
  `TimelineFilter`, `TIMELINE_KINDS`, `timelineId`, `mergeTimeline` (flatten, filter by kinds /
  car / inclusive time window / case-insensitive text over title + subtitle, dedupe by id with the
  first winning, stable sort newest first), `groupByDay` (local calendar day, newest first),
  `summarizeTimeline` (every kind counted). No state or feature imports.
- **Adapters (`features/history/api/timelineSources.ts`, pure).** `fromHistory`, `fromScans`,
  `fromTrips`, `fromMaintenance`, `fromBackups` with the plan's title / subtitle / tone / link
  table: AI "AI diagnosis · healthy / needs attention / urgent" toned by verdict; fault-code checks
  bad with the MIL on, warn with any code; scans "Auto-scan · n faults" warn on faults, linking
  `/module-scan?after=<id>&before=<previous scan of the same car>`; trips "Trip · 23.4 km" (one
  decimal) to `/trip-detail?id=`; maintenance "Service: <item>" (unknown item → "Service") to
  `/maintenance`; backups "Coding backup · n modules" to `/coding`; reports "Report (PDF)" with the
  section titles. Trips are capped at the newest 500 (`MAX_TIMELINE_TRIPS`).
- **`hooks/useTimeline.ts`** reads the history, scan, trip, maintenance and coding-backup stores and
  the garage, maps maintenance buckets to their car (`maintenanceVehicle`: `vin:` → the garage car
  learned with that VIN, `id:` → that profile, the parked `legacy:v1` bucket skipped) and trips by
  `tripCarKey` + header VIN, named like the Trips screen (`carLabel`: "Removed car" /
  "Unknown car").
- **Report re-share (`features/history/api/reportFile.ts`).** `reshareReport(entry, mods)` →
  `shared` / `missing` / `unavailable`: checks `<documentDirectory><fileName>` with `getInfoAsync`,
  opens the share sheet with the format's MIME type, logs a failing share as
  `history/reshare-report`; `loadReshareModules` uses the variable-specifier imports.
- **Scan compare deep link.** `CompareSection` (now exported) takes `initialBeforeId` /
  `initialAfterId` and re-seeds when they change; `ScanHistorySection` reads
  `useLocalSearchParams<{ before, after }>()` and, once the pickers have them, clears the params on
  its route (`navigation.setParams`) so the same link works again after a manual change.
- **`AiReportView`** (`ai-diagnose/ui/AiReportView.tsx`, exported from the slice's `index.ts`): the
  overall banner, finding cards (with guides), the actions as a read-only list and the disclaimer.
  `OverallBanner`, `FindingCard`, the severity / verdict tables and `ACTION_ICON` moved there from
  `AiDiagnoseScreen.tsx`, which now imports them (no behaviour change on the Diagnose screen).
- **HistoryScreen rewrite.** Car chips across every source (falling back to "All cars" when the
  chosen car has nothing left), multi-select kind chips with counts (All · AI · Faults · Scans ·
  Trips · Service · Backups · Reports), a **Filter** input, day headers, compact rows (kind icon,
  tone bar, time, the car while several are listed, chevron when tappable, an accessibility label
  and button role). Taps: links via `router.push`, AI rows open the saved report in a sheet,
  report rows re-share or alert "File no longer on device". **Export** (the listed fault-code
  checks as Markdown) stays; **Clear** clears `historyStore` only and says scans, trips, service
  entries and coding backups are kept. Per-filter empty states.
- **More.** The History row's subtitle reads "Timeline of diagnoses, scans, trips, service and
  reports" (keyword `timeline`).
- **Tests.** `timeline.test.ts` (sort, dedupe, each filter, local-midnight split, counts),
  `timelineSources.test.ts` (tone rules, the previous same-car scan as `before`, trip km with one
  decimal, maintenance names, TP2.0 counts, backups), `reportFile.test.ts` (re-share, missing,
  unavailable, failure log, the loader), `HistoryScreen.test.tsx` rewritten (all seven sources on
  one day in order, day headers, kind / car / text filters, scan / trip / maintenance / backup
  links, the AI sheet, report re-share, Export, Clear keeping the other stores, empty state) and
  the new `ScanHistorySection.test.tsx` (default pair vs the deep-linked pair showing the cleared
  fault, params consumed).
- **Docs.** [history](./features/history.md) rewritten as the timeline spec (sources table, cars,
  filters, deep links, what Clear deletes, the simulator walk-through),
  [module-scan](./features/module-scan.md) (`before` / `after` route params),
  [ai-diagnose](./features/ai-diagnose.md) (`AiReportView`),
  [architecture](./architecture.md) (history as the fourth composition slice),
  [engine-host](./features/engine-host.md#the-composition-rule) (history's feature imports), the
  roadmap (✅). Context graph: concept `per-car-timeline` added, `diagnostic-history` refreshed
  (it still said "unlimited retention"), graph rebuilt.
- **Deviations.**
  - Plan 06 had already landed, so maintenance uses the per-car buckets (`byVehicle`) instead of
    the plan's interim "all entries under the selected car"; `fromMaintenance` takes one bucket's
    entries plus its car, and the hook resolves the bucket key to the car.
  - `fromTrips(trips, labelFor)` calls `labelFor(carId, vin)` with `tripCarKey(trip)` (the plan-06
    `vehicleId`, else `header.profileId`) rather than the bare `header.profileId`; the key is
    `historyVehicleKey({ id: carId, vin: header.vin, label })` as planned.
  - Trip title falls back to the GPS distance, then to plain "Trip", when the OBD distance is null
    (the plan assumed a number). Scan counts include TP2.0 modules and faults on pre-UDS cars.
  - The report re-share lives in the history slice (`api/reportFile.ts`, its own small MIME map)
    instead of importing the report slice, so "nothing imports the report slice" stays true.
  - `AiReportView` takes `{ report, profileId, ranAt }` and is a new file rather than an export of
    the screen's internal `ReportView` (whose Clear / Re-run / follow-up props do not apply to a
    saved run).
  - The scan-compare params are cleared after use (`navigation.setParams`), as the AI screen does
    for `focus`, so a repeated link re-seeds the pickers on the hidden tab that stays mounted.
  - The plan's simulator walk-through is a manual check (documented in the history spec); the
    automated coverage seeds the seven stores directly in `HistoryScreen.test.tsx` and drives the
    deep-linked compare in `ScanHistorySection.test.tsx`. No new adapter command, so
    `MockTransport` is unchanged.
- **Review follow-ups.**
  - A compare link that carries only `after` (a car's first scan) no longer leaves Before at the
    default `scans[1]` or at a stale earlier pick (which could be another car's scan or the After
    scan itself): `CompareSection` seeds Before with `baselineFor(scans, after)`, the same car's
    previous scan, else leaves it empty and says "No earlier scan of this car — pick a baseline
    above."; one effect re-seeds both pickers per link. Tests: After-only to a later scan, a car's
    first scan, and a second link on the still-mounted section.
  - The scan row's "{answered}/{total} modules answered" leaves out UDS results `skipped` (a full
    scan keeps every TP2.0 module a second time as a skipped UDS result) and TP2.0 modules the
    gateway lists as `not-installed`, so a pre-UDS car no longer counts modules twice or counts
    unfitted ones (`timelineSources.test.ts`, rule in history.md).
  - `AiReportView` / `FindingCard` take an optional `onNavigate`, passed to the fault guide's
    `GuideLinks`; History's AI sheet passes its close, so "Related data" / "Open routine" close
    the sheet before navigating (as `DtcDetailSheet` does). Tested in `HistoryScreen.test.tsx`.
  - Export now has a real test: it presses Export and checks the file stem
    `bolid-fault-history` and the Markdown body (title, only the listed car's checks) handed to
    `useDtcExport().exportReport` (mocked; its file / share path is the Faults screen's).

---

## Plan 07 — Information architecture and metric only (2026-11-09)

[Plan 07](./plans/07-information-architecture.md) landed: More is a grouped, searchable hub with
the Workshop tools marked experimental; Settings puts user preferences first and the developer /
simulator controls in a collapsed section (with **Show hints again** and **Reset all app data**);
the dead imperial path is deleted (metric only); the Sensor readings screen is folded into the
Live tab as **All sensors**; the dashboard starts from a per-fuel preset. The plan has no deferred
section, so nothing waits for the car.

- **More (`more/model/sections.ts`, pure).** `MoreEntry` / `MoreSection` / `MORE_SECTIONS` in five
  sections — Diagnose (Diagnose (AI), Used-car inspection, History, Vehicle report, Sensor tests),
  Drive (Charts, Performance, Trips, Alerts), Ownership (Maintenance log, Battery & charging, DPF /
  regen, VIN decoder, Notifications), Workshop 🧪 with its blurb (Module scan, Adaptations,
  Routines & output tests, Coding, Service reset, Bus sniffer — all `experimental: true`) and Tools
  (Adapter health, Backup & restore, Error log, Check for updates as an action row) — plus
  `entryKey`, `entryMatches` and `filterSections`. `MoreScreen.tsx`: a **Search tools…** input,
  section headers, a yellow **experimental** chip on Workshop rows (". Experimental" appended to
  their label), "No tools match …" for an empty result; the lucide icons map from `IconName` in
  the UI file so the model stays node-testable.
- **Settings.** In order: **General** (theme, "Units are metric …"), **Connection**
  (auto-reconnect, poll interval, recognise my cars by VIN), **AI assistant**, **Notifications** (a
  row opening `/notifications`), **Data**, **Developer & simulator** (collapsed on open: adapter
  source, simulated vehicle, injected DTCs, simulator test controls, the adapter log with the
  replay-fixture export, **Show hints again** → `useOnboardingStore.getState().reset()`, **Reset
  all app data**) and **About** (version, build when `app.json` has `expo.extra.build`, privacy
  policy, **Documentation (GitHub)** → `DOCS_URL`). The old "Developer (simulator)" block is now
  "Simulator test controls" inside the section.
- **Reset all app data (`backup/api/resetAppData.ts`).** Two `Alert.alert` confirmations, then
  Settings tears the connection down with `connectionService.resetForRestore()` (it invalidates a
  connect still in flight, so no session built for the old adapter source is published after the
  reset, and logs a failing close instead of aborting) and `resetAllAppData()` puts **every** persisted store back to its initial
  state and removes its file: settings, garage, vehicle, code book (`bolid.loginBook`), label
  packs, history, maintenance, trips, scans, coding backups, dashboard layout, alerts,
  notifications, onboarding, the backup list, the security-access plugin index and the error log
  (last, so a problem logged while clearing survives). The AI keys leave the keystore (new
  `forgetAllApiKeys` in `settingsStore`), the in-memory results (fault codes, inspection, battery,
  AI diagnosis, module scan / discovery, DPF, adapter health) and the adapter log are cleared, and
  the app's own files those stores point at are deleted (`seedkeys/`, `backups/`, each
  `trip-<id>.csv`); a file that cannot be deleted is reported and logged (`settings/reset`) while
  the stores are reset anyway.
- **Metric only.** `shared/lib/units.ts` and `units.test.ts` deleted; `UnitSystem`, `units`,
  `setUnits` and the `units` key gone from `settingsStore` (now **v6**: `migrateSettings` drops a
  stale `units` key, and `merge` drops it from a v6 file too); `DashboardScreen` renders decoded
  values and units directly (`FuelEconomyCard`, `GaugeItem`, the value cards); the Trips test no
  longer sets the field. `grep -rn "UnitSystem\|imperial\|displayUnit\|convertValue" src` is empty. The
  drive-cycle steady-cruise step no longer adds "(50 mph)", and the
  [performance-tests](./features/performance-tests.md) spec drops its mph target, unit setting and
  1 ft rollout (the code never had them; drag distances are given in metres) — review fixes;
  `grep -rni "mph\|°F\|miles" src` (tests excluded) is empty.
- **Live → All sensors.** `DashboardScreen` has a **Dashboard | All sensors** switch (tabs). The
  sensor view is `live-data/ui/SensorGroups.tsx` (moved from `SensorReadingsScreen.tsx` with its
  `GROUPS`, the injection-DID block and its run-id guard; error source now `live-data/sensors`). It
  calls `useLiveData()` with no list (the whole effective set) while the dashboard view registers
  nothing; switching back restores the dashboard's explicit registration. Deleted:
  `src/features/sensor-readings/`, `src/app/sensor-readings.tsx`, the hidden route in
  `_layout.tsx`, the More entry and `docs/features/sensor-readings.md` (no alias added to
  `featureDocsSync.test.ts`).
- **Dashboard presets.** `presetFor(fuel)` in `dashboardLayout.ts`: the RPM / speed / coolant
  gauges, then diesel boost `010B`, oil temp `015C`, MAF `0110`, fuel rate `015E`, voltage `0142`;
  petrol fuel trims `0106` / `0107`, timing `010E`, MAP `010B`, MAF `0110`, voltage `0142`, fuel
  level `012F`; hybrid the petrol set with the voltage first; anything else `EMPTY_LAYOUT`. Applied
  while a car has no saved layout; `toggleHidden(profileId, id, base)` starts from the preset so
  the first hide keeps its order, and **Reset** returns to it.
- **Maestro.** `.maestro/simulator-smoke.yaml` scrolls to and taps **Developer & simulator**
  (case-insensitive, the header is upper-case on Android) before **Simulator (no car)** — the line
  plan 10 left for this plan.
- **Docs.** [more](./features/more.md) (sections, search, experimental chip, 25 hidden routes),
  [settings](./features/settings.md) (order, metric only, Developer & simulator, the stores Reset
  clears, About, v6), [live-data](./features/live-data.md) (All sensors, presets by fuel, metric
  only, tests), [backup](./features/backup.md) (where the reset lives),
  [phase2 map](./phase2-mobile-app.md) and the [docs index](./README.md) (33 slices),
  [engine-host](./features/engine-host.md), [error-log](./features/error-log.md),
  [testing](./testing.md), the root README, the roadmap (both plan 07 items ✅). Context graph:
  new `concept:metric-only`; `concept:sensor-monitoring` now relates to `feature:live-data`; the
  `app-settings` and `fuel-economy-units` concepts no longer mention a units setting.
- **Tests (+30 tests net: 1554 tests / 177 suites).** `sections.test.ts` (new: five sections in order; every hidden
  route in exactly one section except `/extended` and `/trip-detail`, and the hand-kept list equals
  the routes parsed from `_layout.tsx`; only Workshop rows experimental; unique keys; `dpf` → only
  DPF in Ownership; `cod` → only Coding in Workshop; keywords, case, multi-word; empty query →
  all), `MoreScreen.test.tsx` (five sections; the chip on the six Workshop rows; search filters —
  the plan 10 deferral), `resetAppData.test.ts` (new: the reset list equals every `persist(` store
  named `bolid.*` in the source — none missed; a populated app comes back fresh with no store file,
  no keystore key and the three kinds of app files deleted; the exports' staging copies deleted
  but not the store files, hidden or directory entries (`isExportFile`); a failed delete or a
  failed directory listing is reported and the stores still reset; no file system),
  `test/app/SettingsRoute.test.tsx` (new: the route wires Reset all app data in), `SettingsScreen.test.tsx` (section order and **Developer &
  simulator collapsed** — the plan 10 deferral; Notifications row; metric line; Show hints again,
  also bringing back a first-run card whose steps are all done (rendered beside Settings);
  Reset all app data through both confirmations back to the real adapter with no garage or
  history, and hidden without a reset action; the documentation link; the existing tests open the section first),
  `dashboardLayout.test.ts` (`presetFor`: diesel `010B` before `0106`, petrol includes and leads
  with `0106`, LPG = petrol, hybrid voltage first, unknown fuel → `EMPTY_LAYOUT`, nothing hidden),
  `DashboardScreen.test.tsx` (the All sensors segment and its registration; a petrol garage car
  with no saved layout leads with the fuel trims), `SensorGroups.test.tsx` (the moved screen
  tests), `settingsStore.test.ts` (v6; no `units` in state, partialize or file; v5 → v6 drops it).
  `units.test.ts` is deleted with its module.
- **Deviations.**
  - The current More had three entries the plan's table predates — **Vehicle report**, **Sensor
    tests** (both in Diagnose) and **Backup & restore** (Tools) — and the hidden routes now include
    `/trip-detail` (reached from Trips), so the test's exception list is `/extended` and
    `/trip-detail` (25 hidden routes, 23 in More).
  - Search matches **word starts**, not substrings: with substrings `cod` would also find "Decode
    the VIN" and "fault-code", which the plan's own acceptance rules out. For the same reason two
    subtitles changed: History "Past diagnoses, fault reads and reports", Routines "Basic settings,
    actuator tests, forced regeneration" (it said "DPF regen", which made `dpf` match two rows).
  - Settings keeps the sections the plan did not know about: **Recognise my cars by VIN** joins
    Connection and **Data** (backup, label packs, security plugins) sits between Notifications and
    Developer & simulator. The adapter log moved into Developer & simulator.
  - **Reset all app data** clears every persisted store (17, incl. the backup list, code book,
    label packs and plugin index the plan's list predates), not only the 12 listed, and also the AI
    keys and the app's own files; it lives in `features/backup` (the composition slice that already
    imports every store). Settings adds no feature → feature import (review fix): the route
    `src/app/settings.tsx` passes `resetAllAppData` in as the screen's `resetAppData` prop (no
    prop, no button; `test/app/SettingsRoute.test.tsx` checks the wiring), and the dismissed-hints
    store moved to `src/shared/state/onboardingStore.ts` (the onboarding slice's `index.ts`
    re-exports it; the slice and `test/resetStores.ts` import the shared path, no re-export file
    is left under `model/`) so **Show hints again** reads a shared store. Settings' only cross-feature import stays
    `features/connection`, as [engine-host](./features/engine-host.md#the-composition-rule) lists.
  - The reset also deletes the staging copies the exports leave in the document directory (review
    fix): it lists the directory and deletes every top-level `.json` / `.csv` / `.txt` / `.md` /
    `.html` / `.pdf` file except the stores' own `bolid.<store>.json` and hidden entries
    (`isExportFile`) — coding snapshots, reports, CSVs, captures, fixtures, garage / profile /
    label-pack exports — so a reset leaves what a fresh install has. Copies the share sheet handed
    to other apps are outside the sandbox and stay; the confirmation says so.
  - **Show hints again** brings the first-run card back even when its three steps are already
    done this session (review fix): `FirstRunCard` used to dismiss itself whenever every step was
    done, so after the reset it re-dismissed at once for a user who had picked a car, connected
    and read faults. It now auto-dismisses only on the change to complete it sees while mounted
    (a ref of the previous render's state), so a replayed card shows the steps ticked and stays
    until the user closes it; after a restart nothing is done yet (`dtcStore` is in-memory), so
    first use is unchanged.
  - Hints that sent the user to "Settings → Adapter source" / "Settings → Simulator (no car)" now
    name the collapsed section (review fix): the Bluetooth-LE-unsupported suggestion
    (`diagnoseFailure.ts`), the Bluetooth prompt, the root README, testing.md's Maestro line and
    the connection, simulator, AI-diagnose and vehicle-select docs say **Settings → Developer &
    simulator → …**.
  - Write-flow in-memory state (coding, adaptations, routines: unlock flags and in-session
    before-write backups) is not reset; it holds no saved results and is re-read per car.
  - Store files are cleared with `persist.clearStorage()` **after** `setState(getInitialState(),
true)`, so memory is fresh too; the reset write that may race the removal can only leave the
    defaults on disk.
  - `presetFor` maps LPG to the petrol set (an LPG car is a petrol engine); the preset is an order
    only (nothing hidden), so a supported PID the preset does not name still shows after the named
    ones. The "All sensors" view is local state, not persisted per profile (the plan made that
    optional).
  - `settingsStore` goes to **v6** for the `units` drop (a v5 file is not migrated otherwise).
  - Plan 01's "move vehicleStore into shared/state" was already done by the plan 06 review
    (`src/shared/state/vehicleStore.ts`, the vehicle-select path re-exports it); nothing to move.
    The files this plan touched now import the shared paths (`vehicleStore`, `activeProfile`).
  - About shows a build line only when `app.json` has `expo.extra.build` (it has none; CI stamps
    the native `versionCode`), read from `app.json` like the version rather than through
    `expo-constants`, which is not a direct dependency.

---

## Wave 2 follow-ups — review hardening for plans 02, 06, 15, 25 (2026-11-09)

A small hardening pass (plan W2, kept outside the repo) for what independent reviewers left open
after wave 2. Each item was checked against the current code first: several were already partly
fixed by the wave-2 review commits, so the work below is what was still missing. No roadmap item
(the pass has none) and nothing deferred to the car.

- **Flaky UI tests / no work outliving a session (item 1).** Root cause, not just the two suites:
  `DiagnosticSession.disconnect()` only _detached_ the ELM327 client, so a command in flight kept
  its 5 s timeout timer and every queued command still went out (the client re-attached itself on
  the next write) — and `MockTransport` kept answering after `disconnect()`. A screen's mount reads
  (the DPF screen's Mode 22 refresh, a backup panel's re-compare) could therefore run on after the
  test's teardown, time out, log after the test and keep a worker alive (the full run's "A worker
  process has failed to exit gracefully" is gone). Now `Elm327Client.close()` (called by
  `DiagnosticSession.disconnect()`) rejects the command in flight and every queued one at once with
  the new `Elm327ClosedError` ("ELM327 link closed"), clears the timer, ends a drain or monitor
  mode and refuses later commands before they write; `connect()` on the same session `reopen()`s
  it. `MockTransport.write` rejects while disconnected, like `BleTransport`. EngineHost's poll loop
  does not log `Elm327ClosedError` (the session is gone, not faulty). Tests: the coding-backup
  tests wait for the shared work gate after **Create backup** (its `finally` releases the gate
  after the save) and in an `afterEach`; the raised `jest.setTimeout(20_000)` is removed (each test
  takes 1–1.6 s under a full parallel run, so the default 5 s applies) and the `waitFor` bounds
  drop from 8 s to 4 s; the DPF wait drops to 4 s.
- **Replay export provenance (item 2).** A source switch already cleared the adapter log (plan 18
  review), but `adapter` / `protocol` / the simulated car were still read at export time — gone
  after a disconnect, wrong after picking another simulated car. The log now records how it was
  recorded: `AdapterLogOrigin` (`source`, `simulatedVehicleId`, `deviceId`, `adapter`,
  `protocol`, `vin`) in
  `shared/state/adapterLog.ts` (`beginAdapterLogRecording`, `noteAdapterLogLink`,
  `adapterLogOrigin`, published as `useAdapterLogStore`'s `origin`). `connectionService` stamps it
  before a connect's first command (the BLE device id on the car) and adds the link details on
  success; a connect to another source, simulated car or BLE adapter — or onto traffic no connect
  stamped — clears the log first, and a reconnect on the same adapter that reaches another car
  (another VIN, or another protocol when a VIN is missing) drops the earlier car's traffic once it
  succeeds (the log tracks where the latest connect began), so a fixture never mixes two
  recordings. A failed connect to another car on the same adapter is the one case left: its
  few init lines stay in the log (nothing identifies the car before the connect succeeds). Settings' **Clear** (the documented step between two flows) drops
  only the entries (`clearAdapterLogEntries`) and keeps the origin, so a flow recorded on the live
  session after a Clear is labelled by that session even when another simulated car is picked
  meanwhile; a source switch / restore resets both (`clearAdapterLog`). Settings' export labels
  the fixture from the origin and falls back to the current settings only for an unstamped log.
- **Fixture check coverage (item 3).** The wrong-expectation test now gives **every**
  `ReplayFixtureExpect` key a wrong value at once (typed `Required<…>`, so a new key does not
  compile until it is covered) and requires one failure per key — `pendingDtcs` and
  `freezeFrameCount` included.
- **vehicle-docs-sync rules (item 4).** Both rules are one pure function,
  `vehicleDocValidationProblems(markdown, expectedProtocol, carFixtures)` (`validatedOn.ts`); the
  sync test runs it on every real doc and on synthetic CRLF docs that break the
  `observedProtocol == expectedProtocol` rule, the fixtures ↔ "Validated on the car" rule both
  ways, and a doc with no section (every broken rule reported at once).
- **Garage store (item 5).** `sanitizeLearned` (now exported) rebuilds the nested `learned` block
  field by field: dropped for an unknown protocol (not a `ProtocolId`), a missing / non-string
  `supportedPids`, a VIN / calibration id of the wrong type or a non-numeric `learnedAt`; a missing
  VIN / calibration id is repaired to null, a non-string adapter version and unknown fields are left
  out, and `sanitizeGarage` stores the rebuilt block. A new test runs the persist `merge` directly
  (file's cars first, deduped by id, cars added meanwhile appended, non-user records and bad
  `learned` blocks dropped, a non-garage file keeps memory) next to the existing rehydration test.
- **Report "last connection" (item 6).** `collectReportSources` already took the newest of the
  printed sections' times; a new test pins each source of it offline — the in-memory fault read's
  `lastReadAt`, the battery and inspection `ranAt` — and that it is null while connected.
- **Capture analyzer (item 7).** `tp20PairChannels` infers a TP2.0 channel pair when the `D0`
  setup was trimmed off: at least `TP20_MIN_PAIR_MATCHES` (2) exchanges where one id's next frame
  within `TP20_PAIR_WINDOW_MS` (200 ms) answers the other's the TP2.0 way (a data frame waiting
  for an ACK and the one-byte `B(n+1)` / `9(n+1)` ACK, `A3` / `A0` and the 6-byte `A1`, `A8` and
  `A8`). To stay quiet on a busy bus, ids in `0x200`–`0x2FF` and the ISO-TP range `0x600`–`0x7FF`
  are never paired (an ISO-TP single frame such as `7E0 02 10 03` looks like a TP2.0 data frame;
  a TP2.0 side there is found by its own ACKs), a direction counts only when at least
  `TP20_MIN_ANSWER_SHARE` (half) of that side's answer-seeking frames were answered, and the
  exchange must go both ways or include a channel test / disconnect. `Tp20Summary.warnings`
  (rendered as **Warning:** lines, in `--json` too) fire only on TP2.0 evidence: one says the
  channels were inferred without a setup (the module is unknown) and names only channels found by
  that inference or a `0x300`–`0x3FF` id that sends a TP2.0-only opcode itself — a plain ISO-TP /
  OBD capture with a 0x3xx broadcast gets none; the other names an id pair whose only exchange is
  a lone channel test / disconnect (too few for a channel). Single TP2.0-looking frames (a one-byte
  broadcast or rolling counter reads as an ACK) are never flagged; [captures/README](./captures/README.md) tells owners to keep the channel setup
  in the trimmed window.
- **Docs.** [connection](./features/connection.md) (no command outlives its session),
  [settings](./features/settings.md) (export provenance),
  [vehicle-select](./features/vehicle-select.md) (merge + `sanitizeLearned`),
  [report](./features/report.md) (last-connection sources), [captures/README](./captures/README.md),
  [simulator](./simulator.md) (closed simulator, every expect key), [testing](./testing.md)
  (teardown), [vehicles/README](./vehicles/README.md) (`vehicleDocValidationProblems`),
  [architecture](./architecture.md) (close on disconnect).
- **Tests (+39 tests: 1524 tests / 175 suites).** `Elm327Client.test.ts` (+3: in-flight and queued
  commands reject at once with no timer left; refused until `reopen()`; monitor mode released),
  `DiagnosticSession.test.ts` (+1: disconnect fails queued reads fast, reconnect works),
  `MockTransport.test.ts` (+1), `DpfScreen.test.tsx` (+1: a refresh cut off by a disconnect ends
  at once with one "ELM327 link closed" entry), `adapterLog.test.ts` (+10: Clear keeps the
  origin; a connect clears unstamped traffic; another BLE adapter clears the log; a reconnect to
  another car on the same adapter — another VIN, or another protocol without one — keeps only its
  own traffic and wrap count),
  `connectionService.test.ts` (+2), `SettingsScreen.test.tsx` (+1: a disconnected Golf log
  exported after the settings moved to the real adapter and the Punto still says `simulator` /
  Golf / `ELM327 v2.2` / CAN; +1: Clear during the Golf session, a `03` read, the Punto picked
  meanwhile — still the Golf's fixture), `fixtures.replay.test.ts` (every expect key),
  `vehicle-docs-sync.test.ts` (+4 synthetic, +3 per doc — one per documented car),
  `garageStore.test.ts` (+2), `sections.test.ts` (+1), `captureAnalyzer.test.ts` (+9: a capture with its setup has no
  warnings, the odd-id trimmed pair, a lone coincidence or a wrong ACK sequence is no channel and
  no warning, a lone channel-test exchange is only a warning, a plain capture with a 0x3xx
  broadcast gets no TP2.0 warning (a 0x3xx id with a TP2.0 opcode does), window / same id; the
  committed capture plus 10 Hz look-alike broadcasts infers no channel and flags nothing; an
  ISO-TP `7E0` request followed by a one-byte "ACK" broadcast stays ISO-TP and still pairs; a side
  answered on fewer than half its asks does not count).
- **Deviations.** Items 2–6 were partly in place already (log cleared on a source switch; a second
  fixture test covering `pendingDtcs` / `freezeFrameCount`; synthetic rule tests; a rehydration test
  running the merge; `ranAt` / `lastReadAt` already in `lastSeenAt`), so those items add the missing
  hardening and tests rather than the fix the plan sketched. Item 1 is fixed in obd-core (close on
  disconnect) instead of only in the two test files. For a real-adapter log the fixture's
  `vehicleId` still comes from the selected car at export time: the VIN auto-select picks the
  garage car _after_ the connect, so the connect-time selection would be the stale one. The plan's
  "three consecutive green `npm run ci` runs" was checked locally: three runs in a row, green, with no post-teardown logs and no worker forced to exit. After the review fixes (Clear keeps the log's origin, stricter TP2.0 pair inference) the final three full runs in a row were green with no post-teardown logs and no worker forced to exit; one earlier run in that pass printed Jest's "a worker process has failed to exit gracefully" notice once, and `--detectOpenHandles` on the suites touched here shows no open handle.

---

## Plan 23 — Security-access plugins (2026-11-09)

[Plan 23](./plans/23-security-access-plugins.md) landed: a write that a UDS module protects with
`27` SecurityAccess is unlocked **only** with a seed→key routine the owner supplies for their own
car, as a `bolid.seedkey.v1` data file the app validates and interprets in a sandbox. The app ships,
fetches and derives **no** routine; both identity `seedToKey` fallbacks (`useCoding`,
`useServiceReset`) are gone, so without a plugin a protected write is refused with “Locked — this
module needs security access and no plugin is installed for it.” before any bus traffic. The plan's
deferred section (an optional no-op write with the owner's own routine) needs the car.

- **DSL (`obd-core/coding/seedKeyDsl.ts`, pure).** `SeedKeyOp` (load / const / add / sub / mul /
  xor / and / or / not / swap16 / bswap / shl / shr / rol / ror / mask / table / repeat / store) over
  one uint32 accumulator, `SeedKeyPluginV1`, `SEED_KEY_LIMITS` (256 ops, 4096 steps, repeat ≤ 64 ×
  ≤ 32 ops, nesting ≤ 2), `compileSeedKey` — validates every operand and computes the **exact**
  executed step count before anything runs (the program has no branches), snapshots the program,
  refuses a seed of the wrong width; `countSeedKeyOps`; `SeedKeyError`.
- **Schema (`shared/lib/exchange/seedKey.ts`).** `seedKeyPluginV1` with the plan-13 combinators
  (recursive op validator, unknown fields stripped, scope must name a header / address / prefix,
  odd level 1–0x7D, widths 2 / 4) refined by the compiler; `parseSeedKeyFile` (200 kB cap, BOM,
  “over the safety limits” vs “not valid”, newer `v2+` and wrong files refused readably).
  `parseExchangeFile` now points a plugin file to its own import.
- **Store + files.** `shared/state/seedKeyStore.ts` (`bolid.seedKeys` v1: id, name, applies, widths,
  `fileUri`, `importedAt`, optional `vehicleKey` pin; re-validated on load; at most 50; never the
  program). `shared/security/seedKeyFiles.ts`: `loadSeedKeyModules` (variable-specifier imports),
  `pickSeedKeyFile`, `installSeedKeyPlugin` (copies the validated file to
  `documentDirectory/seedkeys/<id>.json`), `removeSeedKeyPlugin`, `readSeedKeyProgram` (re-reads,
  re-validates, checks the scope still matches the index, compiles — a missing / edited file is a
  problem, never a routine).
- **Resolution (`shared/security/resolveSeedKey.ts`).** `matchSeedKeyPlugin` (level + pin, then
  header or VAG address, then prefix-only; pinned beats unpinned, newest wins; a prefix never
  matches an unknown part number), `seedKeyVehicleKeys` (the code book's `vin:` / `id:` keys),
  `unlockStatusFor`, `resolveSeedKey` / `resolveSeedToKey`, `decideSecurity` (none / unlock /
  refuse). `useUnlockStatus.ts`: `useUnlockStatus`, `useSeedKeyVehicleKeys`,
  `activeSeedKeyVehicleKeys`, `securityDecisionForActiveCar`, `hasSeedKeyPluginFor`.
- **Call sites.** `useCoding.write` (and so every tweak) refuses or unlocks; `writeChannel(…,
{ seedToKey })` writes a `security` channel only with a routine (a `securityLocked` refusal
  otherwise; the KWP path unlocks after the session too), resolved by `useAdaptations.write/restore`
  and the backup restore panel (`useAdaptationRestore`: the planner's `unlockable` = a plugin
  matches); `startRoutine(session, routine, { seedToKey })` unlocks with a plugin and otherwise still
  attempts unlocked; `useServiceReset` refuses without one (a descriptor's own `seedToKey`, for tests
  and fakes, still wins). `describeRoutineFailure` texts point at the plugin import.
- **UI.** `shared/ui/UnlockBadge.tsx` (“No unlock needed” / “Unlockable · <plugin>” / “Locked ·
  needs security access”) on coding module cards, tweak rows, adaptation channels (replacing
  “Security-locked (read-only)”; a matching plugin now shows the write controls), routine rows (plus
  a note that a locked routine is attempted unlocked) and the service-reset card. Settings → Data →
  **Security access plugins** (`settings/ui/SeedKeysSection.tsx`): Import plugin → refusal card or
  preview (name, scope, widths, steps written / run, notes, “Only for this car”) → Install; the
  installed list with **Test in simulator** and Delete.
- **Simulator.** `SimScenario.security` (header → `{ level, seed, key, protects }`): `27 <lvl>` →
  the seed (zeros once unlocked), `27 <lvl+1>` checked → `67` / `7F 27 35`, the third failure
  `7F 27 36` (then every `27`), a key without a seed `7F 27 24`, another level `7F 27 12`, protected
  services `7F <svc> 33` until unlocked, `10 xx` re-locks. No default scenario sets it; the classic
  stub is unchanged. **Test in simulator** (`shared/security/simulatorCheck.ts`) runs the plugin on a
  fixed test seed twice, then the real `codeModule` flow against a one-module scenario whose `key`
  is the plugin's own answer (after checking it refuses while locked); the message says the
  simulator cannot prove the routine is right for the car.
- **Docs.** [coding](./features/coding.md#security-access-plugins-plan-23) (plugin model, sandbox,
  scope matching, badges, policy), [adaptations](./features/adaptations.md),
  [routines](./features/routines.md), [service-reset](./features/service-reset.md),
  [settings](./features/settings.md), [backup](./features/backup.md),
  [exchange-formats](./exchange-formats.md#bolidseedkeyv1) (schema + DSL reference, no routine),
  [simulator](./simulator.md), [architecture](./architecture.md); roadmap v0.6
  “Security-access plugins” ✅. Context graph: concept `security-access-plugins`, rebuilt.
- **Tests (+75 tests, +8 suites: 1479 tests / 173 suites).** `seedKeyDsl.test.ts` (every op
  against hand-computed vectors, exact steps, nesting > 2, maxSteps / maxOps, bad operands, table
  256, no store, widths, determinism, snapshot);
  `seedKey.test.ts` (valid file, stripping, limits refused with a clear message, scope / level /
  width errors, wrong / newer / non-JSON files, the exchange-import pointer); `MockTransport.test.ts`
  (+7: locked `2E` → `7F2E33`, wrong key `7F2735`, third → `7F2736`, right key → `2E` accepted,
  `10 03` re-locks, out-of-sequence / unknown level, the classic stub and no default scenario with
  `security`); `securityAccess.integration.test.ts` (the Golf BCM behind `security['70E']`: the
  plugin unlocks + verifies, no option → `UdsError` 0x33, a wrong routine → 0x35 and nothing
  written); `resolveSeedKey.test.ts` (header beats prefix, address, pinning, prefix fails closed,
  three badge states, `decideSecurity`, pick / install / resolve / edited / missing / delete, index
  re-validation, the simulator check for 2- and 4-byte, 29-bit and over-limit plugins);
  `adaptationService.test.ts` (+3) and `routineService.test.ts` (+2) on the wire;
  `noSeedKeys.test.ts` (no registry profile sets `seedToKey`, no vehicle file mentions one, no
  production identity fallback — fails on the previous code). UI: `useCoding.security.test.tsx`
  (acceptance: refused with the no-plugin message and **nothing** in the adapter log, then after the
  fixture plugin is imported the same write verifies with `2703` / `2704EDCB`),
  `SeedKeysSection.test.tsx` (import → preview → Install → Test in simulator passes → Delete; pin;
  over-limit refused, nothing installed), `UnlockBadge.test.tsx`. `storeVersions.test.ts` checks
  `NOT_BACKED_UP`. The only seed→key program anywhere is the test vector seed XOR `0xFFFF`, in test
  files.
- **Review fixes.** Plugin matching takes the module's part number only from the live module scan
  (`scannedPartNumber`, `module-scan/model/moduleScanStore.ts`), on every surface: `useCoding.write`
  and the coding card / tweak badges (via `useCoding().partNumberFor`) no longer use the profile's
  illustrative `mod.partNumber`, and the backup restore panel (`useAdaptationRestore`, planner and
  write) now passes it like the Adaptations screen, so both agree on a prefix-scoped plugin.
  Tests: `useServiceReset.security.test.tsx` (refused with the no-plugin message, plus the
  manual-procedure hint when there is one, and nothing in the adapter log; with the fixture plugin
  the reset unlocks with `2703` / `2704EDCB` and completes), `useCoding.security.test.tsx` (+1: a
  prefix plugin matching the profile's number is refused until a scan reads a matching one),
  `useAdaptationRestore.security.test.tsx` (a prefix plugin leaves the channel `locked` until the
  scan reports a matching part number) — +6 tests, +2 suites: 1485 tests / 175 suites.
- **Deviations.** (1) The plugin index is **not** in a backup (`NOT_BACKED_UP` in
  `features/backup/api/registry.ts`, beside `bolid.backups`) instead of getting a `PERSISTED_STORES`
  row: the programs live in separate files a backup does not carry, and a plugin belongs to the
  phone and car it was imported for. (2) `SeedKeyTarget.vehicleKeys: string[]` (the car's VIN key
  and its profile-id key, like the code book) instead of one `vehicleKey`. (3) The pure write
  decision is `decideSecurity(security, resolved)`, shared by every surface (through
  `securityDecisionForActiveCar`), not a coding-only `decideCodingWrite`; `resolveSeedKey` returns
  `{ entry, seedToKey, problem }` so a broken file says so (`resolveSeedToKey` is the plan's reduced
  form). (4) A plugin that names a part-number prefix never matches a module whose part number is
  unknown (fail closed); the scope must name at least one of header / address / prefix; the level
  must be odd. (5) **Test in simulator** cannot know the owner's routine, so the simulated module
  expects the plugin's own answer for a fixed test seed: it proves the file runs end to end in the
  app (limits, determinism, width, the `27` handshake, a verified write), not that it is right for
  the car — and says so. (6) The simulator also answers `7F 27 24` / `7F 27 12`, keeps the attempt
  counter across sessions, and an unlocked module's seed is all zeros. (7) The adaptations backup
  restore (plan 24) and KWP channels resolve plugins too, beyond the plan's five call sites. (8)
  `NO_PLUGIN_MESSAGE` lives in a dependency-free `shared/security/messages.ts`, so services import it
  without the stores. (9) At most 50 plugins, files up to 200 kB. (10) The routines doc keeps a
  profile's `security: { level }` only; the profile never carries the unlock itself.

---

## Plan 13 — Profile and label-pack import / export (2026-11-09)

[Plan 13](./plans/13-profile-labelpack-import-export.md) landed: a garage car, a built-in profile
(as a **seed**) and a label pack leave the phone as versioned JSON files and come back through the
OS file picker with strict validation, a preview and explicit conflict handling. Imported label
packs persist and are merged over the bundled registry, so the coding helper, the adaptations
screen and the measuring groups see them without knowing where they came from. The plan has no
on-car part. Formats: [exchange-formats.md](./exchange-formats.md).

- **Validator (`shared/lib/validate.ts`).** Hand-written combinators — `str`, `num`, `bool`,
  `lit`, `opt`, `nullable`, `arr`, `rec`, `obj` (`extra: 'strip' | 'reject'`), `hex(len)` — with
  JSON-pointer errors (`/payload/vehicle/fuel: expected one of diesel|petrol|lpg|hybrid|other, got
"coal"`), a missing key reported as "is required", at most 50 errors. Untrusted-input rules: own
  properties only, plain objects only, a freshly built output (nothing the schema does not name
  survives), `__proto__` / `constructor` / `prototype` keys rejected, every list / record / string
  capped. No `ajv` (Hermes has no `new Function`), no `zod`.
- **Exchange library (`shared/lib/exchange/`, pure).** `types.ts` (`ExchangeEnvelope`,
  `ProfileFileV1`, `LabelPackFileV1`, `LabelPackV1` with `author` / `source` / `license` /
  `confirmed`), `schemas.ts` (`profileFileV1`, `labelPackFileV1`, `labelPackV1`: DIDs and record
  keys 4-digit uppercase hex, prefixes `^[0-9A-Z]{3,12}$`, `fuel` / `make` / `ProtocolId` literal
  sets, Mode 01 PIDs `01xx`, discovered modules checked with `sanitizeUserModules`, collections
  capped at 512), `import.ts` (`parseExchangeFile` — 1 MB limit, BOM stripped, `JSON.parse` only,
  readable refusals for non-JSON / non-exchange / whole-garage / newer-version / unknown files;
  `planProfileImport` same VIN → same name → create; `planLabelPackImport` replace on a user-pack
  id collision, every overlapping prefix listed with who wins, `full` at 100; `keepBothName` " (2)",
  `keepBothPackId` `-2`; `planEmbeddedPacks`; `vehicleFromProfile`, an unknown base → `generic`),
  `export.ts` (`exportVehicle`, `exportProfileSeed`, `exportLabelPack`, `cleanLabelPack`,
  `profilePartNumbers` + `packsForPartNumbers` for the embedded packs, `exchangeFileName`,
  `labelPackCounts`).
- **Imported packs (`shared/state/labelPackStore.ts`).** `bolid.labelPacks` v1, newest first, at
  most 100, `add` / `replace` (moves to the front) / `remove`; `merge` re-validates every stored
  pack with `labelPackV1` and keeps packs imported during hydration (the garage store's rewrite
  trick). Every change and the hydrated list are pushed into the registry; `useLabelPackFinder()`
  gives screens a lookup that changes identity with the packs. Registered in `PERSISTED_STORES`
  (backup / restore) and the UI-test store reset.
- **Registry (`shared/labels/registry.ts`).** `setUserLabelPacks`, `allLabelPacks()` (user packs
  first, then `LABEL_PACKS`), `findLabelPackIn(packs, pn)`; `findLabelPack` = longest prefix, an
  equal-length tie goes to the pack listed first (imported over bundled, newest import over older).
  Every existing assertion unchanged.
- **Service (`shared/state/exchangeService.ts`).** `loadExchangeModules` (variable-specifier
  imports of expo-file-system legacy, expo-sharing, expo-document-picker), `pickExchangeFile`
  (refuses a file over 1 MB before reading it), `previewImport`, `applyImport(preview, 'create' |
'replace' | 'keep-both')` (re-plans against the stores at apply time), `vehicleExportFile` /
  `profileSeedFile` / `labelPackExportFile`, `shareExchangeFile`. New `garageStore.replace(id, car)`
  (keeps id, `createdAt` and the local code book).
- **UI.** `shared/ui/ImportPreviewSheet.tsx` (+ `useExchangeImport`): profile rows (name, year,
  fuel, based on, VIN ending, learned readings, modules, embedded packs, warnings) or pack rows
  (module, id, prefixes, counts, author / licence / source, checked-on-a-car, overlap warnings);
  **Import** / **Cancel**, or **Replace** / **Keep both** / **Cancel**; a refused file shows the
  reason, the first three validator errors and "Nothing was changed." Vehicle screen: **Import
  profile** in My garage, **Export** on each garage card, **Share as starting profile** on every
  built-in card but Auto / Generic (`vehicle-select/api/exchange.ts`). Settings → Data →
  **Label packs** (`settings/ui/LabelPacksSection.tsx`, `settings/api/labelPackFile.ts`): Import
  label pack, the imported packs (Export / Delete after a confirm), the bundled packs (Export as
  template). The adaptations, coding and extended-PID screens use `useLabelPackFinder`, so an open
  screen picks up an import or a delete.
- **Examples (`docs/examples/`).** `profile.example.json` (a Golf seed) and
  `label-pack.example.json` (the EDC17 names for `03L906022`, plus `170A` and its own `3001`
  description) — both are test inputs.
- **Docs.** New [exchange-formats.md](./exchange-formats.md) (both schemas with examples, import
  steps, validation, versioning, licensing); [vehicle-select](./features/vehicle-select.md)
  (Profile import / export, `garageStore.replace`); [settings](./features/settings.md) (Data →
  Label packs); [adaptations](./features/adaptations.md) (imported packs and precedence);
  [backup](./features/backup.md) (`bolid.labelPacks` row); [vehicles/README](./vehicles/README.md)
  ("Share a profile"); [docs index](./README.md); roadmap v0.3 "Profile import / export" and v0.6
  "Label-pack expansion" ✅. Context graph: concept `exchange-files`, rebuilt.
- **Tests (+72 tests, +7 suites: 1404 tests / 165 suites).** `validate.test.ts` (every
  combinator, nested paths, strip / reject, prototype keys, `hex(4)` case and length, error cap);
  `schemas.test.ts` (both examples validate, `bolid.profile.v9` refused readably, DID `17G1`
  rejected at `/payload/measurements`, prefixes, group size, unknown fields and `loginCodes`
  stripped, learned identity and module rules, every bundled pack and built-in seed exports valid);
  `import.test.ts` (refusals, the four-error corrupted file, round trip without the code book,
  unknown base, both planners, keep-both names / ids, overlaps and who wins, embedded packs, file
  names); `registry.test.ts` (+6: longer user prefix wins, a longer bundled prefix still wins, equal
  prefix → user pack, newest user pack, clearing restores bundled, copy of the list);
  `labelPackStore.test.ts` (add / replace / remove, cap 100, registry push, v1 file, rehydrate
  re-validation); `exchangeService.test.ts` (pick / cancel / unavailable / oversize / read failure,
  export → cleared-app import → identical car → Replace / Keep both, Replace keeps the code book,
  example seed, embedded packs, example pack import + delete, corrupted file changes nothing,
  share); `ImportPreviewSheet.test.tsx`; `LabelPacksSection.test.tsx`;
  `VehicleSelectScreen.test.tsx` (+4: Export, seed share, Import profile end to end, no picker);
  `AdaptationsScreen.test.tsx` (+1: the imported `3001` description on the simulated Golf, the
  bundled one back after Delete); `backupService.test.ts` now round-trips an imported pack.
- **Deviations.** (1) `expo-document-picker` was already installed (plan 18), so no install and no
  dev-client rebuild. (2) The preview sheet and `useExchangeImport` live in `shared/ui`, not
  `vehicle-select/ui` — Settings reuses them and features never import each other. (3) The pure
  export builders sit in `shared/lib/exchange/export.ts` and the I/O / apply in
  `shared/state/exchangeService.ts`; `vehicle-select/api/exchange.ts` (`shareVehicleFile`,
  `shareProfileSeedFile`) and `settings/api/labelPackFile.ts` are thin share wrappers. (4) A profile
  file never carries `loginCodes` (the plan's payload type would have exported the code book); a
  Replace keeps the local codes. Discovered `modules` (plan 25) are included. (5)
  `parseExchangeFile` returns `{ error, details }` (the validator errors) rather than `{ error }`.
  (6) Validator extras: `nullable`, `arr` `min`, `rec` `max` / `keyDesc`, `str` `desc`. (7)
  `LabelPackV1.confirmed` is plan 25's `Confirmation` (with the optional `fixture`). (8) Garage
  cards have buttons, not a ⋯ menu: **Export** joins Edit / Delete; **Import profile** sits under
  the add actions; the built-in seed export is **Share as starting profile** (not offered for Auto /
  Generic, whose placeholder year 0 is also left out of a seed). (9) Settings → Data already existed
  (plan 18); Label packs is a block inside it. (10) Imported packs are newest first, so the newest
  import wins an equal-prefix tie among user packs. (11) Both import entry points accept both file
  kinds. (12) Embedded packs are added only when no imported pack has their id (the local one is
  kept). (13) Three screens switch from `findLabelPack` to `useLabelPackFinder` so an open screen
  re-resolves — the lookup itself is unchanged. (14) Packs do not merge, so the example pack carries
  the bundled EDC17 names plus its additions; a one-measurement pack would hide the bundled names
  for that prefix.
- **Review fixes.** (a) Export now always produces a file that imports: `exportVehicle` clamps the
  name (trimmed, at most 80, a blank one → the VIN default name), the notes (4000) and the learned
  calibration id / adapter version (printable ASCII, at most 64 — an ECU reporting several CALIDs
  joins them past that); `keepBothName` shortens the name so "name (n)" stays within 80; and
  `shareExchangeFile` validates every file against `profileFileV1` / `labelPackFileV1` before
  writing it (a failure is logged and nothing is written, so the screen says "Could not export…"
  instead of "Saved …"). The garage editor caps name and notes at the same limits
  (`VEHICLE_NAME_MAX` / `VEHICLE_NOTES_MAX` in `shared/vehicles/userVehicle.ts`, which the schema
  now uses): `maxLength` on both inputs and a `validateDraft` error for a longer value. (b) Embedded
  packs are added in reverse file order (`labelPackStore.add` prepends), so the receiving phone
  keeps the exporter's precedence order and an equal-prefix tie resolves the same way on both.
  Tests: `vehicleDraft.test.ts` (+1 limits), `import.test.ts` (+3: long keep-both name, long name /
  notes / joined CALIDs export valid, blank name), `exchangeService.test.ts` (+3: two embedded packs
  keep their order and winner, a schema-invalid file is not written, an over-long garage name still
  exports) — 1411 tests / 165 suites.

---

## Plan 25 — Confirmation metadata, module discovery and the capture analyzer (2026-11-09)

[Plan 25](./plans/25-post-capture-confirmation.md) landed in the simulator: every per-car profile
item can now record **evidence** that it was checked on the real car, the screens badge each item
green / blue / amber, **Discover modules** finds a car's real UDS module map, and a **capture
analyzer** (library + CLI) turns a sniffer CSV into decoded request / response pairs and
fingerprints. Nothing in the Golf profile is marked confirmed yet — the plan's whole "Deferred until
an on-car session" section (discovery on the Golf, the Group 121 / DPF / service-reset captures,
TP2.0 timing, the VCDS before / after BCM reads) is untouched and still needs the car.

- **`Confirmation` (`obd-core/confirmation.ts`, exported).** `{ on, source: 'sniffer-capture' |
'on-car' | 'vcds-log', fixture?, note? }`; `confirmed?` on `ExtendedPid`, `DiagModule`,
  `GuidedRoutine`, `AdaptationChannel`, `CodingModule`, `ServiceReset`, `ModuleSensor`,
  `LoginCodeEntry` (the field plan 22 left out) and `CodingPreset`. Pure helpers in
  `shared/vehicles/confirmation.ts`: `verificationState` (`experimental: false` → standard, else
  `confirmed` → confirmed, else unverified), `verificationText` ("Standard OBD2" / "Confirmed
  2026-11-20 (sniffer capture)" / "Illustrative — not yet confirmed on this car"), `allConfirmed`,
  `profileConfirmations`, `confirmationProblems(profile, exists)`.
- **Evidence rule.** `vehicle-docs-sync.test.ts` runs `confirmationProblems` on every registry
  profile: `on` must be `YYYY-MM-DD`, `fixture` must sit under
  `src/shared/obd-core/transport/fixtures/` or `docs/captures/` (no `..`) and exist. Proved with a
  temporary edit (ABS module `confirmed` → `docs/captures/bogus.csv` fails, the synthetic capture
  passes) and pinned by unit tests on a fake profile. New `docs/captures/` (README, `.gitkeep`).
- **`VerificationBadge` (`shared/ui`).** Replaces the per-item warnings on Extended PIDs (the
  `EXPERIMENTAL` pill), Module scan (expanded row), Routines, Adaptations, Coding → Tweaks (per
  preset), Service reset and Sensor tests (per module reading; `ModuleReading.confirmed`). Screen
  subtitles stay general warnings; DPF's says "All DIDs confirmed on this car" once every
  `dpf` / `diesel` DID is confirmed (`useDpf` now returns `dieselPids`).
- **Module discovery.** `obd-core/uds/vagHeaders.ts` — `VAG_UDS_HEADER_CANDIDATES` (15 entries by
  VCDS address, source marked per entry: ISO / profile / community) and `discoveryCandidates`
  (adds a profile's own UDS pairs). `obd-core/uds/discoverModules.ts` — `discoverUdsModules`:
  per candidate `ATSH` / `ATCRA` / `22 F187`, ident on any answer (a `7F 22 xx` still counts),
  `answered` / `silent` / `error`, `resetAddressing()` in `finally` after every candidate, a 1 s
  command timeout while probing (`DISCOVERY_TIMEOUT_MS`). New `Elm327Client.withCommandTimeout` /
  `DiagnosticSession.withCommandTimeout` (restores the previous timeout even on a throw).
  Module scan: **Discover modules** (`DiscoverySection`), also on an 11-bit CAN link with no module
  list;
  **Add to this car's module list** stores the module in `UserVehicle.modules` for a garage car
  (merged over the base by `buildUserProfile` / `mergeModules`, on any base; `sanitizeGarage` drops
  malformed entries via `sanitizeUserModules`), and shows the pasteable `DiagModule` literal
  (`diagModuleLiteral`, with the read ident as `sampleIdent`) for a built-in profile.
  `moduleScanStore` gains `discovery` / `discoveryProgress` (and joins the UI-test store reset).
- **Simulator.** `MockTransport` answered profile extended DIDs (incl. the engine's `F187`) on
  **any** header, so discovery would have "found" the engine on every candidate. On CAN they now
  answer with default addressing or on `7E0` only; a module header answers `22 F1xx` only from its
  seeded `moduleIdent`. The Golf discovery finds exactly `7E0`, `760`, `714`.
- **Capture analyzer (`obd-core/analysis/captureAnalyzer.ts`, self-contained).** `parseCaptureCsv`
  (plan-03 CSV, CRLF / LF, `# raw:` block, malformed rows kept), `reassembleCaptureIsoTp` (raw
  SF / FF / CF with sequence check / FC attached to the opposite stream, truncation flagged),
  `decodeUds` (the plan's 17 services + `7F` with ISO 14229 NRC names; a `2B` login code is never
  printed), `pairRequests` (skips `7F xx 78` response-pending, stops when the tester moves on),
  `summarizeTp20` (setups on `0x200`, answers on `0x201`–`0x2FF`, data channels from the `D0` ids
  plus `0x300`–`0x3FF` plus a `0x600`–`0x7FF` id that sends a TP2.0-only opcode, `A3` keep-alives), `analyzeCapture` (`aroundMs` / `windowMs` / `onlyId`,
  diagnostic ids only by default), `fingerprintKey`, `renderReportMarkdown`. CLI
  `scripts/analyze-capture.mjs` (`--around`, `--window`, `--id`, `--json`, `--all-ids`,
  `--expect`, `--quiet`) imports the `.ts` file through Node type stripping; `npm run
analyze:capture`, `npm run check:capture` (in `npm run ci` and a CI `verify` step) on the
  committed `docs/captures/synthetic-golf.csv`, which the analyzer test generates with
  `formatCaptureCsv` (`UPDATE_FIXTURES=1` rewrites it; the test fails when it drifts).
- **Tweaks groundwork.** `compareCodingSnapshots(before, after, presets)` in
  `obd-core/coding/presets.ts` → per preset `on` / `off` / `none`.
- **Docs.** New [captures/README.md](./captures/README.md); [module-scan](./features/module-scan.md)
  (Discover modules); the badge states in
  [extended-pids](./features/extended-pids.md), [routines](./features/routines.md),
  [adaptations](./features/adaptations.md), [coding](./features/coding.md),
  [service-reset](./features/service-reset.md), [dpf](./features/dpf.md);
  [vehicles/README](./vehicles/README.md) (`confirmed` and the evidence rule, garage modules);
  [simulator](./simulator.md), [testing](./testing.md), [release](./release.md); roadmap v0.6
  rows flipped (on-car pending). Context graph: concepts `confirmation-evidence`,
  `capture-analyzer`.
- **Tests (+50 tests, +6 suites: 1308 tests / 153 suites).** `confirmation.test.ts` (three states,
  text, evidence rule); `discoverModules.test.ts` (Golf: exactly `7E0` / `760` / `714` answered
  with the seeded part numbers, the rest silent, progress once per candidate, `ATSH7DF` + bare
  `ATCRA` after every candidate, only `22` reads, standard reads afterwards, link errors restore
  addressing, a negative reply counts); `captureAnalyzer.test.ts` (the synthetic capture: SF
  `10 03`, the 20-byte FF / CF / FC part number with `flowControlFrom === '7E0'`, `31 01 0301`,
  `7F 31 33` → `securityAccessDenied`, one TP2.0 setup pair, three keep-alives, CRLF, the `# raw:`
  junk line; pending / unanswered pairing; the CLI via `spawnSync`); `presets.test.ts`
  (`compareCodingSnapshots`: DRL for byte 0 bit 0 both ways, none for an unrelated byte or a
  spill-over); `MockTransport.test.ts` (engine DIDs not on `70E`); `Elm327Client.test.ts`
  (`withCommandTimeout`); `userVehicle.test.ts` / `garageStore.test.ts` (module merge, sanitizing);
  `discovery.test.ts`; `ModuleScanScreen.test.tsx` (the acceptance walk-through, a garage car
  adding a module, the literal for a built-in profile, module badges); `VerificationBadge.test.tsx`.
- **Deviations.** (1) The raw-frame ISO-TP function is `reassembleCaptureIsoTp`, not
  `reassembleIsoTp` — that name is already exported by `elm327/responseParser` and both go through
  `obd-core/index.ts`. (2) `UdsDecoded` gains `service` (the request SID a positive / negative
  belongs to; `sid` stays the raw first byte); `RequestResponsePair` gains `pending`;
  `CaptureReport` gains `filter`; `DiscoveredModule` gains `reason` (for `error`). (3)
  `analyzeCapture` options add `pairWindowMs` (the request → response window, since `windowMs` is
  the `--around` half-width) and `allIds`; by default only diagnostic ids (`0x600`–`0x7FF`,
  `18DA` / `18DB`) are reassembled, and TP2.0 ids are never parsed as ISO-TP — otherwise bus
  broadcasts and `0x200` setups decode as junk requests. (4) The CLI suppresses Node's
  `MODULE_TYPELESS_PACKAGE_JSON` warning (the repo cannot set `"type": "module"`) and adds
  `--expect` / `--quiet` so the smoke step is cross-platform; `check:capture` also runs in
  `npm run ci`. (5) The plan said the simulator already answered `22 F187` only on seeded headers;
  since plan 14 it did not (see Simulator above), so `MockTransport` changed. (6) The candidate
  list is the plan's (with `52` at `74C` / `7B6` as written); `2B` and `37` have no well-known pair
  and are omitted. (7) A `confirmed` item that is also `experimental: false` stays "Standard OBD2"
  (the plan's precedence) — so the Golf engine module (standard ISO pair) cannot turn blue; the
  acceptance's "flip to blue" is covered on an experimental item (unit + badge tests). (8) The DPF
  subtitle reads "All DIDs confirmed on this car". (9) `CodingBackup.test.tsx` gets a 20 s test
  timeout as a margin for a loaded machine; the real cause of its slowness is in the third review
  fixes below.
- **Review fixes.** (1) The capture report leaked a KWP `2B` login code: `decodeUds` hid it in
  `summary`, but the fingerprint `example` and the `--json` request `bytes` carried the raw payload.
  `analyzeCapture` now cuts a `2B` request down to its service byte (`IsoTpMessage.redacted`), so
  the example reads `7E0 2B (login code not shown) → 6B` and no output form holds the code (test on
  the Markdown and the JSON). (2) Module scan keyed modules by address alone, so the Golf's UDS and
  TP2.0 cluster `17` (and a discovered UDS module next to a TP2.0 one) collapsed into one result,
  Clear could hit the wrong module and React saw duplicate keys. `diagModuleKey` (transport +
  address, exported from `shared/vehicles`, also used by `mergeModules`) now keys `upsertResult`,
  `clearOne` and the rows. (3) A discovery is stamped with the car and session it ran on
  (`moduleScanStore.discoveryOwner`); `useModuleScan` drops a stale one (another garage car or
  connection) instead of showing it, and `addDiscovered` refuses to write it into the current car.
  (4) `Elm327Client.withCommandTimeout` kept one saved-and-restored field, so two overlapping (not
  nested) calls could leave the 1 s override set for the rest of the session; it now keeps one
  entry per active call. `discover`, `scanAll` and `scanGateway` also return early while the store
  says a scan is running (a double tap before the button re-renders disabled). (5) Badge-site
  tests: DPF subtitle (warning while any DID is unconfirmed, "All DIDs confirmed on this car" once
  all are), Extended PIDs, Routines, Adaptations, Coding → Tweaks, Service reset and Sensor tests
  (new `verify-sensor-<i>` testID) each assert the amber badge and the blue one for a confirmed
  item, via the `@test/confirmation` helper that marks a registry item confirmed for one test.
  `CodingBackup.test.tsx` waits up to 8 s per step (it flaked once at 4 s in the full run).
  +17 tests, +5 suites: 1325 tests / 158 suites.
- **Second review fixes.** (1) Discover modules was offered on any CAN link, including 29-bit CAN
  and J1939, where `functionalHeader()` is null, so `resetAddressing()` could not restore `ATSH`
  and standard reads went to the last candidate's header until reconnect. New `isCan11` (protocols)
  gates `canDiscover` / `discover`, and `discoverUdsModules` itself throws before sending anything
  on any other protocol. (2) 08 and 46 share `746` / `7B0`, but nothing told them apart: the pair
  was probed twice and both rows showed the same ident. Candidates now carry optional
  `identHints`; `groupCandidatesByPair` makes one probe per distinct pair (14 probes for the 15
  candidates, progress counts probes), `pickCandidateByIdent` picks the address from the ident's
  system name / strings (else the first), and the result lists the others as
  `DiscoveredModule.alternatives`. The row explains the shared pair and offers **Record as 46 …
  instead** before adding (the add and the literal use the chosen address). (3) The module-row
  badge testID is `verify-module-<diagModuleKey>` (e.g. `verify-module-uds:17`), so the UDS and
  TP2.0 cluster rows no longer share one. +5 tests: 29-bit refusal (core + screen), the shared-pair
  probe and pick, `pickCandidateByIdent`, switching the address before adding, both cluster badges.
- **Third review fixes.** (1) `npm run ci` was not reliably green: `CodingBackup.test.tsx` failed
  under the full parallel run even with the 8 s waits. Cause: two `waitFor`s polled
  `expect(within(panel).getAllByText('equal')).toHaveLength(2)` while the panel re-read the car.
  Each failing poll pretty-prints the matched host elements (and the tree above them), ~0.6 s of
  blocked event loop, which starved the simulator's replies (each command ~500 ms instead of
  ~15 ms). They now count with `queryAllByText('equal').length`; the two restore tests drop from
  4.9 / 6.8 s to 1.7 / 1.5 s alone. `sim-fixtures.freshness.test.ts` (re-records all 12 fixtures,
  ~4.9 s alone) gets an explicit 30 s timeout; it hit jest's 5 s default under load. The plan-03
  `sniffer.integration.test.ts` counted frames in a fixed 200 ms window and once saw only 3 under
  load; it now streams until more than 3 arrived (3 s deadline). (2) The DPF
  subtitle test left the screen's mount-time Mode 22 reads running past the test; they timed out
  against the closed session and logged after jest finished ("Cannot log after tests are done",
  "Jest did not exit"). It now waits for `useDpfStore` to finish the refresh, and `useDpfStore`
  joins the UI-test store reset. (3) The capture analyzer only knew a TP2.0 channel from a `D0`
  setup answer or `0x300`–`0x3FF`. In a capture trimmed past the setup (as captures/README asks),
  the tester's `0x740` was reassembled as ISO-TP, so its data packets read as fake requests and it
  was missing from the channel list. `summarizeTp20` now also takes a `0x600`–`0x7FF` id that sends
  a TP2.0-only opcode (`A0` / `A1` / `A3` / `A4` / `A8`, `9x` / `Bx` ACK — never ISO-TP, whose PCI
  nibble is 0–3). +2 tests: a trimmed `740` / `300` capture (channels listed, no pairs), and plain
  `7E0` / `7E8` ISO-TP not taken as a channel.

## Plan 22 — KWP login entry and the per-car code book (2026-11-09)

[Plan 22](./plans/22-kwp-login-code-book.md) landed: pre-UDS VAG modules on K-line can now be
adapted behind a **KWP2000 login** (`2B`, VCDS "Login – 11"). A login channel's **Write** opens a
login sheet (masked five-digit code, optional workshop code, **Remember for this car**); the code
book keeps remembered codes per car; the simulator models `2B` / `21` / `3B` end to end. The app
ships **no login codes**. The plan's deferred part — TP2.0 pre-UDS modules on the Golf (cluster
`17`, comfort `46`) — is untouched and still needs the on-car session.

- **Core (`obd-core/coding/kwpLogin.ts`, pure, exported).** `kwpLogin(send, code, wsc = 0)` —
  `2B` + 2-byte BE code + 3-byte BE workshop code (`kwpLoginRequest`, range-checked before any
  send), positive `6B`, `7F 2B 35` rethrown as `UdsError` nrc 0x35 "Login code rejected";
  `formatLoginCode`, `parseLoginCode`, `parseWorkshopCode`, `describeLoginFailure`.
  `describeUnlockFailure(err)` in `udsCoding.ts` now holds the NRC 0x36 / 0x37 lockout texts:
  `routineService.describeRoutineFailure` delegates to it (texts unchanged) and the service-reset
  hook uses it for a lockout instead of a bare "Failed: …".
- **Types.** `LoginCodeEntry { address, code, wsc?, purpose, source }`; `VehicleProfile.loginCodes?`,
  `UserVehicle.loginCodes?` (inherited by a garage car from a non-generic base like the other
  per-car arrays); `AdaptationChannel.transport?: 'uds' | 'kwp'`, `login?`, `session?`, `address?`.
  `shared/vehicles/loginBook.ts` — `loginCodeFor` (user entry over the profile's), `upsertLoginCode`
  (one code per address), `removeLoginCode`, `sanitizeLoginCodes`, `MASKED_LOGIN_CODE`;
  `sanitizeGarage` drops malformed codes.
- **Simulator.** `SimScenario.kwpLocals` / `kwpLogins` / `kwpLoginRequired`; `MockTransport`
  answers `2B` (`6B` / `7F2B35` / `7F2B11` with no login service), `21` (`61 <lid> …` / `NO DATA`),
  `3B` (`7B`, `7F3B33` before login, `7F3B31` unknown lid) and drops a header's login on `10 xx`.
  `buildScenario` seeds KWP channels into `kwpLocals` (not into the UDS `coding` store) and the
  login gate, and `kwpLogins` from a simulator-only placeholder replaced by a profile's
  documented codes (`kwpLoginSeeds`, addresses matched trimmed / case-insensitive like
  `loginCodeFor`).
- **Adaptations.** `adaptationService`: KWP read (`10 <session>` unless the per-screen cache
  says it is open → `21`; `AdaptationsScreen` provides one `KwpSessionCacheContext` that every
  row's `useAdaptations` shares), KWP write (bounds → `Login required` refusal with **no bus
  traffic** when the code is missing → `10` → `2B` → backup `21` → `3B` → re-read → verify), K-line
  addressing without a receive filter, `resetAddressing()` in `finally`; `WriteOutcome` gains
  `loginRejected` / `loginRequired` / `loginAccepted` (set only once the `2B` got its `6B`). `useAdaptations` offers UDS channels on CAN and KWP channels on
  K-line, exposes `loginInfo` / `forgetLogin`, and `write` / `restore` take an optional
  `LoginInput` and return the outcome; a code is remembered only when ticked **and** the outcome
  says `loginAccepted` (never after a bounds / security refusal, a failed session start, a dead
  link or a `7F 2B 36/37/11/33`), and kept out of the error log; the `2B` request itself is
  redacted (`obd-core/transport/redact.ts`, `redactCommand` → `2B <login code redacted>`) by
  `logTxText` — so in the adapter I/O log and every replay fixture exported from it — and in the
  ELM timeout error text; a remembered code the module rejects (NRC 0x35) is forgotten.
  `api/codeBook.ts` (`userCodeBook` — for a registry car only the primary key's book: `vin:` once
  the car reported a VIN, else `id:`; `preVinCodeBook` — with a VIN known, the `id:` book as a
  pre-fill only, never sent without the sheet and never deleted by this car; `loginFor`,
  `rememberLoginCode`, `forgetLoginCode` (primary key only), `loginBookKeys`); `model/loginBookStore.ts` — `bolid.loginBook` v1 (with
  `migrate` / sanitizing `merge`), registered in `PERSISTED_STORES` and in the UI-test store reset.
- **UI.** `ui/LoginSheet.tsx` (`LoginSheet` + testable `LoginForm`); `ChannelRow`: the login step
  before the confirm (and before a one-tap restore), status line "Login: remembered (01 · …)" with
  **Forget** / "Login: needed", a rejected code is never re-sent without the sheet nor
  pre-filled (and a rejected remembered code is dropped from the code book); the
  screen states the KWP1281 limit on K-line with a link to Service reset. The vehicle editor lists
  a garage car's login codes (masked, Show / Delete, applied on Save).
- **Passat profile.** One illustrative KWP channel on the engine ECU: address `01`, header
  `8101F1`, local id `2A` "Idle speed adaptation", 1 byte × 10 rpm, 800–1000 rpm, `login: true`,
  `experimental` — a placeholder until a capture confirms it. KWP1281 modules stay undeclared.
- **Also fixed.** `ChannelRow` selected `s.backups.filter(…)` inside the zustand selector — a new
  array on every call, which loops forever under React 19 ("getSnapshot should be cached"); the
  screen had no component test, so it never showed. It now selects the array and filters in a
  `useMemo`.
- **Tests (+56 tests, +6 suites: 1258 tests / 147 suites).** `kwpLogin.test.ts` (request bytes
  `2B 30 39 00 00 00`, `6B`, `7F 2B 35` → nrc 0x35, range, parse / format, the shared lockout
  texts); `loginBook.test.ts` (user over profile, missing → null, edits, sanitizing);
  `MockTransport.test.ts` (`3B` → `7F3B33` before login, accepted after the right `2B`, refused
  again after `10 85`; wrong code → `7F2B35`; `21` seeded bytes; `buildScenario` seeding, a
  profile's documented code replacing the placeholder, `0a` / `0A` addresses matching);
  `adaptations/api/adaptationService.test.ts` (Passat over a logging transport: no login → nothing
  sent, out of bounds → nothing sent, right code → verified with the exact command order, wrong
  code → "rejected" and nothing written, re-login after a session restart, Golf UDS unchanged);
  `adaptations/api/codeBook.test.ts` (login book / garage, never `bolid.settings`, a pre-VIN code
  is a pre-fill only and another car never inherits or deletes it, sanitizing);
  `adaptations/ui/AdaptationsScreen.test.tsx` (the acceptance walk-through on the simulated
  Passat, a pre-VIN code opens the sheet pre-filled and survives a rejection, Golf never shows a
  login); `adaptations/hooks/useAdaptations.test.tsx` (two hooks under the screen provider send
  one `10 85`, without it two); `recordingTransport.test.ts` (a `2B` is logged redacted); `VehicleSelectScreen.test.tsx` (editor section);
  `backupService.test.ts` now populates and restores the login book.
- **Deviations.** (1) `LoginCodeEntry.confirmed?: Confirmation` is left out — plan 25's
  `Confirmation` type does not exist yet; add it with plan 25. (2) `AdaptationChannel` also gains
  `address` (the code-book key; the plan names address `'01'` for the Passat channel but did not
  list the field). (3) The simulator accepts a **simulator-only placeholder** code `12345` for the
  Passat engine (`SIM_KWP_LOGINS` in `scenarios.ts`) so the in-app simulator can walk the
  acceptance flow; it is a demo value, not a login code for any real module, and is never put in a
  code book. The plan had seeded `kwpLogins` only from profile codes (none). (4) Header for the
  illustrative channel is `8101F1` (ISO 14230 physical, target `01`, tester `F1`); unconfirmed.
  (5) The `loginBookStore` lives in the adaptations slice (`features/adaptations/model/`) rather
  than `shared/state`; only the adaptations screen and the backup registry read it. (6) A
  remembered code is stored only after the module accepted the login — `WriteOutcome.loginAccepted`,
  set right after `kwpLogin` resolves (the plan did not say when); a remembered code the module
  rejects is forgotten rather than kept with a per-row "ask again" flag (which a remount or a later
  write reset). (7) A
  profile-documented code pre-fills the sheet but does not skip it — only the user's own
  remembered entry skips it. (8) Restores (backup / known default) on a login channel go through
  the same login step. (9) Plan 13's import does not exist yet; the garage JSON export already
  carries `loginCodes` (10) Review fixes: a registry car's code-book lookup reads
  only its primary login-book key, and a code remembered before the VIN was known only pre-fills
  the sheet once a VIN is known (an earlier merge of both keys let one car send — and on rejection
  delete — another car's code); the `2B` request is redacted in the adapter log and replay
  fixtures (the plan only kept the code out of the error log); the KWP session cache is shared by
  every row through a screen-level context instead of one per row.

## Plan 18 — Backup and restore, export everything (2026-11-09)

[Plan 18](./plans/18-backup-restore.md) landed: **Settings → Data** and **More → Backup & restore**
open `/backup`, where one tap writes a single plain JSON **backup file** (every persisted store +
the trip recordings) to `documentDirectory/backups/` and shares it; **Choose a backup file…**
validates a file, shows what it holds with a per-store checklist, snapshots the current data to
`backups/pre-restore-<stamp>.json` first, then writes the stores back through their own `persist`
migrations and rehydrates them without a restart; every store also exports alone as JSON, and
history / module scans / maintenance as CSV. No cloud; the API keys are never in a backup. The plan
has no deferred section, so nothing is pending on the car.

- **Pure format (`src/shared/lib/backup.ts`, core tsconfig).** `BACKUP_FORMAT = 1`, the plan's
  `BackupBundle` / `BackupStoreBlob` / `BackupTripFile` / `RawStoreFile` types, `parseEnvelope`
  (missing version → 0, garbage → null), `envelopeFor`, `buildBackup` (absent / unreadable files
  skipped, byte sizes summed), `redactBackup` + `redactState`, `validateBackup` / `parseBackup`
  (hard errors vs warnings; unsafe trip ids such as `../settings` dropped), `planRestore`,
  `serializeBackup`, `estimateBundleBytes`, `backupFileName` / `preRestoreFileName` (UTC
  `yyyymmdd-hhmm`, sortable), `preRestoreFilesToDelete`, `uniqueFileName`, `countItems`,
  `formatBytes` (B / kB / MB), `utf8Bytes`, `LARGE_BACKUP_BYTES` (50 MB warning).
- **Persist layer.** `debouncedStorage` returns a `DebouncedStateStorage` with `flushNow(name?)`
  (writes the pending value now, cancels the timer, resolves once the inner write landed); every
  instance registers, and `flushPendingWrites()` flushes them all — before a backup reads the files
  and before each restored file is written, so a stale debounced flush cannot undo a restore.
- **Store fixes (the task's "also").** `alertsStore` now persists as `bolid.alerts` v1 (rules only;
  `active` stays live; malformed rules dropped; with no stored rules the in-memory ones — defaults
  EngineHost seeded — are kept) and `notificationsStore` as `bolid.notifications` v1 (prefs +
  reminders; the OS `permission` stays live; `mergeNotifPrefs` lays the file over
  `DEFAULT_NOTIF_PREFS`). `scanHistoryStore` (`bolid.scans`) and `carBackupStore`
  (`bolid.carBackups`) shipped without a version (zustand wrote 0); both are now v1 with an
  identity `migrateScans` / `migrateCarBackups` — without a `migrate`, zustand would have
  discarded the stored scans and snapshots on the version bump.
- **Backup slice (`src/features/backup/`, a composition slice like engine-host and report).**
  `api/registry.ts` — `PERSISTED_STORES`, 13 rows in restore order (settings, garage, vehicle,
  history, maintenance, trips, scans, carBackups, dashboard-layout, alerts, notifications,
  onboarding, errors), each with a label, `restoreByDefault` (off for the error log and dismissed
  hints), `version()`, `snapshot()`, `rehydrateFresh()`, `count()` and, for the three tables,
  `csv()`; `STORE_NAMES`, `storeRef`, `currentVersions`. `api/storeCsv.ts` — RFC 4180 CSV of
  history (one row per code of each fault-code check, a "No fault codes" row for a clean check),
  scans (one row per module fault, UDS and TP2.0) and maintenance (one row per entry, km, newest
  first). `api/backupService.ts` — `loadBackupModules`, `readStoreFiles`, `readTripFiles`,
  `tripFilesSummary`, `createBackup`, `prunePreRestore` (keeps 3), `exportStore`, `readBackupFile`,
  `pickBackupFile`, `restoreBackup`, `shareBackupFile`, `deleteBackupFile`. `model/backupStore.ts`
  — `bolid.backups` v1, the last 20 files written (not part of any backup). `hooks/useBackup.ts`;
  `ui/BackupScreen.tsx` (Back up · Restore from file · Backups on this phone · Export one part);
  route `src/app/backup.tsx`, hidden `Tabs.Screen name="backup"`; **Settings → Data** section and a
  **More → Backup & restore** entry.
- **Install.** `expo-document-picker` `~56.0.4`, installed with
  `npx expo install expo-document-picker -- --legacy-peer-deps`; the lockfile diff is only its
  10-line entry. It is a native module, so an
  installed build needs the next native build for **Choose a backup file…** (the screen says so
  when the picker is missing; restore from the list still works).
- **Simulator.** No new simulator behaviour: backup reads only what the stores already hold, so
  `MockTransport` is unchanged. The plan's walk-through is a UI test: the simulated Golf with
  `P0299` → fault read into history, module scan saved, a trip with its CSV, a maintenance entry, a
  dashboard reorder, a dismissed hint → **Back up now** → every store and file cleared → pick the
  kept file → restore → the same data, and the trip CSV is back.
- **Tests (+91 tests, +5 suites: 1202 tests / 141 suites, including both rounds of review fixes below).** `shared/lib/backup.test.ts` (the
  plan's list: envelope parsing, skipped files and sizes, redaction leaving other blobs
  byte-identical, `format: 2` / non-array stores / string version rejected, unknown store warned,
  round-trip, sortable names; plus unsafe trip ids, duplicates, prune order, unique names, UTF-8
  sizes, metric byte units); `persistStorage.test.ts` (`flushNow` writes now and cancels the timer;
  every key; `flushPendingWrites` waits for the inner write); `backup/api/backupService.test.ts`
  (real stores over an in-memory file system: every store + trip files, no key in the file,
  same-minute names, restore onto a cleared app, replace-not-merge, history v1 → v2 migration and
  write-back at v2, v0 scans blob, newer version skipped while others restore, a planted key never
  restored, a recording trip kept, 3 pre-restore snapshots kept, a failed snapshot restores
  nothing, JSON export for every row, CSV for the three tables, picker cases);
  `backup/api/storeVersions.test.ts` (registry equals every `persist(` store in `src/` minus
  `bolid.backups`; versions ≥ 1; the four store migrations / persistence); `backup/api/storeCsv.test.ts`;
  `backup/ui/BackupScreen.test.tsx` (back up with trips, double-confirm restore from a picked file
  with the default checklist, a non-backup file explained, restore from the list, JSON / CSV export,
  the simulator walk-through); `MoreScreen.test.tsx` and `SettingsScreen.test.tsx` (new entries).
  Test harness: the in-memory file system reports `size` and has `readDirectoryAsync`;
  `resetStores` also resets the alerts, notifications and backup-list stores.
- **Docs.** New `features/backup.md`; `features/settings.md` (Data section), `features/more.md`,
  `features/alerts.md` / `notifications.md` (now really persisted), `features/module-scan.md` /
  `coding.md` (v1), `architecture.md` (backup as the third composition point; the registry is the
  one list to update), `plans/README.md` (Persistence rule), `privacy-policy.md` + the in-app copy
  (a backup is a plaintext file with VINs and never an API key), `phase2-mobile-app.md` (route
  table), `roadmap.md` (✅). Context graph rebuilt; new curated concept `app-backup-restore`.
- **Deviations.** (1) Registry rows expose closures (`version`, `snapshot`, `rehydrateFresh`,
  `count`, `csv`) instead of the raw `api.persist` object, and restore calls `rehydrateFresh`, not
  plain `rehydrate`: the stores' own `merge` functions union the file with what is in memory (a
  start-up safety net), which would have made a restored history the union of old and new.
  `rehydrateFresh` wraps the store's `merge` for one rehydrate so it runs against the initial values
  of the persisted keys — the store's own `migrate` and `merge` still run, and live state (a trip
  being recorded, active alerts, the in-memory API key) is untouched. (2) Every service function
  takes the native modules as a parameter (`loadBackupModules()`), like `report/api/reportExport.ts`,
  so the whole flow is tested in the core project; the platform is passed in rather than read from
  `react-native`. (3) `planRestore(bundle, selected, currentVersions)` — "known" is the keys of
  `currentVersions`. (4) `flushNow` is per storage plus the module-level `flushPendingWrites()`
  (each store builds its own debounced storage inside `createJSONStorage`, so one exported flush
  had to reach them all). (5) `redactBackup` blanks every non-empty `apiKey` at any depth to `""`
  (the shape the settings store writes) instead of deleting `ai.apiKey` only, and also runs before a
  restore. (6) Same-minute file names get a `-2` suffix (both backups and pre-restore snapshots), so
  two restores in a minute cannot overwrite the first undo point. (7) The picker accepts JSON, text
  and octet-stream (Android labels shared files inconsistently); the content is validated. (8) The
  backup list also offers **Restore** (the undo path for a pre-restore snapshot), and the hook
  tears the connection down before a restore (`connectionService.resetForRestore`). (9) Persisting alerts / notifications was "Out of
  scope" in the plan; the task asked for it, so both persist and are registry rows. (10) The plan's
  11-row table became 13 rows (garage from plan 06, plus alerts and notifications). (11) Per-store
  JSON is `{ name, version, exportedAt, state }`. (12) "Reset all app data" (plan 07) has not
  landed, so the walk-through clears stores with the test harness.
- **Review fixes.** (a) **Restore vs the connection:** the hook called `disconnect()` only when a
  session existed, so a restored `bolid.settings` could flip `adapterSource` / `simulatedVehicleId`
  behind the service's back — an in-flight connect was not invalidated and the adapter log was not
  cleared (a simulator log could be exported as a `source: 'car'` fixture). New
  `connectionService.resetForRestore()` shares `switchAdapterSource`'s teardown (`connectEpoch++`,
  abort reconnect, reset the session store, clear the adapter log, close the old session) and runs
  before every restore; two tests in `connectionService.test.ts`. (b) **Older blob of a store
  without `migrate`:** zustand discards it and `rehydrateFresh` had already reset the keys, so a
  hand-edited `version: 0` wiped the store and was reported restored. `planRestore` now takes the
  set of stores with a `migrate` (registry `migrates()` / `migratableStores()`) and skips such a
  blob with "cannot upgrade". (c) **Silent write failure:** `fileStateStorage.setItem` swallows
  errors, so the restore now reads each file back and skips a store whose file did not change.
  (d) **Backup list cap:** a record dropping off the 20-entry list now has its file deleted
  (`createBackup`), so old `bolid-backup-*.json` files no longer pile up unseen; the screen says the
  newest 20 are kept. (e) **Stale URIs:** `BackupRecord` no longer stores the absolute `uri`
  (iOS moves `documentDirectory` across updates); `backupFileUri(mods, fileName)` derives it at use
  time (`readListedBackup`, `shareBackupFile`, `deleteBackupFile`), and the list's `merge` drops a
  stored `uri`. (f) **Size estimate:** the warning looked at the trip CSVs only and used a binary
  threshold (52.4 MB shown); the screen now shows "The backup file will be about X" — the stores
  serialized as written (`storesEstimateBytes` → `estimateBundleBytes`) plus the trips when
  included — and warns when that is above `LARGE_BACKUP_BYTES` = 50 000 000 (SI, as `formatBytes`
  shows). (g) **Trip CSVs on a device:** `useTripRecorder.ts` (write on stop, load, delete, share)
  now loads `expo-file-system/legacy` instead of the root module, which on SDK 56 has no
  `documentDirectory` — so on a device a trip CSV is really written and a backup carries it; its
  test now mocks the root module without `documentDirectory` to pin that.
- **Second review fixes.** (h) **Starter alert rules once per id:** persisting `bolid.alerts` made
  EngineHost's "seed `defaultRules` while the list is empty" keep the first car's PID-filtered set
  for good (a later car never got the low-voltage / over-rev rule), and the `merge` fallback plus
  the reseed brought every default back after the user deleted them all. `alertsStore` now persists
  `seededIds` next to the rules and has `seedDefaults(supportedPids)`, which adds only the starter
  rules the car supports that were never offered (no write when none is new); EngineHost calls it on
  every connect. The `merge` keeps the stored rules even when empty, keeps a starter rule seeded in
  memory during the hydration window only when the file never offered it, and treats a file without
  `seededIds` that holds rules as already seeded (`sanitizeSeededIds`). Still `bolid.alerts` v1 (it
  never shipped without the field). (i) **Rehydrate failure reported as restored:** zustand 5's
  `hydrate()` swallows a throwing `migrate` / `merge` (it only hands the error to
  `onRehydrateStorage`), so a hand-edited blob such as `bolid.trips` `{ trips: [{}] }` was listed as
  restored while memory kept the old trips and the file held a blob the store cannot load.
  `rehydrateFresh` now wraps `onRehydrateStorage` (chaining the store's own) to capture the error and
  rethrow it; `restoreBackup` then skips the store and **puts its previous file back**
  (`putBackStoreFile`, or removes it when there was none). (j) **Pre-restore evicting a user
  backup:** the snapshot counted toward the 20-entry list, so restoring the oldest of 20 backups
  deleted that very file. `withRecord` now caps each kind separately (20 backups the user made, plus
  the pre-restore snapshots, which `prunePreRestore` trims to 3); the screen text says the automatic
  snapshots are counted apart. (k) **Orphan trip CSVs:** a restored trips list left the CSVs of the
  trips it dropped on disk where nothing could reach them, and "Trip recordings" without "Trips"
  wrote CSVs for summaries not in the list. The restore now writes a trip CSV only for a trip in the
  trips list after the stores are restored, and, when `bolid.trips` was restored, deletes the CSVs of
  the trips that dropped out (the pre-restore snapshot holds them, so undo brings them back); the
  checklist hint says "only for trips in the trips list". Tests: four starter-rule cases in
  `storeVersions.test.ts`; in `backupService.test.ts` a merge-rejected blob skipped with its file
  put back, a pre-restore snapshot not evicting the oldest of 20 backups, dropped trips' CSVs
  deleted, and no CSV written for an unlisted trip.
- **Discovery (not fixed, out of scope).** Seven other export hooks (adapter-health, coding backup
  share, error-log, measuring log, DTC export, chart export, scan share) still load the **root**
  `expo-file-system`, which on SDK 56 has no `documentDirectory` (its legacy functions are throwing
  stubs — see the notes in `can-sniffer/api/captureExport.ts` and `report/api/reportExport.ts`), so
  their share files are never written on a device. They are not part of the backup; switching them
  to the legacy entry point is a small follow-up (the UI test harness mocks both entry points
  identically, which hides it).

---

## Plan 15 — Unified vehicle report (2026-11-09)

[Plan 15](./plans/15-unified-vehicle-report.md) landed: one tap on **More → Vehicle report**,
**Info → Full vehicle report** or **Faults → Full report** builds a single document for the active
car — identity (VIN decode, protocol, adapter), readiness + fault codes with VAG numbers and freeze
frames, the newest saved module scan, the inspection verdict, the battery result, the AI summary and
the maintenance due list — and shares it as **PDF** (`expo-print`), **HTML** or **Markdown**. Every
shared report is recorded in History. Everything above the plan's deferred section is shipped and
exercised against the simulator; **on-car pending**: eyeball the PDF of a real 16-module Golf scan
with TP2.0 modules once.

- **Pure model (`src/shared/lib/vehicleReport.ts`, core tsconfig).** The plan's types
  (`ReportIdentity`, `ReportScan`, `ReportInspection`, `ReportBattery`, `ReportAi`,
  `ReportMaintenance`, `VehicleReportModel`, `ReportSectionId`, `VehicleReportInput`),
  `buildVehicleReport` (fills `missing`), `reportSeverity` (worst of MIL on, inspection verdict, AI
  overall, weak battery, any overdue item), `renderReportHtml` (self-contained, every string
  escaped, `@media print` page breaks before Module scan and Maintenance), `renderReportMarkdown`
  (one `## ` per present section, VAG numbers next to codes), `reportFileStem`
  (`bolid-report-<VIN or profile>-<yyyymmdd-hhmm>`, UTC), `reportHeadline`, `reportSections`.
  Metric only.
- **CSS lift (`src/shared/lib/reportHtml.ts`).** `REPORT_CSS` + `escHtml` moved out of
  `dtcReport.ts`; `buildDtcReportHtml` output verified byte-identical before / after (the existing
  `dtcReport.test.ts` is unchanged and green). `dtcReport.ts` now also exports `dtcCheckBodyHtml`
  (code tables + freeze frames, reused by the vehicle report), `freezeFramesHtml`, `milText`,
  `totalCodes`, and **`dtcCheckFromRead`** — the live-read → `DtcCheckReport` mapping that replaced
  `FaultCodesScreen`'s local `buildCheck`.
- **Report slice (`src/features/report/`).** `api/sections.ts` (pure mappers: `faultsFromStores`,
  `faultsFromHistory`, `scanFromSaved` with `statusFlagText` and header-identical counts,
  `inspectionFrom`, `batteryFrom`, `aiFrom`, `maintenanceFrom` worst-first, `identityFrom` with
  `decodeVin` / `PROTOCOL_LABELS`, `belongsToCar`, `collectReportSources`, `availableSections`);
  `api/reportExport.ts` (`loadReportModules` — tolerant imports of `expo-file-system/legacy`,
  `expo-sharing`, `expo-print`; `exportVehicleReport(model, format, mods)` — print → `moveAsync` to
  `<stem>.pdf`, or write `<stem>.html` / `.md`; history record; share sheet; `report/export` errors);
  `hooks/useVehicleReport.ts`, `hooks/useReportExport.ts`; `ui/ReportScreen.tsx` (preview card with
  severity badge and counts, section checklist with "Not run yet" + **Run now**, Share PDF / HTML /
  Markdown, PDF → HTML fallback). Route `src/app/report.tsx`, hidden `Tabs.Screen name="report"`.
- **Stores.** `batteryStore.ranAt` (set by `setReport`, null when cleared).
  `historyStore`: `ReportHistoryEntry` (`kind: 'report'`, sections, format, file name) +
  `addReportRun`; additive, persist version stays 2. `HistoryScreen`: report card + a **Reports**
  type filter.
- **Install.** `expo-print` `~56.0.4` (the SDK 56 version `npx expo install` picks, no config
  plugin), installed with `npm install expo-print@~56.0.4 --legacy-peer-deps` so the lockfile diff
  is only the `expo-print` entry (see review fix (d)).
- **Simulator.** No new simulator behaviour: the report only reads what Faults / Module scan /
  Inspection / Battery / AI already produce. The integration test drives the simulated Golf with
  `P0299` injected end to end.
- **Tests (+60 tests, +7 suites: 1111 tests / 136 suites).** `vehicleReport.test.ts` (missing, badge MIL → urgent colour,
  overdue → attention, stem VIN / profile id, `## ` per section, `<script>` escaped, metric guard,
  offline "last connection"), `vehicleReport.integration.test.ts` (simulated Golf + `P0299`: six
  sections, `00665`, module `01`, verdict, due list), `report/api/sections.test.ts` (scan counts
  equal `formatAutoScanReport`'s header, maintenance worst-first, identity online / offline,
  history fallback, car matching), `report/api/reportExport.test.ts` (PDF / HTML / MD with fake
  modules, no printer, no directory, failure logged, history recorded),
  `report/ui/ReportScreen.test.tsx` (disabled rows + Run now, offline HTML, six enabled sections
  after the simulator walk-through, Share PDF writes a `.pdf`, unchecking removes a section, PDF →
  HTML fallback, Markdown), `history/ui/HistoryScreen.test.tsx` (report card, Reports filter),
  `battery-health/model/batteryStore.test.ts` (`ranAt`); `historyStore.test.ts` (`addReportRun`
  under the cap), `MoreScreen.test.tsx` and `VehicleInfoScreen.test.tsx` (new entries). Test
  harness: `expo-print` mock and `moveAsync` in the in-memory file system; `resetStores` now also
  resets the scan-history, inspection and battery stores.
- **Docs.** New `features/report.md`; `features/fault-codes.md` (snapshot moved to
  `dtcCheckFromRead`, Full report button), `features/history.md` (report entries, Reports filter),
  `features/battery-health.md` (`ranAt`), `features/more.md`, `features/vehicle-info.md`,
  `features/engine-host.md` + `architecture.md` (report slice as the second composition point),
  `phase2-mobile-app.md` (route table), `roadmap.md` (✅, on-car pending). Context graph rebuilt.
- **Deviations.** (1) The live-read mapping lives in `src/shared/lib/dtcReport.ts` as
  `dtcCheckFromRead` (with `faultsFromStores` in `sections.ts` as an alias), not only in
  `features/report/api/sections.ts`: importing the report slice from `FaultCodesScreen` would have
  added a feature → feature import. As a side effect the Faults HTML report now shows the protocol
  label instead of the raw protocol id, plus the voltage and adapter name. (2) `ReportIdentity`
  gained `connected` and `lastSeenAt` (the "last connection" line); `ReportScan` gained `preUds`
  for TP2.0 modules (counts stay UDS-only, matching the text report's header). (3) The app version
  comes from `APP_VERSION` (`@/shared/lib/appInfo`, app.json) rather than `expo-constants`.
  (4) `reportSeverity` also counts a weak battery as attention. (5) Offline, faults and AI fall
  back to the car's newest history entries, so a report after an app restart is not empty;
  maintenance counts as available only once the car's logbook has an entry. (6) Never-run sections
  are still requested, so the document lists them under "Not run yet"; unchecked ones are left out.
  (7) The file I/O lives in `api/reportExport.ts` with injected modules (the UI test project
  cannot run variable-specifier imports), and the plan's `DtcResult` path is
  `src/shared/state/dtcStore.ts`, not `features/fault-codes/model/dtcStore.ts`.
- **Review fixes.** (a) In-memory results now carry the car they belong to: `activeCarStamp()`
  (`src/shared/state/activeProfile.ts`: active profile id + label + live session VIN) is stamped by
  `dtcStore.set` (`readFor`), `inspectionStore.set` with a report, `batteryStore.setReport` and
  `aiDiagnoseStore.setReport` (`ranFor`; null when the report is cleared / reset).
  `collectReportSources` uses a live result only when its stamp passes `belongsToCar`, so reading
  car A, disconnecting and switching the garage to car B no longer files A's codes, inspection,
  battery or AI summary under B — the plan only asked for the scan to be car-filtered. (b)
  `dtcStore.clearResults()` (Faults opened with no session) also nulls `readFor` (`lastReadAt`
  stays for the first-run card), so an emptied list no longer beats the car's newest history
  entry and the offline report keeps e.g. `P0299`. (c) `exportVehicleReport` catches a share-sheet
  rejection after the file is written and recorded (warning logged, URI resolved), so Share PDF no
  longer reports "PDF unavailable" and records a second HTML copy. Tests: two `sections.test.ts`
  cases, one `reportExport.test.ts` case, `readFor` / `ranFor` assertions in `dtcStore.test.ts` and
  `batteryStore.test.ts` (both now mock `expo-file-system/legacy`, since the stamp reads the
  persisted garage / vehicle stores). (d) The first `expo-print` install ran without
  `--legacy-peer-deps`, so npm also pulled unrequested peer dependencies into the lockfile and
  `node_modules` (`react-native-reanimated` 4.7.1, `react-native-worklets` 0.13.1 — outside
  `expo-modules-core`'s peer range, so `npm ls` failed — `react-native-gesture-handler` 3.5.0,
  `@testing-library/dom`, `@react-native/babel-preset`, …) and dropped `"dev": true` flags; Expo
  autolinking follows non-optional peers, so the next native build would have compiled them in.
  The lockfile was restored from HEAD and `expo-print` reinstalled with `--legacy-peer-deps`: the
  diff is now the 11-line `expo-print` entry and `npm ls` is clean. (e) The Faults **Full report**
  button got a `FaultCodesScreen.test.tsx` case (`/report` pushed), like the More and Info entries. (f) The
  offline identity's "last connection" (`lastSeenAt`) is now the newest time among every section
  the report prints (scan, faults — live or history —, inspection, battery, AI) and the car's
  newest DTC / AI history entries; before, it ignored the live inspection / battery / fault-read
  times, so it could read older than a section below it, or be missing when only an inspection or
  battery capture had run. One `sections.test.ts` case.

---

## Plan 24 — Adaptation restore from a full-car backup (2026-11-09)

[Plan 24](./plans/24-adaptation-restore.md) landed: the "clone my car" snapshot now restores
**adaptation channels** as well as coding — per channel or per module, behind the adaptations unlock,
through the same bounds guard and backup → write → verify path every other adaptation write uses,
with a backup-vs-car comparison first. Everything above the plan's deferred section is shipped and
exercised in the simulator; **on-car pending**: the first real use on the Golf is a no-op restore
(backup, Compare → all `equal`), then a one-step change restored and re-read, recorded in the
vehicle doc.

- **Core (`obd-core/coding/adaptationValue.ts`).** `AdaptationBounds` (scaling + `min` / `max` /
  `unit`) and `adaptationBoundsError(ch, raw)` — the single write guard: refuses raw bytes that are
  not `byteCount` wide, or decode (signed-aware) below `min` / above `max`; never clamps.
  `adaptationService.checkBounds` is now a one-line wrapper over it, so `writeChannel` and the
  restore planner share one implementation.
- **Planner (`features/coding/api/adaptationRestore.ts`, pure).** `planAdaptationRestore(snapshot,
liveChannels, current, { unlockable })` → `RestorePlanItem[]` with the plan's rules in order:
  `no-channel` → `no-snapshot-raw` → `out-of-bounds` (bounds message as `reason`) → `locked` →
  `equal` (byte-for-byte) → `restore`; values decoded with the live channel's scaling.
  `summarizeRestorePlan` (restore count + every skip reason, zero-filled), `noSecurityUnlock`
  (default: `ch => !ch.security`), `currentModuleFromReads` (fresh reads shaped as a
  `CarBackupModule` via `buildCarBackup`) and `restoreHeadline` ("2 adaptations differ, coding
  unchanged" from `diffBackupModule`).
- **Hook (`hooks/useAdaptationRestore.ts`).** `readCurrent(module)` reads every profile channel of
  the module through `readChannel` (plus the module's long coding when the snapshot has one, keyed
  by its coding DID, `resetAddressing()` in `finally`); `plan`; `restoreOne(item)` /
  `restoreAll(items, onProgress?)` write through `writeChannel`, push the replaced value onto
  `adaptationsStore.backups` (so the Adaptations screen can undo a restore), log failures, and stop
  at the first failure. The adaptations unlock is re-read from the store at write time (fails
  closed); `writeChannel` re-checks bounds and refuses security channels.
- **UI (`ui/AdaptationRestorePanel.tsx`, in `CodingBackup.tsx`).** The informational "restore them
  from the Adaptations screen" paragraph is replaced by **Compare with car** → headline + one row
  per channel (name (DID) · backup → car now with units · chip: restore / equal / not in profile /
  not in backup / out of bounds / locked; equal rows greyed; skip reason shown), per-row
  **Restore** with the inline confirm ("Write 850 rpm to Idle speed offset (DID 3001)? A backup of
  the current value is taken first."), **Restore all (N)** with the list, progress and "Not
  restored: …" on failure; re-compares after every write. Locked → buttons disabled plus "Locked —
  unlock adaptations on the Adaptations screen…"; press handlers also check the gate.
- **Simulator.** No new scenario fields (`2E` on channel DIDs is already accepted via
  `adaptationSeeds` → `coding`).
- **Tests (+40 tests incl. the review follow-ups, +3 suites: 1051 tests / 129 suites).** `adaptationValue.test.ts` (inside /
  edges / below / above / scaled / no bounds / wrong width / signed), `adaptationRestore.test.ts`
  (every skip reason, header matching, failed current read → restore, locked vs unlockable, bounds
  before lock, summary counts, headline variants), `adaptationRestore.integration.test.ts`
  (simulated Golf: 850 → 900 → plan `3001` restore / `3002` equal → restore verified → 850; a 1024
  rpm snapshot refused by the planner and by `writeChannel`, car untouched),
  `ui/CodingBackup.test.tsx` (Create backup → change 3001 → Compare shows `850 rpm → 900 rpm ·
restore` and `3002 · equal`; locked → disabled + explanation; unlocked Restore → "Write verified.",
  both rows equal, backup recorded, car reads 850; Restore all; out-of-bounds row with the bounds
  message and no Restore). `test/resetStores.ts` now also resets the car-backup, coding and
  adaptations stores.
- **Docs.** `features/coding.md` (6b.8: restore flow, skip reasons, gating, tests, on-car pending),
  `features/adaptations.md` (shared bounds guard; the backup screen writes through the same service
  and unlock), `vcds-parity-roadmap.md` 6b.8, `roadmap.md` (✅, on-car pending). Context graph:
  `concept:adaptation-channels` updated; graph rebuilt.
- **Deviations.** (1) Plan 23 (security-access plugins) has not landed, so there is no
  `resolveSeedToKey` to pass into `writeChannel`: the hook plans with `noSecurityUnlock` and
  `writeChannel` keeps refusing security channels — they always show as `locked`. (2)
  `adaptationBoundsError` also refuses raw bytes whose length is not the channel's `byteCount`
  (fail closed for a snapshot taken under an older profile revision); such values plan as
  `out-of-bounds`. (3) `readCurrent` also reads the module's long coding (keyed by its coding DID)
  so the header can say "coding unchanged / changed" as the plan's example does; the planner ignores
  that key. (4) `restoreAll` takes an optional `onProgress(done, total)` for the progress line, and
  the hook also returns `unlocked` and `connected` for the UI. (5) The restore UI is its own
  component (`AdaptationRestorePanel.tsx`) rendered from `CodingBackup.tsx`'s module block, and a
  component test was added beyond the plan's test list to cover the acceptance checks on screen.
- **Review follow-ups.** (a) The panel and hook now require a **CAN** session (`available =
!!session && isCan(session.currentProtocol)`, as `useAdaptations` does) instead of any session;
  the hook returns `available` in place of `connected`, and `readCurrent` returns `null` when it
  cannot read. (b) New non-persisted `model/backupWorkStore.ts` — one shared gate (`tryBegin` /
  `end`) taken by backup create, the module block's coding restore, and adaptation compare /
  restore, so they never interleave addressing and writes; a second action is refused with "Another
  module read or write is still running…". This is a Backup-section gate, not a session-wide lock:
  `DiagnosticSession` still has none, so the Coding module editor / Adaptations screen are not
  serialized against it (pre-existing, unchanged). (c) `backupVehicleMismatch(backup.vehicle,
{ profileId, vin })` in `api/carBackup.ts`: a snapshot taken under another profile / garage car,
  or with a different known VIN, shows a warning and every restore in it (coding and adaptations)
  is disabled; compare / export still work. (d) The panel's compare / restore handlers catch
  rejections (logged, "Failed: …", stale table dropped), and every press handler re-checks its gate.
  (e) `restoreHeadline` now takes the plan items and counts byte-level differences only among
  channels with both a snapshot and a live read; the rest is "N not compared", so the headline
  matches the rows. (f) Tests: Restore all stopping at the first failure ("Stopped at 3001: …
  Not restored: Idle speed offset (3001), EGR base duty (3002).", `writeChannel` called once),
  non-CAN, VIN mismatch, the shared gate, a throwing compare (`CodingBackup.test.tsx`);
  `backupVehicleMismatch` (`carBackup.test.ts`); headline vs rows (`adaptationRestore.test.ts`).

## Plan 19 — AI provider presets, follow-up questions, guide citations (2026-11-09)

[Plan 19](./plans/19-ai-provider-presets.md) landed: the AI assistant works with a **local server**,
**OpenAI**, **Anthropic** (native Messages API) or a **custom** OpenAI-compatible server, each with
its own defaults and its own keystore slot; the owner can ask **follow-up questions** about a report
in a bounded conversation; findings **cite the per-car fault guides** with the same deep-link
buttons as the Faults screen, and the model is told about them. The plan has no deferred section;
the only owner step is optional (Test connection against a real cloud key).

- **Core (`shared/obd-core/analysis/aiProviders.ts`, exported from `obd-core/index.ts`).**
  `AI_PROVIDER_PRESETS` (`local` / `openai` / `anthropic` / `custom`: wire, base URL, default model,
  JSON mode, `needsKey`, `canListModels`, hint), `inferProvider` (api.openai.com / api.anthropic.com
  / blank / other), `resolveProvider`, `applyProviderPreset` (applied only on a switch; remembers the
  previous provider's URL / model / output mode in `ai.remembered`, never a key), `aiConfigProblem`
  (plain-words reason the AI can't run), `MOCK_AI_URL` / `isMockAiUrl`, and the Anthropic shaping:
  `buildAnthropicRequestBody` (system split out, consecutive same-role turns merged, leading
  assistant turn fixed, `max_tokens` default 8192, no sampling params / prefill / `response_format`),
  `extractAnthropicContent`, `anthropicStopReason`, `anthropicHeaders`.
- **Core (`aiDiagnosis.ts`).** `DiagnosticSnapshot.guides?: KnownCheck[]`; `summarizeSnapshot(s,
guides = s.guides)` appends "Known checks for this car"; the system prompt gains "When a finding
  relates to a listed known check, mention it in `detail`" (prompt split into intro / rules / report
  rules so the follow-up prompt reuses them); `buildFollowUpSystemPrompt` (no schema hint, ≤ 120
  words, cite codes by id), `MAX_FOLLOWUP_TURNS = 8`, `buildFollowUpMessages`, `SUGGESTED_FOLLOWUPS`
  and `followUpSuggestions(report, focusCode)`.
- **I/O (`shared/ai`).** `http.ts` (moved `AiClientError` + `fetchJson`, injectable `fetch` via
  `setAiFetch`, 401/403/404/429 hints), `anthropicClient.ts` (`GET /v1/models?limit=100`,
  `POST /v1/messages`, refusal → error, key required), `openaiClient.ts` (uses `http.ts`, exports
  `requireBase`), dispatcher `getAiClient(settings): AiClient { listModels, chat(messages, { json }) }`
  in `index.ts` (wire from the preset; `json: false` forces plain text on the OpenAI wire), and the
  dev mock `__mocks__/mockAiServer.ts` for `mock://ai`.
- **Settings.** `AiSettings.provider` (default `local`) + `remembered`; `SETTINGS_VERSION` 5 with
  v4 → v5 `provider = inferProvider(baseUrl)`; `merge` infers a missing provider. `setAi({ provider })`
  applies the preset only on a real switch and swaps in that provider's key (this session's memory at
  once, then its keystore slot unless the user typed meanwhile). `secureApiKey.ts`: one slot per
  provider `bolid.ai.apiKey.<provider>` (`apiKeyStoreKey`, `secureGetApiKey(provider)`,
  `secureSetApiKey(provider, key)`), legacy single slot read + deleted
  (`secureGetLegacyApiKey` / `secureDeleteLegacyApiKey`), `planApiKeyHydration(provider, fileKey,
slotKey, legacyKey)` → migrate (file / legacy-slot) · load · none, with `dropLegacy`.
  `AiSection`: Provider segment + hint, URL input (local / custom) or read-only URL with **Edit** →
  Custom, API key field (`secureTextEntry`, keystore note), Model + Detect, Structured output hidden
  for Anthropic, Test connection through the dispatcher.
- **AI Diagnose.** `gatherSnapshot()` collects `knownChecksFor(curatedProfileId(profile), codes)`;
  `analyze()` uses `aiConfigProblem` + `getAiClient(ai).chat(…, { json: true })`; `followUp()` (friendly
  error for an on-device report / missing setup / empty answer). Store: `conversation`, `asking`,
  `askError`, `pushTurn`, `clearConversation` (cleared by a new report and `reset()`). Hook: `ask()`,
  `clearConversation()`, `guideProfileId`. Screen: `FindingCard` shows "Known check for this car" +
  `GuideLinks` for curated guides; **Ask about this report** card (chips, input + send, bubbles,
  Clear; disabled with a hint for a local report). `GuideLinks` is exported from
  `@/features/fault-codes`.
- **Docs.** `ai-diagnose.md` (providers table, Anthropic wire, follow-ups, guide citations, mock AI
  server, data flow, layers), `settings.md` (AI section, per-provider keys, v5 migration),
  `privacy-policy.md` + `privacyPolicy.ts` (data sent to the chosen provider, follow-ups, cloud
  providers, one key per provider). Context graph: `concept:ai-diagnose-flow` updated + linked to
  `core:analysis/aiProviders`.
- **Tests (+63 tests, +3 suites: 1011 tests / 126 suites, review fixes included).** `aiProviders.test.ts` (hosts and blanks,
  presets, local → anthropic → local restores URL / model / mode, remembered cloud model, URL
  carry-over rules, config problems, Anthropic body / content / headers / stop reason),
  `aiDiagnosis.test.ts` (known-checks section, system rule, follow-up structure, bounded to 8, no
  schema hint, suggestions + focus), `secureApiKey.test.ts` (per-provider slots with an in-memory
  keystore, legacy migration plan), `settingsStore.test.ts` (v5, v4 → v5 inference, v4 OpenAI blob
  rehydration, provider switch keeps per-provider keys and the local URL, keystore load on switch,
  legacy-slot and plaintext-file hydration), `shared/ai/aiClient.test.ts` (dispatcher: Anthropic →
  `/v1/messages` + `x-api-key` + version, models list, refusal, 401 hint, URL inference; OpenAI →
  bearer + `response_format`, `json: false`, local without auth; `mock://ai` only with `__DEV__`),
  `AiDiagnoseScreen.test.tsx` (mock://ai on the simulator Golf with P0401 + P2015: guide notes,
  Related data → `/extended?dids=170E%2C170F`, Open routine → `/routines`, snapshot guides; chips
  and free text append bubbles, Clear; 6th prompt drops the 1st turn; focus chip first; local report
  disables follow-ups), `SettingsScreen.test.tsx` (Anthropic fills URL + model, hides Structured
  output, shows the key field; Edit → Custom; Test connection hits the Anthropic models list with the
  key).
- **Deviations.** (1) `anthropic-version: 2026-10-21` instead of the plan's `2023-06-01`: the
  current API version per the `claude-api` reference; the app sends none of the fields it removed.
  (2) Raw `fetch` (as the plan specifies) rather than the `@anthropic-ai/sdk` package: no new
  dependency in the React Native bundle, one shared timeout / error path, injectable for tests.
  (3) `buildAnthropicRequestBody` default `max_tokens` is 8192, not 2048: current Claude models
  think adaptively by default and thinking counts against `max_tokens`, so 2048 could truncate the
  JSON report. Server-side refusal fallbacks are not sent (the model is user-selectable and older
  models reject the parameter); a `refusal` stop becomes an error and the local report. (4) Extra
  header `anthropic-dangerous-direct-browser-access: true` so a web build (plan 28) can call the API
  with the user's own key. (5) OpenAI default model `gpt-5-mini` could not be confirmed against a
  live `GET /v1/models` (no network calls allowed); **Detect model** replaces it. (6) The custom
  preset has `needsKey: false` (key optional, field shown) — custom servers vary. (7)
  `applyProviderPreset` lives in core (generic over the preset fields) and remembers URL / model /
  mode per provider in `ai.remembered`, which is how "keeps the user's local URL when switching
  back" works. (8) The `GuideLinks` extraction already existed (`fault-codes/ui/DtcGuideParts.tsx`,
  plan 05) — only exported from the slice index; its buttons are labelled **Related data** / **Open
  routine** (the plan's "Measuring blocks" / "Routine"). Guide notes show only for curated guides,
  not `GENERIC_GUIDE`, and one per distinct guide. (9) Plan 05's `focus` param makes "What does
  <focus> mean for this car?" the **first suggestion chip** rather than sending a question
  automatically (no unrequested network call; the focused report already explains the code). (10)
  The conversation stays on screen in full; only the prompt is bounded to `MAX_FOLLOWUP_TURNS`
  messages. (11) The mock server is selected only when `__DEV__` is on, but it is a static import, so
  it is in the bundle (inert in release builds) rather than excluded. (12) `secureApiKey.ts` gained a test seam, `setSecureStoreModule`, so the keystore tests inject an in-memory double instead of relying on the variable-specifier `import()` under Jest (it resolved intermittently in parallel runs). (13) Plan 18 (backup) has not
  landed yet; the "backup never contains a key" acceptance holds because keys never enter the
  persisted settings blob (`redactApiKey`), which is what a backup would read.
- **Review fixes.** (a) `hydrateApiKey` deletes the legacy single slot only when its key is safe: on
  a `load`, or when `secureSetApiKey` into the provider slot returned true — a failed write keeps the
  legacy slot so the next start retries (test: failing keystore write keeps `bolid.ai.apiKey`).
  (b) `useAiDiagnose().ask()` drops an answer (or error) that resolves after the report changed
  (`setReport` resets the conversation) or the conversation was cleared, instead of pushing it into
  the new report's conversation (screen test: a late answer after `setReport` is not shown).
  (c) Settings `AiSection` Test connection / Detect model drop their result when the provider or base
  URL changed while the request ran, so an old provider's model never lands in the new provider's
  settings (screen test: Detect on Local, switch to Anthropic, model stays `claude-sonnet-5-5`).

---

## Plan 17 — Trip detail map (2026-11-09)

[Plan 17](./plans/17-trip-detail-map.md) landed: a saved trip opens on its own screen with the GPS
track drawn as a coloured SVG polyline, the GPS-vs-OBD distance check with a plain verdict, and a
speed-over-time strip — all demoable in the simulator through a synthetic GPS loop. The deferred
on-car part (validating the 3 % / 8 % thresholds against the Golf's known-good odometer) is
untouched.

- **Core (`shared/obd-core/analysis/track.ts`, exported from `obd-core/index.ts`).** `trackBounds`,
  `projectTrack` (equirectangular, lon × cos(latMid), fitted and centred in the padded box, north
  up), `scaleBar` (nice 100 m … 100 km bar ≤ ⅓ of the width), `formatBarLength`, `nearestPoint`
  (tap hit-test, 24 px), `alignSamplesToTrack` (binary search, ties → earlier; speed from the GPS
  fix with `010D` fallback, `010C`, `015E`), `colourSegments` / `legendFor` (fixed metric buckets on
  a 5-step accent → red palette, fuel by trip quartiles, grey for null), `gpsVsObd` (`ok` < 3 %,
  `check` < 8 %, `mismatch` ≥ 8 %, `unknown` with < 2 fixes / no `010D`; constants
  `GPS_OBD_OK_PCT` / `GPS_OBD_CHECK_PCT`), `speedProfile` (≤ 300 points) and
  `syntheticLoopPoint` (2 km rounded rectangle from 44.4268 N, 26.1025 E) with
  `syntheticLoopAdvance` (the loop position a given straight-line step away). `trip.ts` exports
  `obdDistanceKmFromSamples` (the private `obdDistanceKm` is now a one-line wrapper).
- **Loading.** `useTripRecorder.loadTrip(header)` reads the CSV once → `{ samples, track }`;
  `loadTripSamples` delegates to it. Same `csv-read` error logging.
- **Synthetic GPS.** `trackRecorder.startTrackCapture()` with `adapterSource === 'mock'` starts a
  timer (fix at start, then every 5 s) that advances along the loop by the live `010D` speed (40 km/h
  default), each step a chord of speed × time (`syntheticLoopAdvance`) so GPS = OBD distance even
  through the corners; `stopTrackCapture()` adds a closing fix at the stop time. `isSyntheticTrack()`;
  `stopRecording` stores `TripSummary.syntheticTrack: true` (optional field, no persist migration).
- **UI.** New hidden route `/trip-detail` (`src/app/trip-detail.tsx`, `_layout` `href: null`, title
  "Trip") → `TripDetailScreen`: stats cards, GPS-vs-OBD card (distances, Δ %, average speeds,
  verdict + note), `TrackMap` (3:2 SVG on `$color2`, segment lines, start/end markers, scale bar,
  "N ↑", Speed · RPM · Fuel · None control, legend chips, tap → tooltip card with time, km/h, rpm,
  L/h), `SpeedStrip`, "simulated GPS" badge, empty states ("No GPS track for this trip.", no
  samples, trip not found). `TripScreen` rows' **Open** now navigates there (inline expand
  removed) and no longer imports `@/shared/lib/units` — distances are km, metric only.
- **Tests (+58 tests, +3 suites: 948 tests / 123 suites after the review fixes).** `track.test.ts` (projection fit and
  y-flip, aspect, `scaleBar` 500 m at 320 px, nearest-sample ties, segment count/grey, buckets,
  legends, verdicts at ±2 / ±5 / ±12 % and around the thresholds, `unknown`, `speedProfile` cap,
  loop closure and 2 km length), `trip.test.ts` (`obdDistanceKmFromSamples` = `tripStats` distance),
  `trackRecorder.test.ts` (mock source → points advance with the live speed, closing fix, 40 km/h
  default; BLE path unchanged), `useTripRecorder.test.ts` (core: `loadTrip` one read, old CSV,
  missing file; simulator `stopRecording` writes the track and flags the summary),
  `TripDetailScreen.test.tsx` (60 s simulator recording → `ok` + badge + 12 segments, a 3 min
  recording draws the closed loop, a hand-built lap closes,
  overlay recolour + legend, tap tooltip, mismatch card, pre-GPS trip, missing CSV / unknown id),
  `TripScreen.test.tsx` (Open → `/trip-detail` with the id; km regardless of the legacy units
  setting). Context graph: new `concept:gps-obd-check`.
- **Deviations.** `scaleBar` takes an optional 4th `height` argument so the bar matches a
  height-bound fit (the plan's signature only had width), and its nice lengths continue past 5 km
  (10 / 20 / 50 / 100 km) for long drives. Extra pure helpers `nearestPoint` and
  `formatBarLength`. The synthetic generator advances by speed × the actual elapsed time (≈ 5 s per
  tick) and adds a closing fix on stop, so GPS and OBD distances cover the same span (otherwise up to
  5 s of driving is lost and a 60 s trip could miss the `ok` band). "simulated GPS" is persisted as
  `TripSummary.syntheticTrack` because `isSyntheticTrack()` alone cannot tell a reopened trip's
  origin. The UI test stubs `loadTrip` with the in-memory files because the UI Jest project cannot
  run the variable-specifier `import()`; the real read is tested in the core project. Speed values
  for the overlay come from the nearest sample with no maximum time gap.
- **Review fixes.** (1) The plan's "simulator trip with ≥ 10 fixes renders a closed loop" and its
  60 s demo cannot hold on a 2 km loop at 40 km/h (10 fixes ≈ 500 m, the first straight): the loop
  closes after one lap, about 3 min. Kept the plan's 2 km geometry, corrected the docs (3 min demo)
  and added a real 3 min simulator recording test asserting the closed loop. (2) Fuel-rate buckets
  collapsed on a steady fuel rate (quartiles `[v, v, v]` → every segment red, repeated legend labels
  and duplicate React keys): edges are now rounded to the legend's 0.1 L/h and kept only when
  distinct and above the minimum, so a steady trip is one middle-colour bucket labelled with its
  value; legend chips are keyed by index. (3) Arc-length steps cut the 60 m corners, so a steady
  90 km/h simulator drive read > 3 % short (`check`): steps are now chords of speed × time
  (`syntheticLoopAdvance`, bisection), and tests drive 40 / 90 / 130 km/h for 10 min and assert
  `ok` with |Δ| < 0.5 %.

---

## Plan 14 — Mode 22 charts and measuring groups (2026-11-09)

[Plan 14](./plans/14-mode22-charts-measuring-groups.md) landed: extended (Mode 22) DIDs flow
through the one demand-driven poll loop, so they plot in Charts, update live on the Extended PIDs
screen, and can be viewed as VCDS-style measuring groups from label packs. All in the simulator;
the deferred on-car part (which Golf DIDs answer, module-scoped groups, KWP `21` over TP2.0, a
DIDs-per-sweep cap) is untouched.

- **Keys (core).** `shared/obd-core/obd/liveKeys.ts`: a live key is a Mode 01 PID or
  `'22:<DID>'` — `extendedKey`, `isExtendedKey`, `didOfKey`, `splitPollKeys` (order kept,
  de-duplicated) and `labelForLiveKey(key, extendedDefs)` (`Engine RPM (rpm)`, `DPF soot mass
(calc.) (g) · 1701`, `DID 1701` when undeclared). Exported from `obd-core/index.ts`.
- **Session.** `DiagnosticSession.pollExtendedOnce(dids)`: sequential `22 <did>` on the current
  header, bytes after `62 <did>` (DID echo checked) or null; off CAN it sends nothing.
  `readPartNumber()` reads `22 F187` as printable ASCII and memoises the outcome per session
  (`null` included; a thrown read is forgotten), so `22 F187` goes on the bus at most once per
  connection. `SessionInfo.partNumber?` (additive).
- **EngineHost.** The sweep is `computePollPids` → `planSweep(keys, declaredDids, isCan)` (keeps a
  DID only on CAN when the active profile declares it) → `pollOnce(pids)` + `pollExtendedOnce(dids)`
  → `decodeExtendedSnapshot` (`engine-host/extendedSnapshot.ts`, pure) → one merged `setValues`.
  Alerts see the merged snapshot; trip samples stay Mode 01. Never re-addresses. The two reads have
  separate `try`s: a throwing extended read logs `live-data/extended` (deduped) and drops only that
  sweep's DIDs, so the Mode 01 snapshot is still published, alerted on and trip-sampled.
- **Extended PIDs screen.** `useExtendedPids` registers every declared DID key on the shared
  `liveDataStore` while the screen is **focused** (`useIsFocused`; released on blur, since hidden
  Tabs routes stay mounted and 15 sequential DIDs per sweep would slow Mode 01 app-wide) — `live`
  values; `refresh()` stays the raw one-shot read. A DID card prefers the measuring log's value
  only while a log runs (`useMeasuringLog` clears `latest` on stop), so a finished log never
  freezes a card. **Chart this** per row.
  **Measuring groups** section: `useEnginePartNumber()` (the connect-time `info.partNumber`,
  simulator fallback to the engine module `sampleIdent.F187`) → `findLabelPack` →
  `resolveMeasuringGroups` (`model/measuringGroups.ts`); one card per group with up to four
  `ValueCard`s, **Log group** (measuring log with only that group) and **Chart group**; undeclared
  DIDs read "No definition for … in this profile".
- **Connect.** `connectionService` reads the part number once after `session.connect()`, only on CAN
  and only when the active profile declares extended PIDs; a failure is logged
  (`connection/part-number`) and never fails the connect. When the profile gains DIDs later in the
  session (VIN auto-select runs after connect; or a manual switch to the Golf) and none is cached,
  EngineHost reads it then and stores it with the new `sessionStore.setPartNumber(session, pn)`.
  The VIN auto-select effect is now keyed on session + VIN, so that `info` patch never re-runs it.
- **Live store.** `liveDataStore` moved to `src/shared/state/liveDataStore.ts` (the
  `features/live-data/model` path re-exports it), so extended-pids registers its DID keys without
  a feature → feature import; live-charts' `useChartSeries` and EngineHost import the shared path.
- **Sensor readings.** The "Other" group skips extended `22:<DID>` keys, which now share the live
  store — experimental manufacturer values never appear among the standard sensors.
- **Charts.** The panel store moved to `src/shared/state/chartsStore.ts` (feature path re-exports
  it) with `addPanel` (`p<n>` ids, ≤ 4 series) and `removePanel`. `ChartsScreen` gained **Add
  panel** (picker from `chartKeyOptions`: effective Mode 01 PIDs, plus extended keys on CAN with
  DIDs) and **Remove**; header, stats and inspect lines use labels. `seriesToCsv(series, labels?)`
  adds a trailing `label` column (RFC 4180 quoting); without labels the old format is unchanged.
- **Label packs.** `MeasuringGroup` + `LabelPack.measuringGroups` (≤ 4 DIDs, key = VCDS group
  number); `measuringGroups(pack)` sorted numerically, DIDs upper-cased and capped. The Golf EDC17
  pack ships three illustrative groups: `075` DPF, `099` temperatures, `120` EGR / injection.
- **Simulator.** `buildScenario` seeds the engine module's `sampleIdent.F187` (ASCII) into
  `extendedDids` for profiles that declare DIDs, so the Golf answers `22 F187` = `03L906022LM` on the
  default header. Connect-flow sim fixtures are unchanged (the part number is read by the service,
  not by `DiagnosticSession.connect`).
- **Tests (7 new suites; 890 tests / 120 suites after the review fixes).** `liveKeys.test.ts`, `extendedSnapshot.test.ts`
  (decode, omission rules, one EngineHost-equivalent sweep on the Golf simulator),
  `sessionExtras.integration.test.ts` (`pollExtendedOnce` bytes / null, F187, no traffic on the
  Passat), `pollPids.test.ts` (mixed keys, `planSweep`), `registry.test.ts` (groups sorted, label
  fallback, cap), `measuringGroups.test.ts`, `chartKeys.test.ts`, `chartCsv.test.ts` (label column,
  quoting), and UI tests `EngineHost.extended.test.tsx` (Golf `22:1701` live; Punto / Passat send no
  `22` with a stale panel), `ExtendedPidsScreen.test.tsx` (part number at connect, live values,
  three groups, Chart group → 4-series panel + `/charts`, Chart this, Log group records only its
  DIDs, no pack ⇒ no groups, cards follow live values after a log stops, no DID registration
  while unfocused), `ChartsScreen.test.tsx` (picker → DID panel updates live with labels;
  Punto offers no DIDs; remove). Review fixes added `EngineHost.extended.test.tsx` cases (a
  throwing extended read keeps `010C`; Generic → Golf after connect reads F187) and a
  `SensorReadingsScreen.test.tsx` case (no `22:` value under "Other"); second review fixes added
  a `sessionExtras.integration.test.ts` case (an unanswered F187 is sent once across repeated
  `readPartNumber()` calls) and a `chartBuffer.test.ts` case (`pushIfNewer`). `test/mocks/router.ts`
  gained `useIsFocused` (`setMockFocused`, reset by `resetStores`).
- **Docs.** [extended-pids](./features/extended-pids.md) ("Live plot (deferred)" removed; Live
  values, Chart this, Measuring groups; stale `extendedPidService` / `extendedStore` lines
  corrected), [live-charts](./features/live-charts.md) (keys, picker, labels, CSV label column,
  shared store), [adaptations → label packs](./features/adaptations.md#label-packs-srcsharedlabels)
  (`measuringGroups`), [engine-host](./features/engine-host.md) (split sweep, default-header-only
  rule, composition list), [connection](./features/connection.md) (part-number read),
  [simulator](./simulator.md) (F187 seed); roadmap v0.3 "Mode 22 in charts" and v0.6
  "Measuring-block groups" ✅ (on-car pending).

**Deviations from the plan.**

- **No alert rule editor exists** (the Alerts screen only lists, toggles and deletes rules), so
  nothing lists extended keys there. A rule whose `pid` is an extended key already works: the alert
  engine evaluates the merged snapshot, and `planSweep` polls its DID.
- **CSV labels are a trailing `label` column, not a second header row:** the chart CSV is long
  format (one row per sample, keys in the `pid` column, not as column names), so a label row has
  nothing to line up with. Each row carries key + label instead.
- **The charts picker did not exist**; it was built (Add panel / Remove), and the panel store moved
  to `src/shared/state/chartsStore.ts` so "Chart this" adds no feature → feature import. Panels stay
  in memory (no persistence yet, as before).
- **Part-number read is gated on the profile declaring DIDs**, not only on CAN, so a DID-less CAN
  car (the Punto) sends no Mode 22 at all. It runs before `setConnected` so `info` carries it from
  the first publish. `DiagnosticSession.readPartNumber()` was added for it. Because that gate
  depends on the profile at connect time, EngineHost re-tries the read once the active profile
  declares DIDs (review fix); the resulting `info` patch is why the VIN auto-select effect now
  keys on session + VIN instead of the `info` object. Second review fix: an unanswered connect-time
  read used to be repeated by that retry (and again on each profile switch), costing a NO DATA
  timeout each; `readPartNumber()` now memoises its result per session, so it really is once.
- **Charts skip re-published values** (second review fix, not in the plan): a sweep whose Mode 01
  phase fails but whose DIDs answer merges the fresh `22:` values into the old Mode 01 entries,
  which keep their `ts`. `useChartSeries` pushed `values[pid]` on every `values` change, so that
  (and, already before plan 14, every pan / zoom re-render) appended duplicate points and CSV rows.
  It now uses `ChartBuffer.pushIfNewer` (points must be newer than the last one).
- `labelForLiveKey(key, extendedDefs)` takes the profile's DID definitions (a structural
  `LiveKeyDef[]`) instead of the profile, so obd-core imports nothing from `vehicles`.
- The full-sweep integration test lives in `engine-host/extendedSnapshot.test.ts` (obd-core tests
  cannot import the feature's decoder); `sessionExtras.integration.test.ts` covers the session side.
- The Golf `120` group includes `170A` / `170B` (no pack `measurements` label) to exercise the
  profile-name fallback.
- **`liveDataStore` moved to `shared/state`** (review fix; not in the plan) instead of
  extended-pids importing `live-data`'s `useLiveData`: the screen registers its DID keys on the
  shared store itself, focus-gated, so plan 14 adds no feature → feature import.
- **Extended-key filter in Sensor readings** (review fix): the plan assumed every consumer treats
  keys as opaque, but its "Other" group renders the whole live map.

---

## Plan 06 — Garage and learned profiles (2026-11-09)

[Plan 06](./plans/06-garage-learned-profiles.md) landed: users keep several cars, learn one from a
live connection or add it by hand, and every per-car feature follows the active car. The plan has
no deferred or owner section.

- **Core (pure, core-typechecked).** `src/shared/vehicles/userVehicle.ts`: `UserVehicle`,
  `LearnedIdentity`, `buildUserProfile` (identity from the user record, learned protocol / PIDs /
  VIN pattern, the experimental arrays only from a non-generic base, never `knownFaults`),
  `learnedFromSessionInfo`, `defaultVehicleName` ("Volkswagen 2009"), `makeForVin`,
  `pickVehicleForVin`, `isUserVehicleId`, `curatedProfileId`. `resolve.ts`: `resolveProfile(id,
garage)` (registry → garage car on its base → `generic`) and `simulatorSourceFor(id, garage)`.
  `VehicleProfile` gains an optional `baseProfileId`; `vehicleLabel` does not repeat a year a garage
  name already carries.
- **Store.** `src/shared/state/garageStore.ts` (`bolid.garage` v1): `add` / `update` / `remove` /
  `setLearned`, a sanitising `merge`, `garageExportJson`. Added to the splash hydration gate and the
  UI-test store reset.
- **Active profile.** `src/shared/state/activeProfile.ts` (re-exported by
  `features/vehicle-select/api/activeProfile.ts`): `getActiveProfile()` / `useActiveProfile()` with
  a shared one-entry cache. `vehicleStore` moved to `src/shared/state/vehicleStore.ts` alongside it
  (`model/vehicleStore.ts` re-exports it; same `bolid.vehicle` v1 file). Every former
  `getVehicleProfile(selectedProfileId)` site moved to them: EngineHost, `dtcService`,
  `diagnoseService`, `useAiDiagnose`, `useLiveData`, `DashboardScreen`, `SensorReadingsScreen`,
  `FaultCodesScreen` / `DtcDetailSheet`, and the adaptations, coding (+ car backup), dpf,
  extended-pids, module-scan, routines, sensor-tests and service-reset hooks. `grep
"getVehicleProfile(useVehicleStore"` returns nothing.
- **Learn this car.** `api/learnVehicle.ts`: `learnFromConnectedCar({ existingId?, baseProfileId? })`,
  `deleteGarageVehicle` (falls back to `generic` when selected, resets the simulated vehicle to the
  car's base when it was simulated; history, scans and trips are kept)
  and `autoSelectGarageCarForVin`.
- **VIN auto-select.** `settings.autoSelectByVin` (default on), settings **v4** via
  `migrateSettings` (v3 → v4 fills it, keeps every v3 field); Settings → "Recognise my cars by VIN".
  EngineHost checks each new `SessionInfo` and selects the matching garage car ("Car recognised"
  info notification).
- **Per-car stores.** `maintenanceStore` → **v2** `byVehicle` buckets keyed `vin:<VIN>` (learned
  garage car, with its `id:` key as an alias) or `id:<profile id>`. The v1 migration moves the
  global logbook under the car selected at upgrade; when the vehicle store has not hydrated yet it
  is parked under `legacy:v1` and adopted once both stores have. Tested from the exact v1 file shape
  in both hydration orders; the vehicle selection is untouched. `MaintenanceScreen` shows whose
  logbook it is and is keyed by car. `TripSummary.vehicleId` (set on stop) + per-car filter chips
  on the Trips screen (older trips group by their `header.profileId`, "Removed car" for a deleted
  garage car).
  History, scans and the dashboard layout needed no shape change.
- **UI.** `VehicleSelectScreen`: garage recognition card, **My garage** (copy, **Add from connected
  car** — disabled with a hint when not connected — **Add manually**, cards with VIN suffix / year /
  fuel / protocol / PID count, **Edit** / **Delete** with an `Alert` confirm, long-press edits),
  **Built-in profiles**. `VehicleEditorSheet` (name, year, fuel, base profile, notes; **Share garage
  as JSON** footer via `useGarageExport`); form rules in `model/vehicleDraft.ts`.
- **Simulator.** The Settings simulated-vehicle picker lists garage cars; `connectionService`
  builds a garage car's scenario from its base with the learned VIN, PID set and calibration id
  (`simulatorSourceFor`). A car learned from the simulated Golf reconnects with the same VIN and PIDs.
- **Tests (60 new, 8 new suites).** `userVehicle.test.ts`, `resolve.test.ts` (incl. the learned-Golf
  reconnect through `MockTransport`), `garageStore.test.ts`, `maintenanceStore.test.ts` (v1 file →
  v2 in both hydration orders, per-car isolation, alias fold), `learnVehicle.test.ts` (through the
  real `connectionService`: learn the Golf, history under its VIN, Punto not auto-selected and added
  as a second car, garage car as the simulated vehicle, delete fallback), `tripStore.test.ts`,
  `EngineHost.test.tsx` (auto-select on / off / other VIN), `MaintenanceScreen.test.tsx`, plus new
  cases in `VehicleSelectScreen.test.tsx` and `settingsStore.test.ts` (v4). 819 tests / 110 suites.
- **Docs.** [vehicle-select](./features/vehicle-select.md) rewritten (garage, learn, editor,
  resolution, auto-select, export, simulator); [vehicles/README](./vehicles/README.md) "User
  vehicles vs registry profiles"; [maintenance-log](./features/maintenance-log.md) "Per-car
  logbook" + migration; [architecture](./architecture.md) shared-store list with `garageStore`;
  [settings](./features/settings.md) (v4, the new toggle, garage cars in the picker);
  [trip-recording](./features/trip-recording.md) (filter, `vehicleId`);
  [engine-host](./features/engine-host.md) (engine 6, composition list back at 19 slices);
  [simulator](./simulator.md). Context graph: new `garage-learned-profiles` concept.

**Review fixes.**

- Live PID filter: a garage car on the generic base (added by hand, nothing learned) was cut down
  to generic's 18-PID placeholder list, because EngineHost / `useLiveData` / `DashboardScreen`
  tested `profile.id === 'generic'`. They now call `livePidFilter(profile)` (`userVehicle.ts`): no
  filter for any generic-based profile, the curated or learned list otherwise.
- `useModuleScan`, `useRoutines` and `useDpf` key their callbacks / the routine safety cleanup on
  the memoised `profile` instead of `profile.id`, so editing a garage car's base re-creates them
  (no `clearModule` against the old base's module list, no unmount cleanup over a stale routine
  list).
- `deleteGarageVehicle` also resets `settings.simulatedVehicleId` to the car's base registry
  profile when the deleted car was the simulated one.
- Replay-fixture export writes a registry id (`fixtureVehicleId` in `model/replayExport.ts`: the
  simulated car's `simulatorSourceFor` profile, or `curatedProfileId` of the selected car), never a
  `user:` id, so exported fixtures fit `fixtures/<vehicleId>/`. Supersedes plan 02's "registry id
  or `user:<id>`" note.
- `tripCarKey` falls back to `header.profileId` (always recorded) before "Unknown car", so trips
  recorded before the garage keep their grouping.
- `vehicleDraft.test.ts` covers the editor's form rules (year range / format, base profile,
  trimming, round-trip). 840 tests / 113 suites.

**Deviations.**

- VIN auto-select runs in **EngineHost** (an effect on `SessionInfo`), not inside
  `connectionService.connectInternal`: the plan's placement would add a new connection →
  vehicle-select import, which the composition rule forbids; EngineHost is the sanctioned place.
- Settings is **v4**, not v3: plan 12 already took v3 for `autoReconnect`.
- The simulator branch keys off the **simulated vehicle** (`settings.simulatedVehicleId`, which may
  now be a garage id), not the selected vehicle. With the selected vehicle the acceptance step
  "switch the simulated vehicle to the Punto" would still simulate the Golf garage car.
- `pickVehicleForVin(vin, vehicles)` drops the plan's third `profiles` argument: registry profiles
  are never auto-selected, the Vehicle screen keeps suggesting them via `suggestProfilesForVin`.
- `VehicleProfile.baseProfileId` (optional) is new, so fault guides (curated per registry id) follow
  a garage car's base (`curatedProfileId`); `DtcDetailSheet` now takes the `profile` instead of a
  `profileId`.
- New cars also get `year` from the VIN's model-year character when it is encoded; a learned car
  stores the calibration id, which the simulator replays too.
- Maintenance key details beyond the plan: the `id:` alias for a car learned after its logbook was
  started, and the `legacy:v1` parking key for the async hydration race.
- `vehicleStore` and the active-profile helpers live in `src/shared/state/`, not in the
  vehicle-select slice the plan names; the old paths re-export them. The per-car logbook needs the
  active car, and importing it from vehicle-select would have added `maintenance` to the
  feature → feature list. `maintenance` imports the shared paths, so the list stays at 19 slices;
  the other 16 readers can switch the same way (left as is to keep this change small).
- ECU count (mentioned in the roadmap row) is not learned: `SessionInfo` does not report one and the
  plan's `LearnedIdentity` has no field for it. Import of a garage file stays plan 13.

**Review fixes.**

- _Garage export did nothing on a device._ `useGarageExport` loaded the root `expo-file-system`,
  which on this SDK (56) has no `documentDirectory` and throws for `writeAsStringAsync`, so the
  export returned null without logging. The write + share now lives in
  `vehicle-select/api/garageExportFile.ts` (`saveGarageExport`). It uses `expo-file-system/legacy`
  and logs a `vehicle-select/export` warning on every null, including "no document directory".
  `garageExportFile.test.ts` mocks only the legacy module, so a root import fails it. The UI test
  now presses the button and checks that the garage is handed to the export.
- _Duplicate garage cars._ **Add from connected car** always added a new car, even when the
  connected VIN already belonged to one. It now reads **Re-learn from connected car** in that case
  and calls `learnFromConnectedCar({ existingId })`, which refreshes the car in place.
- _Stuck trip filter._ When the filtered car lost its last trip, the chip row could disappear and
  leave an empty list with no way to clear the filter. The filter now falls back to **All cars**
  (`TripScreen.test.tsx`).
- _New feature → feature import._ `maintenance` read `vehicle-select`; `vehicleStore` and
  `activeProfile` moved to `src/shared/state/` (see the deviation above).
- 825 tests / 112 suites after the review fixes.
- _Malformed `learned` block crashed the Vehicle screen and simulator connect._ `sanitizeGarage`
  checked only id / name / base, so a hand-edited record whose `learned` had no `supportedPids`
  array reached `GarageCard` and `simulatorSourceFor`, which read `learned.supportedPids.length`.
  It now validates `learned` (protocol, string PID array, VIN / calibration id string or null,
  `learnedAt`) and strips a malformed one, keeping the car as unlearned.
- _Rehydration merge untested, and it lost the stored cars._ The test named for the merge only
  called `sanitizeGarage`. A new test adds a car while `persist.rehydrate()` is reading and checks
  both cars survive in memory and on disk. It found a real loss: the add rewrote the file with only
  the new car, and zustand does not write after hydration unless it migrated, so the stored cars
  were gone on the next launch. `merge` now flags that case and an `onFinishHydration` listener
  writes the merged list back. 842 tests / 113 suites.

---

## Plan 04 — Doc debt zero (2026-11-09)

[Plan 04](./plans/04-doc-debt.md) landed: every slice under `src/features` has a spec, the 1:1
rule is enforced by a test, and the overview docs describe the app as it is. The plan has no
deferred or owner section.

- **New specs.**
  - [engine-host](./features/engine-host.md): why it exists (finding F1), where it is mounted, the
    five engines (poll loop with period-not-gap timing and error dedup, alerts + default-rule
    seeding, notifications fed by `dtcStore`, trip sampling, the 30 s readiness coach), the
    demand-driven `computePollPids` union, the "only slice allowed to read several feature stores"
    rule together with the 19 slices that break it today, and acceptance.
  - [more](./features/more.md): the 22 entries with routes and specs, **Check for updates**
    (`checkForUpdate` / `fetchAndReload`, `unavailable` in dev clients and builds without
    `expo-updates`), and the hidden-route reachability rule: 22 hidden routes are More entries;
    `/extended` (only from Info, plus a fault guide's **Related data**) and `/vin-decode` (also in
    More) are the Info-linked ones.
  - [sensor-readings](./features/sensor-readings.md): a standalone spec, because plan 07 is not
    next (wave 2 comes first). It covers the seven groups, the CAN-only injection DIDs and the
    "not available here" card. It says plan 07 deletes the slice and the spec together, with no
    alias (an alias whose slice is gone fails the test).
- **Verified.** [onboarding](./features/onboarding.md) matches the shipped code, so it is
  unchanged. In [can-sniffer](./features/can-sniffer.md) the `# app:` header line is now wired (see
  deviations).
- **Enforcement test.** `src/shared/lib/featureDocsSync.test.ts` (core project) checks that every
  `src/features/<slug>` has a `docs/features/<alias ?? slug>.md` and that every spec has a slice:
  - `ALIASES`: `inspection` → `used-car-inspection`, `maintenance` → `maintenance-log`;
  - `NO_SPEC_NEEDED` is empty;
  - `KNOWN_SHARED`: `tp20`.

  The rule is a pure `featureDocsProblems(slices, specs, rules)` that returns one message per
  problem. Four unit tests run it on synthetic trees: aliases and exemptions pass, a deleted spec,
  an aliased slice missing its aliased spec, a spec without a slice and a stale alias. A guard
  checks that the real tree contains the `engine-host`, `more` and `connection` slices and specs,
  so an empty directory listing cannot pass. It names slices rather than a count, so plan 07
  deleting `sensor-readings` does not trip it.
  Checked by hand as well: moving `engine-host.md` away turned the suite red
  (`src/features/engine-host has no docs/features/engine-host.md`). Restored. The audit's
  `for d in src/features/*/` loop prints no `MISSING`.

- **Overview docs.**
  - [phase2-mobile-app.md](./phase2-mobile-app.md): the feature map is now all 32 slices (slug ·
    route · spec), grouped Tier A / B / C like the audit. A step 5 (More) was added. Step 1 already
    said BLE is the default (plan 01).
  - Root `README.md`:
    - Status gains Phase 5, the VCDS-parity expansion + Phase 6b, the 2026-07 improvement plan and
      v0.2 in progress;
    - the More table gains Adapter health and Sensor readings;
    - a new 🧪 manufacturer-tier table lists module scan, adaptations, routines, coding, service
      reset and the bus sniffer, with the 🧪 note.

    "Running the app" already described the BLE default.

  - [docs/README.md](./README.md): the 1:1 rule now names the aliases, `tp20.md` and the new test.
    The index gains `phase2-mobile-app.md`, `improvement-plan-2026-07.md` and
    `vcds-parity-roadmap.md`. The `plans/`, audit and roadmap rows were already there.
  - [connection.md](./features/connection.md): `ScanScreen` → `ConnectionScreen` (with
    `StatusHero`, `DeviceRow`, the real `ADAPTER_NAME_HINTS`). The `linkStore` bullet lists all
    its fields (`link`, `stage`, `attemptStartedAt`, `device`) and actions (`beginAttempt`,
    `setStage`, `setLink`). The fictional `useAdapterStatus()`
    is gone; `useScan` / `useConnect` are documented with their real return shapes. The fictional
    `connectionStore` is replaced by `sessionStore` (shared) + `scanStore`, next to the existing
    `linkStore`. The service section names its real exports. Behaviour step 2 no longer claims an
    auto-connect to the last device. Every other identifier in the spec was grepped against the
    slice and exists.
  - [vcds-parity-roadmap.md](./vcds-parity-roadmap.md) "Login codes": it now says plainly that no
    KWP login code ships. Nothing sends `2B`; `udsCoding.ts` only says "optional login" in a
    comment. It links plan 22.
  - [architecture.md](./architecture.md): new "Engine host" and "Specs" paragraphs under "UI:
    feature-sliced".
  - [live-data.md](./features/live-data.md): links to the engine-host and sensor-readings specs.
    The fictional `usePidPolling(pids)`, `liveDataService` and `liveDataStore` shape are replaced
    by the real `useLiveData(pids?)`, the `liveDataStore` fields and `dashboardLayoutStore`
    (`bolid.dashboard-layout`). Two Behavior claims the code does not have are corrected: a PID with
    no answer is not dropped from later sweeps, and there is no stale-value marking.
  - [vehicle-info.md](./features/vehicle-info.md): the fictional `useVin()` / `useAdapterInfo()` /
    `useSupportedPids()`, `vehicleInfoService`, `connectionStore` and `infoStore` are replaced by
    `useVehicleInfo()`, `sessionStore.info` (`SessionInfo`) and `DiagnosticSession.connect()`. The
    Calibration ID row and the two buttons are now documented, and a Tests section was added.

- **Sensor-readings re-read loop fixed** (found in review). `injectionPids` was a new array on
  every render, so `readInjection` changed identity and its mount effect re-ran after every
  live-data update: five more Mode 22 requests per poll sweep, competing with EngineHost on the
  half-duplex adapter. The list is now `useMemo`'d on the profile id. New
  `SensorReadingsScreen.test.tsx` (simulated Golf) asserts 5 `readExtended` calls after mount and
  still 5 after three live-data updates. Without the fix it sees 11. The spec's hooks, Acceptance
  and Tests sections and [testing.md](./testing.md) were updated.
- **Sensor-readings stale reads cancelled** (second review). The injection read had no
  cancellation, so a session / profile change or **Refresh** during a five-DID read started a
  second read alongside the first, and whichever finished last won. The callbacks also set state
  after unmount. Each read now takes a run id (a `useRef` counter, bumped by every read and by the
  effect cleanup), and a superseded read sends no further DIDs and sets no state. Two new tests
  hold the first `readExtended` open: Refresh then release gives 6 calls (it was 7), and unmount
  then release gives 1 (it was 2).
- **Graph.** After `graph.py build`, `documents` edges went from 41 to 45: one each for
  engine-host, more and sensor-readings, plus a name-match edge from `sensor-readings.md` to
  `feature:sensor-tests`. `neighbors feature:engine-host` lists `doc:features/engine-host`. No new
  concept was needed.
- **Tests.** 102 suites, 759 tests (was 100 / 750). `npm run ci` is green.

**Deviations from the plan.**

- _Sniffer `# app:` line wired._ The can-sniffer spec said it was "not wired yet — plan 08 owns
  versioning". Plan 08 has since shipped `APP_VERSION`, so instead of re-recording the gap,
  `finishedCapture()` now passes `APP_VERSION` to `buildCaptureHeader`. The existing
  `snifferController.test.ts` header test asserts `header.appVersion` and the `# app:` line, and
  fails without the change. The spec example and its Tests section were updated.
- _sensor-readings is standalone_ (the plan's "otherwise" branch), so `ALIASES` has no
  `sensor-readings` entry. Plan 07 must not add one either: it deletes the slice and the spec
  together, and `featureDocsProblems` reports an alias whose slice does not exist. The matching
  instruction in [plan 07](./plans/07-information-architecture.md) ("add the alias only if plan 04
  created the doc") was corrected to say so.
- _Adapter health is not in the 🧪 table._ The plan lists it among the README's Tier C rows. The
  [audit](./audit-2026-11.md) puts `adapter-health` in Tier B, and it is read-only, standard AT
  commands with nothing illustrative. It is therefore in the plain More table, without 🧪. The 🧪
  table has the other six (module scan, adaptations, routines, coding, service reset, sniffer).
- _More: no grouping, badge or search._ The plan's "after plan 07, grouped" and "`experimental`
  badge, search" describe plan 07's work. The spec documents today's flat list and says those parts
  are not built yet.
- _Phase-2 table._ The plan asked for "slug · route · spec". The Tier C table carries the 🧪 note
  in its heading rather than in a column.
- _Prettier._ It also normalised existing blank lines and table padding in `architecture.md`,
  `live-data.md`, `vcds-parity-roadmap.md` and `docs/README.md`. These are whitespace-only changes.
- _Not fixed: other layering debt._ The architecture rule "never on another feature" is broken
  widely, not by a few slices. Outside engine-host, 19 slices import another feature in production
  code (29 import lines). 16 of them read `vehicle-select`'s `vehicleStore`. The other imports are
  adaptations → module-scan, coding → adaptations, connection → onboarding, history → fault-codes,
  live-charts → live-data and onboarding, sensor-readings → live-data and settings → connection.
  [engine-host.md](./features/engine-host.md#the-composition-rule) and
  [architecture.md](./architecture.md) state the rule as the target and list the current breaks
  instead of claiming it holds. This plan documents and does not refactor; moving `vehicleStore`
  into `src/shared/state` would clear most of them, and is left for plan 07 / a later cleanup.
- _Not fixed: identifier drift in other specs._ The plan asked for an identifier check only in
  `connection.md`. Review extended it to `live-data.md` and `vehicle-info.md` (both fixed above).
  A scan of `docs/features/*.md` for `useX` / `xStore` / `xService` names missing from `src`
  still finds older placeholder names in specs this plan did not touch: `alerts.md`
  (`alertService`, `notificationService`, `useAlertEngine`, `useAlertRules`), `coding.md`
  (`codingService`, `useCodingUnlock`, `useCodingWrite`, `useModuleCoding`), `extended-pids.md`
  (`extendedPidService`, `extendedStore`), `fault-codes.md` (`useClearDtcs`, `useReadiness`),
  `live-charts.md` (`useChartConfig`), `notifications.md` (`useMaintenanceReminders`,
  `useNotificationPermission`, `useNotificationPrefs`), `performance-tests.md`
  (`performanceService`, `usePerformanceHistory`), `sensor-tests.md` (`sensorTestService`,
  `useLiveSensor`, `useMode06`, `useModuleSensors`), `settings.md` (`useAdapterSource`) and
  `vehicle-select.md` (`useSelectedVehicle`, `useVehicleProfiles`). "Doc debt zero" here means
  every slice has a spec and the rule is enforced. These names are left for a later docs pass.

---

## Plan 02 — Log → fixture pipeline (Part A) (2026-11-09)

[Plan 02](./plans/02-on-car-validation.md) Part A landed: any adapter session can become a replay
fixture, committed fixtures run in CI against the real `DiagnosticSession`, and the simulator is
recorded into fixtures for every registry profile. Not done yet: Part B, the on-car sessions
(drive the Golf, Punto and Passat, export one fixture per flow, fill the tables). The procedure is
in [testing.md → Recording results](./testing.md#recording-results).

- **Fixture format** (`transport/logReplay.ts`). `ReplayFixture` gains:
  - `sequences`: every reply per command, kept only for commands whose reply changed;
  - `meta`: `source` (`simulator` | `car`), `vehicleId`, `flow`, `adapter`, `protocol`,
    `appVersion`, `notes`;
  - `expect`: `protocol`, `vin`, `supportedPidCount`, `storedDtcs`, `pendingDtcs`, `milOn`, and
    two additions, `freezeFrameCount` and `storedDtcsAfterClear`.

  `fixtureFromLog(entries, name?, { meta?, keepSequences? })` fills `sequences` by default.
  `ReplayTransport` keeps a per-command cursor over `sequences` (repeating the last reply when
  exhausted), then falls back to `pairs`, then to `OK` / `NO DATA`.

- **Line structure is now kept.** The old log turned every `\r` into a space and trimmed each BLE
  chunk, and `fixtureFromLog` joined chunks with spaces. A multi-ECU reply (the Punto's two `0100`
  lines) or an ISO-TP printout (a CAN VIN) therefore replayed as one line. The parser then read the
  wrong bytes: the F4 phantom-DTC bug, inside the fixture. Now:
  - `logTxText` / `logRxText` (new, in `transport/recordingTransport.ts`) are the single
    normalisation for both `connectionService.withLog` and `RecordingTransport`;
  - rx chunks keep their line breaks as `\r` and are not trimmed;
  - `fixtureFromLog` concatenates a command's chunks as sent, then rebuilds the lines.

  The Settings log view and `formatLogLine` collapse whitespace for display, so the UI looks the
  same. One existing `logReplay.test.ts` expectation changed for this reason, from
  `'SEARCHING... 41 00 …'` to `'SEARCHING...\r41 00 …'`.

- **`RecordingTransport` + `recordSession(inner, run, meta, options?)`**: they record tx/rx in
  order, disconnect in `finally`, and return the fixture. The callback connects the session itself.
- **Simulator fixtures.** `transport/simFixtures.ts` records `connect`, `faults` and `clear` per
  registry profile into `transport/fixtures/<id>/sim-<flow>.json`, 12 files in all, and the files
  are committed. The `expect` block comes from the scenario, not from the recording. Files are
  deterministic: no `createdAt`, no app version.

  `npm run fixtures:sim` runs `scripts/record-sim-fixtures.ts`, which also removes stale `sim-*`
  files, through `scripts/run-ts.cjs`. That is a 30-line runner on the existing `typescript`
  devDependency (`ts.transpileModule` as a `.ts` require hook), so no tsx / ts-node was added.
  `tsconfig.json` (core) now typechecks `scripts/**/*.ts`.

- **Tests.** Suites went from 94 to 100, tests to 750 (after the review fixes).
  - `fixtures.replay.test.ts`: every committed fixture passes `checkReplayFixture`
    (`transport/fixtureCheck.ts`, which returns one message per mismatch). Each fixture's
    `meta.vehicleId` must match its folder, and `sim-` is reserved for `source: 'simulator'`. A car
    fixture must be listed in its doc's table. A permanent test checks that a deliberately wrong
    `expect` is reported, field by field.
  - `sim-fixtures.freshness.test.ts`: the committed files equal a fresh recording (none missing or
    stale). It also checks that the recording is deterministic and that a changed scenario VIN no
    longer matches. Checked by hand as well: editing the Punto calibration ID in `scenarios.ts`
    turned the suite red. Reverted.
  - `recordingTransport.test.ts`: the normalisation, tx/rx order, an identical `SessionInfo` on
    replay for all four profiles (including the multi-ECU Punto and the K-line Passat), a clear
    flow replayed before and after through `sequences`, and disconnect when the flow throws.
  - `logReplay.test.ts`: sequences replayed in order and then repeating the last reply; `pairs`
    still first-wins; BLE chunks split mid-line; a replayed multi-ECU reply still parses as two
    frames; `meta` / `expect` survive a JSON round trip.
  - `fixtureCheck.test.ts`: the shapes a real export has but a simulator recording does not, a
    flow logged after the connect (no `0100`) and a clear flow with two `03` reads before the `04`.
  - `replayExport.test.ts` and `SettingsScreen` tests for the export (simulator, car, wrapped log),
    see below.
- **Settings export.** A **Flow name** field (default `session`) sits next to **Export as replay
  fixture**. `model/replayExport.ts` (pure) builds the fixture and the file name
  `bolid-replay-<vehicleId>-<flow>-<stamp>.json`. `meta` carries:
  - `adapter` and `protocol` from the live session;
  - `appVersion` from `APP_VERSION`;
  - `vehicleId` from the selected profile (`vehicleStore`), or the simulated car in simulator mode.

  On success the copy reads "Saved <file>. Clear the log before recording the next flow."

- **Review fixes.**
  - _Fixtures recorded mid-session._ The session script clears the log before each flow on an
    already-connected session, so only `connect` holds `0100`. `checkReplayFixture` used to call
    `connect()` on every fixture, so every other car fixture would have failed with "no reply to
    0100". It now connects only when the fixture has a `0100` reply (`hasConnectTraffic`).
    Otherwise it attaches the session to the replay transport directly, checks only the
    non-connect expectations, and reports any `protocol` / `vin` / `supportedPidCount`
    expectation on that fixture.
  - _Clear flows with several `03` reads._ `storedDtcsAfterClear` used to read the next `03` in the
    sequence, which is wrong when the Faults screen read `03` more than once before the `04`. The
    checker now calls the new `ReplayTransport.skipToLast('03')` after the `04`, so it checks the
    last recorded answer.
  - _Wrapped adapter log._ The ring buffer counts the entries it overwrites (`dropped`, reset by
    **Clear**, published with the snapshot). When it is above 0, the Settings hint and the saved
    message say the export starts mid-session, and the fixture records `meta.droppedEntries`. The
    session script's `live` flow is now about 30 s (it was 2 minutes, which wraps a 300-line log),
    and testing.md / simulator.md / settings.md mention the 300-line cap. The capacity itself is
    unchanged.
  - _Car branch tested in the screen._ A `SettingsScreen` test exports with
    `adapterSource: 'ble'` and checks `meta.source: 'car'` and the selected profile's id.
  - _The export could not write on a device._ The hook loaded the root `expo-file-system`, which
    on this SDK (56) has no `documentDirectory` and throws for `writeAsStringAsync`. Every export
    therefore returned null, and nothing was logged. The write + share now lives in
    `settings/api/replayFixtureFile.ts` (`saveReplayFixture`). It uses `expo-file-system/legacy`,
    like the sniffer's `captureExport.ts`, and logs a `settings/replay-export` warning on every
    null, including the "no document directory" case. `replayFixtureFile.test.ts` mocks only the
    legacy module, so a root import fails it. `useLogFixtureExport` now only tracks `busy`.
  - _Stale saved message._ The "Saved …" status stayed up until the screen unmounted, so it hid the
    "log is full" warning on the next flow. **Clear** now resets it. The status also remembers the
    `dropped` count at export time, and the warning replaces it as soon as the log wraps further. A
    `SettingsScreen` test covers export → Clear → export → wrap.
  - _Mislabelled exports after a source switch._ The export reads `meta.source` / `vehicleId` /
    `adapter` / `protocol` when **Export** is pressed, but switching the adapter source did not
    clear the log, so a simulator log could be exported as `source: 'car'` (and the reverse).
    `connectionService.switchAdapterSource` now calls `clearAdapterLog()`, and `withLog` takes the
    connect's `stale()` guard so a connect superseded by the switch logs nothing more. Two
    `connectionService.test.ts` cases cover both (the second fails with the guard removed).
  - _Validation rules tested on bad input._ Every doc is still the empty template and no car
    fixture is committed, so the per-vehicle `observedProtocol` and table checks passed without
    checking anything. The rules are now pure functions in `vehicles/validatedOn.ts`
    (`validationFrontMatterProblems`, `validatedOnTableProblems`, `carFixturesFor`, plus
    `parseFrontMatter` moved out of the test), used by the per-vehicle checks and unit-tested on
    synthetic input: wrong protocol, malformed date, one field without the other, an unlisted car
    fixture, a row naming a non-car (`sim-*`) or missing fixture, no section, an empty table.
  - _All eight `expect` fields shown to fail._ The permanent wrong-expectation test now also sets
    a wrong `pendingDtcs`. A second test on the Golf `sim-faults.json` sets a wrong `pendingDtcs`
    and `freezeFrameCount` and checks both messages.

- **Vehicle docs.** The three vehicle docs gain empty `validatedOn:` / `observedProtocol:`
  front-matter and an empty "Validated on the car" table. A new `vehicles/validatedOn.ts` parses
  the table and holds the validation rules (unit-tested on bad input, see the review fixes).
  `vehicle-docs-sync.test.ts` now checks four rules per vehicle doc:
  - a recorded `observedProtocol` equals `expectedProtocol`;
  - `validatedOn` is `YYYY-MM-DD`, and is set together with `observedProtocol`;
  - the table exists;
  - it lists exactly the committed car fixtures, and every listed file exists.

  The front-matter parser now tolerates CRLF.

- **Docs.**
  - [simulator.md → Replay fixtures](./simulator.md#replay-fixtures): format, recorder, where the
    files live, the two tests.
  - [testing.md](./testing.md): `fixtures:sim`, the new automated suites, and "Recording results"
    rewritten as the Part B session script plus the post-session procedure.
  - [vehicles/README.md](./vehicles/README.md): front-matter fields, the table template, and that
    simulator fixtures are not validation.
  - [features/settings.md](./features/settings.md): the export and the log normalisation.

  There is a curated `concept:replay-fixtures` in the context graph, and the roadmap rows
  "On-car validation log" and "Log → fixture pipeline" are ✅ with on-car pending.

**Deviations from the plan.**

- `appVersion` comes from the existing `APP_VERSION` (`shared/lib/appInfo.ts`, added by plan 08,
  read from `app.json`), not `expo-constants`. No new dependency.
- The Settings export sets `meta.source: 'simulator'` (and the simulated car) in simulator mode,
  not always `'car'`, so a simulator session can never pass for validation.
- The line-preserving log normalisation and `fixtureFromLog`'s chunk joining (above) were not in
  the plan, but without them the fixtures could not replay the multi-ECU or ISO-TP answers.
- Fixtures are recorded for all four registry profiles, `generic` included; the acceptance named
  three. Profiles without `knownFaults` seed `P0113` + `P0562` for the DTC flows.
- `expect` gains `freezeFrameCount` and `storedDtcsAfterClear`, so the `faults` and `clear` flows
  assert their own results.
- The "wrong expectation fails" check is a permanent test through `checkReplayFixture`, not a
  one-off edit that is then reverted.
- `sequences` leaves out commands whose reply never changed, which loses nothing because `pairs`
  replays them.
- The TS runner is a small `typescript`-based `scripts/run-ts.cjs` instead of `ts-node` / `tsx`.
- Settings reads `selectedProfileId` from `features/vehicle-select/model/vehicleStore`, a feature →
  feature import. Other features already import that store the same way (extended-pids, coding,
  dpf…); moving it to `shared/state` is left to plan 06 (garage).
- The session script's `live` flow is about 30 s instead of the plan's 2 minutes, so it fits the
  300-line adapter log. Non-connect car fixtures replay without the connect handshake, which the
  plan did not specify.
- `recordSession` does not connect: the callback calls `session.connect()` itself (the plan says
  `recordSession` connects). Only the disconnect is in `finally`. Every caller (`simFixtures.runFlow`,
  the tests) connects first inside the callback.
- The Settings component test replaces `useLogFixtureExport` with a double: Jest cannot run the
  hook's variable-specifier `import()`. The file contents are covered by `replayExport.test.ts`, and the write + share by
  `replayFixtureFile.test.ts`.

---

## Plan 08 — Signed release build, versioning, OTA updates (2026-11-09)

[Plan 08](./plans/08-signed-release-ota.md) landed. Not done yet: the owner-only setup (upload
keystore, four GitHub secrets, `eas init` / `eas update:configure`, `EXPO_TOKEN`) and the first
`v0.2.0` tag. These now sit in a new **Owner actions (deferred)** section of the plan. Until then,
main builds stay debug-signed with a CI warning and `ota-publish` is skipped with a warning. The
procedure is in [release.md](./release.md).

- **`plugins/withReleaseSigning.js`** (registered in `app.json` `plugins`). It edits the generated
  `android/app/build.gradle` at prebuild:
  - adds a `release` signing config, created only when `BOLID_KEYSTORE_PATH` is set, that reads the
    store password, alias and key password from the environment when Gradle runs;
  - points the `release` build type at it only when that variable is set, so it falls back to the
    debug key otherwise;
  - writes `versionCode` from `BOLID_VERSION_CODE`, and sets `expo.android.versionCode` to the
    same value so Expo's own version step agrees whatever order the mods run in.

  A set path whose file is missing, or a missing password, stops the build with a `GradleException`.
  A malformed `BOLID_VERSION_CODE`, or an Expo template that has lost one of the anchors, fails
  prebuild. No secret and no path is ever written into the file. The pure transform
  (`applyReleaseSigning`) is exported for the check script.

- **Checked on this workstation against the real Gradle project.** I ran `expo prebuild` with the
  plugin, then `gradlew :app:signingReport` four times:
  - no env: `Config: debug`, the debug keystore;
  - throwaway test keystore + env: `Config: release`, the test cert;
  - path but no password: fails with "BOLID_KEYSTORE_PASSWORD must be set…";
  - path to a missing file: fails with "…no keystore exists at…".

  The throwaway keystore was deleted afterwards. I re-ran prebuild without `BOLID_VERSION_CODE`, so
  the local `android/` is back to `versionCode 1` with the plugin's block in place. `npm run
android:apk` is unchanged.

- **`scripts/check-signing-plugin.mjs`** runs the plugin against
  `scripts/fixtures/app-build.gradle`, a verbatim copy of the file Expo SDK 56 generates. It checks
  10 things:
  - the env-driven signing config;
  - the conditional release reference, with the debug build type untouched;
  - `versionCode` with and without the variable;
  - that no secret leaks into the file;
  - idempotence;
  - that malformed codes are rejected;
  - that a template change fails loudly;
  - that the real `expo/config-plugins` `appBuildGradle` mod chain gives the same output;
  - that `expo.android.versionCode` is set.

  To prove the script can fail, I removed the release-reference rewrite: 2 checks failed. Reverted.

- **`scripts/check-version-sync.mjs`** checks that `package.json`, `package-lock.json` and
  `app.json` agree on the version. `--tag vX.Y.Z` also checks the tag (CI uses this on tag builds),
  and `--write` syncs app.json while keeping its formatting and CRLF line endings. The new npm
  `version` script (`check-version-sync.mjs --write && git add app.json`) makes `npm version
minor|patch` bump all three in one commit and tag. I checked this end to end in a scratch git
  repo: one commit, three files, tag `v0.2.0`. New script `check:release` runs both checks;
  `npm run ci` now includes it.
- **CI (`ci.yml`):**
  - Triggers add `tags: ['v*']`.
  - `verify` gains the release-config step.
  - `release-android` is renamed `build-android` and runs on `main` and `v*` tags. In order: on tags,
    check that the tag matches the version; restore the keystore; prebuild with `BOLID_VERSION_CODE`
    set to the run number; `assembleRelease bundleRelease`; check `aapt2 dump badging`
    (`versionCode` = run number, `versionName` = version); whenever a keystore was restored, check
    that `apksigner verify --print-certs` succeeds (under `pipefail`, so a failed verification is
    not masked by `tee`), prints a signer certificate, and has no "Android Debug"; upload the artifact
    `android-v<version>-<run>` (`.apk` + `.aab`).
  - `gh release create … --verify-tag --generate-notes` runs **only for tags**. Main pushes no
    longer create `v0.1.0-buildN` releases.
  - New `ota-publish` job (tags, after the build) runs `eas-cli update --branch production`.
  - Validated with the `yaml` parser (all three workflow jobs) and `bash -n` on every `run:` block.
    GitHub Actions itself cannot be run here.
- **OTA:** `eas.json` gives the `preview` and `production` profiles their channels. In `app.json`
  `updates`:
  - `checkAutomatically: "ON_ERROR_RECOVERY"`: no silent launch check. The generated manifest now
    has `EXPO_UPDATES_CHECK_ON_LAUNCH = ERROR_RECOVERY_ONLY`.
  - `requestHeaders: { "expo-channel-name": "production" }`.
- **Settings → About:** shows "Bolid Tester <version>" (new `src/shared/lib/appInfo.ts`, read from
  `app.json`), the OTA note, and a **Privacy policy** button that expands the policy in place. The
  text is in `src/features/settings/model/privacyPolicy.ts`, and the same text is published as
  [privacy-policy.md](./privacy-policy.md). It covers:
  - what stays on the phone;
  - the three network destinations: the AI server, including that the VIN is sent; the Expo update
    server, including the installation ID and the error-recovery check; the browser web search;
  - permissions, exports, deleting data, and contact.
- **Tests (+2 suites, +9 tests):**
  - `appInfo.test.ts`: app.json = package.json version; the `appVersion` runtime policy,
    `ON_ERROR_RECOVERY`, the channel header and the plugin registration; the `eas.json` channels.
  - `privacyPolicy.test.ts`: the in-app headings equal the doc's, in order; every in-app paragraph
    appears verbatim in the doc; the date matches; every network destination is named.
  - A new test in the existing Settings component suite: About shows the version, and the policy
    expands and collapses.

  `check-signing-plugin.mjs` and `check-version-sync.mjs` run outside Jest, through
  `npm run check:release`.

- **Docs:** new [release.md](./release.md) (versions, cutting a release, what CI does, signing,
  OTA channels and hotfixes, rollback, owner setup, acceptance checks) and
  [privacy-policy.md](./privacy-policy.md). Also updated: the README "Releases" section, the docs
  index, [testing.md](./testing.md) (`check:release`), [settings](./features/settings.md) (About),
  and the android-apk skill note on signing.

**Deviations from the plan**

- **No secrets in step `if:`.** GitHub Actions does not allow `secrets.*` in a step `if:`, so the
  keystore step decides in shell. It also does not pass `BOLID_KEYSTORE_PATH` unconditionally as
  the plan's YAML did: that would point Gradle at a missing file on a main build with no secret.
  Instead the step exports the variable via `$GITHUB_ENV` only after decoding the file. Without the
  secret, a tag build fails at that step and a main build warns and stays debug-signed.
- **Gradle block differs from the plan's snippet.** The plan's regex
  `release \{\s*\n(\s*)signingConfig signingConfigs\.debug` does not match the SDK 56 template:
  two comment lines sit between `release {` and `signingConfig`. The plugin instead finds the
  `signingConfig` line inside `buildTypes` → `release`. It also uses a marker comment for
  idempotence, creates the release config only when the variable is set, adds the fail-loud
  checks, and sets `expo.android.versionCode` as well as rewriting the gradle line.
- **Signature check only when a keystore was restored.** "Verify signature" runs only then, because
  a keystore-less main build is debug-signed by design. A `versionCode` / `versionName` badging
  check was added (from the Acceptance list).
- **Channel header (addition).** `app.json` `updates.requestHeaders` sets the `production` channel,
  because the CI APK is built by Gradle and not by EAS Build, so the `eas.json` channels do not
  reach it.
- **OTA skip.** `ota-publish` skips with a warning, rather than failing, while `EXPO_TOKEN` or the
  EAS project id is missing. Only the keystore is a hard requirement for a tag.
- **Privacy policy shown in the app.** "Link it from Settings → About" became an in-app expandable
  policy plus the doc, with no external link. There is no hosted copy yet (plan 30), and the repo
  URL may not be public. The policy says "uninstall, or Android Settings → Storage → Clear storage"
  for deleting data. **Plan 07 must update both copies** when it adds Settings → Reset all app data.
- **`npm run ci` runs `check:release`.** The plan asked only for the CI `verify` job. Both
  `npm run ci` and that job now run it.

**Skipped:** owner steps 3 and 5 (keystore, secrets, `eas init` / `eas update:configure`, the
`0.2.0` bump and tag; the v0.2 items are not all in). I did not run them, by rule.

**Review fixes**

- Privacy policy (both copies): Search the web also sends the selected car's name
  (`dtcWebSearchUrl(code, vehicleName)`), and the policy now says so.
- `ci.yml` "Verify release signature": added `set -o pipefail`. Without it, the default `bash -e`
  took the exit status from `tee`, so a failed `apksigner verify` passed. The step also requires a
  `Signer #1 certificate` line. It cannot match a specific upload-key fingerprint until the owner
  creates the keystore.
- `release.md` rollback: `npm version patch` on the previous tag recomputes the bad release's
  version, and that tag already exists. The doc now uses an explicit higher version
  (`npm version 0.2.2` after a bad `v0.2.1`).

---

## Plan 10 — Component tests and an end-to-end smoke flow (2026-11-08)

[Plan 10](./plans/10-component-e2e-tests.md) landed. The only part not exercised yet is the first
Maestro run, so that acceptance item moved to a new **Owner actions** section of the plan (see the
deviations). The workstation has the Android emulator and an AVD; what is missing is the Maestro
CLI (not installed), an APK built for the emulator, and a dispatch of `e2e.yml` (needs the branch
pushed). Details in [testing.md](./testing.md#end-to-end).

- **Jest, two projects** (`jest.config.js`): `core` (ts-jest, Node, `*.test.ts`, unchanged
  behaviour) and `ui` (`jest-expo` preset, `*.test.tsx`, roots `src/` + `test/`,
  `jest.setup.ui.ts`). Scripts `test:core` / `test:ui`; `npm test` and `npm run ci` run both.
  Dev dependencies: `jest-expo ~56.0.6` (via `npx expo install`), `@react-native/jest-preset
0.85.3` (jest-expo 56's peer: RN 0.85 moved its preset out of `react-native`),
  `@testing-library/react-native ^13.3.3`, `react-test-renderer 19.2.3` (= `react`), and
  `react-refresh 0.18.0`. The last one is not a test dependency: installing under
  `--legacy-peer-deps` regenerated the lockfile without the 26 auto-installed peer packages, and
  `react-refresh` is a required peer of `babel-preset-expo` (it loads `react-refresh/babel` whenever
  Metro bundles in dev with Fast Refresh). Without it `npm start` / `npm run android` could not
  bundle after a clean install; Jest and release bundles were unaffected, so CI stayed green. It is
  now an explicit devDependency, at the version the old lockfile had. The other dropped peers
  (reanimated, gesture-handler, worklets, framer-motion) are optional at runtime.
- **Tamagui renders under jest-expo with no shim.** `babel.config.js` skips the
  `@tamagui/babel-plugin` compiler when `NODE_ENV === 'test'`. Decision recorded in
  [testing.md](./testing.md#component-tests).
- **Harness:** `jest.setup.ui.ts` mocks `react-native-ble-plx` (radio `PoweredOn`), the BLE
  permission helper (granted), `expo-file-system` + `/legacy` (in-memory `Map`), `expo-sharing`,
  `expo-notifications`, `expo-haptics`, `expo-location`, `expo-secure-store`, `expo-updates`
  (`isEnabled: false`), `expo-router` and `react-native-safe-area-context`. It resets stores before
  each test, then unmounts and closes any live simulator session after it. `test/`
  (alias `@test/*`): `renderWithProviders`, `connectSimulator` (the real `connectionService.connect()`
  against `MockTransport`), `resetStores`, `mocks/router.ts` (`mockPush`, `setMockSearchParams`, a
  stand-in `Tabs`), `mocks/fileSystem.ts`.
- **Suites (8, 24 tests):** one per tab screen (Connection, VehicleSelect, Dashboard, FaultCodes,
  VehicleInfo, Settings, More) plus `test/app/RootLayout.test.tsx` (seven tab titles in order; every
  `src/app` route file registered). The Faults suite reads two simulator-injected codes (both rows
  and both descriptions), toggles the
  guide and runs the full **Clear codes** → confirm → empty re-read path.
- **Proved once:** removing `title: 'Faults'` from `_layout.tsx` fails the layout suite (the tab
  falls back to the route name `faults`); pointing `useDtcs` at a missing store module fails the
  Faults suite. Both reverted.
- **App change:** the More screen's rows (and **Check for updates**) gain `accessible`, so each is
  one accessibility element with its "Title. Subtitle" label. That is what makes
  `getByRole('button', { name })` reach them, and the start of the accessibility pass (plan 20).
  No rendering bugs turned up in the seven screens.
- **Typecheck / lint:** `tsconfig.app.json` adds `jest` to `types`, includes `test/**` and
  `jest.setup.ui.ts`, and maps `@test/*`. `npm run lint` / `format` also cover `test/` and the
  setup file.
- **E2E:** `.maestro/simulator-smoke.yaml` (fresh install → Settings → **Simulator (no car)** →
  **P0299** → Connect → **Connect to simulator** → Connected → Faults → **P0299** → **Clear codes**
  → confirm → **Stored (0)**) and `.github/workflows/e2e.yml` (manual dispatch + nightly cron, API 34
  x86_64 emulator via `reactivecircus/android-emulator-runner@v2`, JUnit report artifact; not a
  required check). Both are YAML-valid; the first run is pending (see above). CI's test step is renamed
  "Test (core + component)".
- **Numbers:** 668 tests / 92 suites (core 644 / 84, ui 24 / 8). The `ui` project adds about 10 s
  on a warm cache and about 30 s cold, well under the 2-minute budget.

Deviations from the plan:

- **Tamagui buttons are pressed by text, not by role.** Tamagui `Button` renders a `role="button"`
  view without `accessible`, so Testing Library's `getByRole` does not see it. Tests use `getByText`;
  `getByRole` is used where the control is an accessibility element (More rows, gauges as
  `progressbar`). Making every button accessible is plan 20's job.
- **`modulePaths: ['<rootDir>/node_modules/expo/node_modules']`** in the `ui` project: npm nests
  `expo-modules-core` under `expo/`, and jest-expo's setup requires it by name.
- **The layout test lives in `test/app/`**, not `src/app/`: expo-router would treat a `*.test.tsx`
  there as a route. `EngineHost` and `AppSplash` are mocked in that one file.
- **Plan-07-dependent cases skipped:** Settings' collapsed Developer section and the More search
  filter do not exist yet (plan 07). The Settings suite checks instead that the simulator sections
  (Simulated vehicle, Injected DTCs, Developer (simulator)) appear only in simulator mode. The
  Maestro flow omits the `Developer & simulator` tap.
- **Maestro flow adjusted to the real UI:** a successful connect navigates to Vehicle, so the flow
  goes back to the Connect tab before `assertVisible: 'Connected'`. It confirms the clear with a
  case-insensitive `(?i)clear` (Android can upper-case dialog buttons), asserts `Stored \(0\)`
  rather than `None`, and dismisses a first-launch notification prompt if one shows.
- **E2E builds a release-variant APK** (`assembleRelease`, debug-signed by prebuild, x86_64 only)
  instead of `assembleDebug`. The debug variant is an expo-dev-client build that loads JS from
  Metro, so it cannot run the flow without a dev server.
- **Store reset is by snapshot:** `resetStores` captures each store's state at module load and
  restores it with `setState(initial, true)`, instead of hand-written initial objects.
- **First e2e run moved to Owner actions** (review fix): installing the Maestro CLI and pushing to
  dispatch `e2e.yml` are outside an implementing session, so the acceptance item now carries a
  step-by-step procedure in the plan; the roadmap row reads "first Maestro run pending (owner)" and
  the plans README lists it as plan 10's owner part.
- **Pending persist writes are cancelled on reset** (review fix): restoring a store on
  `debouncedStorage` (history, dashboard layout) scheduled a flush that landed in the emptied
  filesystem during the next test and left an open timer after the last one
  (`--detectOpenHandles`). `resetStores` now calls `persist.clearStorage()` on every persisted
  store (its `removeItem` cancels the pending flush) before emptying the files, and
  `jest.setup.ui.ts` runs the same `cancelPendingWrites()` in `afterAll`. `--detectOpenHandles` is
  clean.

---

## Plan 05 — DTC database and the DTC detail sheet (2026-11-08)

[Plan 05](./plans/05-dtc-database.md) landed; only the Fiat P1 texts moved to a new **Deferred until
an on-car session** section of the plan (see the deviations). The data
files under `dtcDatabase/generic/` and `manufacturer/` were written beforehand by parallel
data-entry agents; this change builds the module around them.

- **Core (pure):** new `obd-core/obd/dtcDatabase/index.ts` — `DtcMake`, `DtcSeverity`,
  `DtcSystem`, `DtcInfo`, the exported SAE range table `DTC_RANGES` (longest-prefix match,
  `subsystemForCode`), `isManufacturerSpecific` (P1xxx, P3000–P33FF, B1/B2, C1/C2, U1/U2), the
  ordered `DTC_SEVERITY_RULES` (10 rules), `lookupDtc(code, make = 'generic')` and
  `describeDtc(code, make?)`; the module header carries the sourcing rules. Fallback text is
  `<System> — <subsystem> fault (<code>)`. `generic/p0.ts` / `generic/p2.ts` compose the part
  files (`P0_PARTS`, `P2_PARTS`). `manufacturer/vag.ts` is the single VAG home: re-exports
  `VAG_P1`, holds the native KWP 5-digit `VAG_DTC_TEXTS` moved from `uds/vagDtcs.ts`,
  `vagNativeDtcText()` (alias `vagDtcText`, native table only) and `saeCodeForVagCode()`;
  `uds/vagDtcs.ts` is now a compatibility re-export. `obd/dtc.ts` drops the 21-entry
  `DTC_DICTIONARY`, re-exports the database and gains `toDtc(code, make?)`. `udsModule` describes
  every UDS DTC with `describeDtc(sae, 'vag')` only (see the review fixes below).
  `aiDiagnosis.ts`: `DiagnosisOptions { focusCode }`, `focusInstruction()`,
  `buildDiagnosisMessages(s, { focusCode })` appends the focus user message,
  `localHeuristicReport(s, { focusCode })` lists the focused code first (or explains it when it is
  not in the read).
- **Data:** P0 1 333 codes, P2 694, P34xx 98, U0 271, B0 10, C0 10, VAG P1 157, VAG native
  5-digit 14, Fiat 0. Module source about 183 KB (budget 350 KB); largest file 520 lines.
- **Bundle delta:** `npx expo export --platform android`, Hermes bundle: HEAD `afe8e13`
  7 617 756 B → this change 7 809 759 B, **+192 003 B (+187.5 KB, +2.5 %)** for the whole plan
  (database, detail sheet, AI focus). Measured from a `git archive HEAD` copy sharing
  `node_modules`, so both builds use the same dependencies.
- **Profiles:** `VehicleProfile.make?: DtcMake`; Golf and Passat `'vag'`, Punto `'fiat'`, generic
  unset. `dtcService.readAll()` re-describes every list with `describeForMake(list, profile.make)`;
  the AI snapshot (`diagnoseService.gatherSnapshot`) does the same.
- **Feature UI:** new `fault-codes/ui/DtcDetailSheet.tsx` (Tamagui `Sheet`, modal, 85 % snap) with
  its pure view model `model/dtcDetail.ts` (`SEVERITY_META`, `buildDtcDetail`, `dtcWebSearchUrl`,
  `dtcShareMessage`, footer text); tapping the code / description in `DtcRow` opens it, the inline
  **Guide** stays. The guide links and per-code freeze frame moved into `ui/DtcGuideParts.tsx`,
  shared by the row and the sheet. Actions: **Explain with AI** →
  `/ai-diagnose?focus=<code>`, **Search the web**, **Share**. `AiDiagnoseScreen` reads `focus`,
  shows a focus card (make-aware, `useAiDiagnose().make`), auto-runs once when connected **and the
  screen is focused** (`useIsFocused()`), then consumes the param on its own route
  (`useNavigation().setParams({ focus: undefined })`) so a later "Explain with AI" on the same code
  runs again (the screen is a hidden tab and stays mounted). Review fix: the first version used the
  global `router.setParams`, which acts on whichever route is focused, and had no focus gate — a
  reconnect on the Connect tab started the run in the background, the param was cleared on Connect
  instead, and the focus card stuck and a repeat "Explain with AI" on the same code did nothing. The main button is then
  **Run full diagnosis** (unfocused); the report's **Re-run** repeats the report's own focus.
  `useAiDiagnose().run({ focusCode })`, `aiDiagnoseStore.focusCode`. `VehicleContext.make` carries
  the profile's make, so the local report's note for a focused code not in the read uses the same
  VAG / Fiat text as the detail sheet.
- **Simulator:** no new commands (the database is pure lookup); the existing Custom… injector
  from plan 01 drives the QA set.
- **Tests:** `dtcDatabase.test.ts` (20: coverage floors, part composition, key format and
  uniqueness across every file, family per file, native 5-digit table shape, size budget
  and line limit, spot checks, severity rules incl. every rule reachable, make handling, J2012
  manufacturer ranges, fallback text, malformed input, range table coverage, `dtc.ts` wiring,
  native table kept separate from the SAE space, TDI systems resolve from generic codes, `fiat`
  make wiring with a seeded entry, P0B / P0C hybrid fallback), `tp20Scan.test.ts` (+native text for
  the seeded comfort faults),
  `aiDiagnosis.test.ts` (+5 focused run, incl. make-aware note), `fault-codes/api/dtcService.test.ts`
  (4, against the simulator: VAG text for `P1557` on the Golf, range text on generic, the
  `P0135,P0301,U0121` QA set), `fault-codes/model/dtcDetail.test.ts` (5), `udsModule.test.ts`
  (UDS descriptions never use a colliding native KWP text: `P0520`/`P0522` read as oil pressure),
  `scanReport.test.ts` (+1 native KWP text in the TP2.0 block). `dtc.test.ts` unchanged and green.
  Suite **607 → 644 tests** (81 → 84 suites).
- **Docs:** `features/fault-codes.md` ("DTC database", "Detail sheet", behaviour, acceptance),
  `obd2-reference.md` § DTC encoding (pointer + J2012 range table), `features/ai-diagnose.md`
  ("Focused run"), `vehicles/README.md` (`make`), `roadmap.md` (both v0.3 rows ✅); context graph
  rebuilt with a `dtc-database` concept.

**Deviations from the plan:**

- **P0 coverage floor is 1 300, not 1 400.** The accurate P0 data holds 1 333 codes (uncertain
  assignments omitted on purpose), so the floor is the actual count rounded down to 50. P2 (≥ 600)
  and U0 (≥ 250) keep the plan's floors.
- **Fiat pack is empty — moved to a Deferred section (review fix).** No Fiat / FGA P1xxx
  definition could be stated with confidence (meanings differ between Marelli IAW and Bosch
  EDC16/17), so `FIAT_P1` is `{}` instead of the ~60 most common; Punto P1 codes show the range
  text. A guessed manufacturer text is worse than the honest fallback, so the data entry stays out;
  to keep the "nothing blocks on the car" rule, plan 05 now ends with a **Deferred until an on-car
  session** section (Multiecuscan procedure) and the plans README row names it. The `'fiat'` make
  wiring is tested with a seeded test-only entry (`dtcDatabase.test.ts`). The roadmap row says so.
- **P0B00–P0CFF have no entries (review fix: headers corrected).** `p0-part4.ts` holds P0A00–P0AFF
  only; its header and `p0.ts` used to claim P0A00–P0CFF. P0Bxx / P0Cxx codes show
  `Powertrain — Hybrid propulsion fault (<code>)`, P0Bxx with the plan's hybrid severity (high);
  a test pins the fallback. This is the main reason P0 holds 1 333 codes, not 1 400.
- **Native texts for the Golf simulator's TP2.0 faults (review fix).** The acceptance item "module
  scan (Golf simulator) VAG codes still show VAG text" could not be seen in the simulator: none of
  its module faults had a VAG text. `VAG_DTC_TEXTS` gained `00928` (locking module, front driver
  side, F220) and `01330` (central control module for central convenience, J393), the comfort
  module's seeded faults; `tp20Scan.test.ts` checks both resolve and `scanReport.test.ts` shows the
  text in the Auto-Scan block. The UDS modules' SAE codes keep their generic text by design.
- **P0 and P2 are composed from part files** (`p0-part1…4.ts`, `p2-part1…2.ts`) rather than one
  file each; `p0.ts` / `p2.ts` merge them and the test checks for overlap.
- **VAG P1 data lives in `manufacturer/vag-p1.ts`**, re-exported by `manufacturer/vag.ts`, which
  also holds the native KWP 5-digit table.
- **The VAG 5-digit table is native KWP only (review fix, blocker).** The texts carried over from
  HEAD's `uds/vagDtcs.ts` are native KWP1281/KWP2000 component numbers (00532 Supply voltage B+,
  01312 Powertrain data bus, …). Read as SAE bytes on the UDS path they collided with standardized
  P0 faults — 11 of 13 with a different meaning, worst `01312` = `P0520` and `01314` = `P0522`
  (oil pressure, high severity) shown as "Powertrain data bus — defective" / "Engine control
  module — no communication". Fix: `udsModule` no longer consults the table (`describeDtc(sae,
'vag')` only); the table is used for TP2.0 KWP `0x18` faults, now shown with their component
  text on the module-scan screen and in the Auto-Scan report (`vagNativeDtcText`); no fall-through
  from a 5-digit number into `VAG_P1`. `00564` (a P0234 byte form, not a native number) and
  `05463` are gone; `65535` stays because raw 0xFFFF is a real KWP answer. Texts were trimmed to
  the component (VCDS reports the failure type separately), e.g. `00532` "Supply voltage B+",
  `01299` "Diagnostic interface for data bus (J533)".
- **VAG P1 pack is the shared ME7 / EDC15-16 list, not TDI-first (review note).** The plan asked to
  start with glow plug, EGR, boost, DPF, swirl flap and G-sensor P1 codes. On EDC16/EDC17 those
  systems report generic SAE codes (glow plugs P0380–P0384 / P0670–P0684, DPF P2002/P2003, P242F,
  P2452–P2459, P2463, swirl / intake-manifold flaps P2008–P2025, EGR P0400–P0409), which resolve
  from `generic/` — a test checks they do. The TDI P1 codes shared with EDC15/16 (boost
  P1555–P1557, EGR P1400–P1408, now also `P1403` control deviation) are in the pack. Missing
  `P242F` (DPF ash accumulation) was added to `generic/p2-part1.ts`. `P2460`–`P2462` stay out: their
  J2012 wording could not be stated with confidence (uncertain codes are omitted, not guessed).
- **P3 ranges follow J2012 precisely:** P3000–P33FF manufacturer-controlled, P3400–P34FF generic
  (cylinder deactivation), P3500–P3FFF reserved and treated as generic (not manufacturer-specific).
  B2/C2/U2 also count as manufacturer-specific (J2012), not only B1/C1/U1.
- **Severity table extras:** the DPF class is `P2002`/`P2003`, `P242F` and `P2452`–`P2463`; the
  lost-communication rule covers `U0100`–`U01FF` (the plan's "U0100–U0199" read as the U01xx
  block). Rules apply whether or not the code has an entry.
- **VAG 5-digit number** in the sheet header shows for VAG and generic profiles and is hidden for
  Fiat (the plan said "when `vagCodeForDtc(code)` is non-empty", which is every P code).
- **"Copy" action is labelled "Share"** — it opens `Share.share` (no clipboard module installed),
  where the user can copy.
- **`diagnoseService.run({ focusCode })` does not exist;** the focus is threaded as
  `useAiDiagnose().run({ focusCode })` → `analyze(snapshot, onAnalyzing, { focusCode })`. The AI
  snapshot is also make-aware (not in the plan; same rule as the Faults screen).
- **Camshaft labels** `P000A`–`P000D` use J2012's `A Camshaft` / `B Camshaft` (A = intake / left /
  front, B = exhaust / right / rear), matching `P0010`–`P0025` (review fix).
- The settings **Custom…** input already existed (plan 01), so nothing was added there.
- Prettier was run on every file this change touched, so the Golf and Passat profiles (not
  Prettier-clean before) were reformatted along with their one `make` line; no content change.

---

## Plan 03 — Bus sniffer: save and share captures (2026-11-08)

[Plan 03](./plans/03-sniffer-capture.md) landed (everything above its "Deferred until an on-car
session" section; the VCDS recording and BLE throughput measurement are on-car pending).

- **Core (pure):** new `obd-core/obd/captureBuffer.ts` — `CapturedLine { t, raw, frame }` and
  `CaptureBuffer` (O(1) ring, default capacity `DEFAULT_CAPTURE_CAPACITY` = 20 000, `size`,
  `dropped`, chronological `lines()`, `clear()`; unparsed lines kept with `frame: null`).
  `canMonitor.ts` gained `CaptureHeader`, `formatCaptureCsv` (`# key: value` header, then
  `t_ms,id,dlc,bytes`, one row per frame, relative `t_ms`, upper hex, trailing `# raw:` block for
  unparsed lines) and `formatCaptureRaw` (header + one `t_ms<TAB>line` per input). Both exported
  from `obd-core/index.ts`.
- **Feature:** `snifferStore` gained `capturedLines`, `dropped`, `note`, `lastExportUri`,
  `setCapture`, `setNote`, `setLastExportUri` (`reset()` keeps the note). New
  `model/captureSession.ts` (module-level current capture), `api/captureExport.ts`
  (`buildCaptureHeader`, `captureFileName` → `bolid-sniff-<vehicleId>-<stamp>.csv|.txt`,
  `buildCaptureFile`, `shareCaptureFile`) and `hooks/useSnifferExport.ts`. The run lifecycle moved
  out of the hook into `model/snifferController.ts` (`SnifferController`, one per session:
  `start` / `stop` / `dispose`; `finishedCapture()`), so it is unit-tested in node. Start clears
  the capture and freezes a `CaptureContext` (vehicle id, session info, device name, note) in
  `captureSession.ts`, which the header is built from at Share time — so changing the car,
  reconnecting or editing the note after Stop cannot rewrite the file. Every line goes into the
  capture, counts are published in the 500 ms snapshot, export is refused while running or empty,
  and dispose (unmount / session change) stops `ATMA` and marks the run finished — also when it
  lands during the `ATH1` round trip before the monitor exists (the controller stops the monitor
  once setup returns and never creates the snapshot interval); Stop pressed mid-setup waits for it.
  `useSniffer` is now a thin binding. `SnifferScreen`: note input above Start (read-only while
  running), `captured N · dropped M`, **Share CSV** / **Share raw** (disabled while running) with
  a one-line explanation and the saved file name; a finished capture can also be shared while
  disconnected (Start is replaced by "Not connected — reconnect to start a new run."); the per-id
  table is unchanged.
- **Simulator:** the Golf scenario's `monitorFrames` is now 30 frames across 4 ids (TP2.0 channel
  setup `200`→`201`, tester session `7E0`→`7E8`) via a new `SIM_MONITOR_FRAMES` map in
  `transport/scenarios.ts`; other profiles unchanged.
- **Tests:** `captureBuffer.test.ts` (7: capacity eviction, order, unparsed lines, 25 000 lines,
  copy + `clear`), `canMonitor.test.ts` (+4: header lines, rows, relative `t_ms`, hex, `# raw:`
  block, raw dump), `sniffer.integration.test.ts` (+2: start → 20 lines → stop → CSV with the
  header and 20 data rows; Golf stream shape), `features/can-sniffer/api/captureExport.test.ts`
  (8: header, file name / MIME, write + share against mocked native modules, failure logged),
  `features/can-sniffer/model/snifferStore.test.ts` (1),
  `features/can-sniffer/model/snifferController.test.ts` (6: Start clears + freezes the header
  context against the simulator, export refused while running / empty, dispose while running
  releases the channel, dispose and Stop during ATMA setup, double Start). Suite **579 → 607
  tests** (77 → 81 suites).
- **Docs:** new `features/can-sniffer.md` (full spec, file formats, memory bound, "Record a VCDS
  session" guide); linked from `features/routines.md` § "Confirming a routine" and
  `features/tp20.md` § "Honest limits"; `simulator.md` (ATMA streaming + Golf frames);
  `roadmap.md` (Sniffer captures ✅, on-car pending). This also covers the `can-sniffer` spec item
  of plan 04.

**Deviations from the plan:**

- The capture buffer lives at module level (`model/captureSession.ts`) instead of a `useRef`, so a
  finished capture can still be shared after the screen is left and reopened (the store counters
  already survived; a ref would have left them pointing at an empty buffer).
- `CaptureHeader` gained an optional `dropped` (written as `# dropped: M`), and the header also
  prints `# lines:` / `# t_ms` explanation lines. Unknown protocol / adapter print as `unknown`; the
  `# note:` line is always present (empty when no note).
- `appVersion` is supported by the formatter but not wired in the app — there is no app-version
  source yet (plan 08 owns versioning).
- The export writes through `expo-file-system/legacy`, not the root `expo-file-system` that
  `useErrorLogExport` imports: on this Expo SDK the root module exports no `documentDirectory`
  and its `writeAsStringAsync` throws (the legacy API moved to `/legacy`). The other existing
  export hooks (error log, DTC report, measuring log, adapter health, chart, module scan, car
  backup) still use the root import, so on a device they most likely return null without
  writing — left for a follow-up, outside this plan.
- Pure export logic sits in `api/captureExport.ts` (unit-tested in node); `useSnifferExport` is a
  thin `busy` wrapper around it rather than a full copy of `useErrorLogExport`.
- The vehicle id comes from `features/vehicle-select/model/vehicleStore` (now imported by
  `model/snifferController.ts`; the existing pattern in `useDpf`, `useCoding`, …), a feature →
  feature import the repo rules discourage; there is no shared selector for it yet. Kept after
  review, consistent with plan 01's decision: moving the store into `shared/state` is a
  cross-cutting refactor (~20 importers; plans 06 / 18 / 32 name its current path) better done
  with plan 07 than inside plan 03.
- The hook-level lifecycle is tested through `SnifferController` rather than by rendering
  `useSniffer`: the jest setup is node-only (`*.test.ts`, no React renderer), and plan 10 owns
  component tests.
- `transport/scenarios.ts` was not run through Prettier (the file was not Prettier-clean before;
  formatting it would rewrite unrelated lines). Same for `routines.md` / `tp20.md`.

---

## Plan 12 — BLE robustness and connection diagnostics (2026-11-08)

[Plan 12](./plans/12-ble-robustness.md) landed (everything above its "Deferred until an on-car
session" section; on-car confirmation pending).

- **Auto-reconnect on by default + flap guard.** `settingsStore` default `autoReconnect: true`;
  persist **version 3**, with plan 01's `migrateSettings` extended by a `fromVersion < 3` step
  (`autoReconnect: p.autoReconnect ?? true` — a stored value survives). New pure
  `connection/api/flapGuard.ts` (`FLAP_WINDOW_MS` 60 s, `MAX_DROPS_PER_WINDOW` 3,
  `shouldAutoReconnect`, `pruneDrops`); `handleUnexpectedDrop()` records each drop and pauses with
  `FLAP_PAUSED_MESSAGE` on the third in a minute; a manual `connect()` resets it.
- **MTU + chunked writes** (`shared/transports/ble/BleTransport.ts`): `requestMTU: 247` only on
  Android (`Platform.OS`), negotiated `device.mtu` read after connect (23 fallback), new
  `linkInfo: BleLinkInfo | null` and `payloadForMtu()`; `write()` sends `mtu - 3` (floor 20) chunks
  in order.
- **Sleep / wake** (`obd-core/elm327/Elm327Client.ts`): `wakeAfterIdleMs` (default 20 000, 0
  disables), `lastIoAt`, `execWake()` (≤ 600 ms, never rejects; a wake timeout starts a drain like a
  command timeout), `init()` stamps after `ATZ`; monitor mode exempt. `connectionService` passes 20 000 for BLE and 0 for the simulator (half the
  scenario's `sleepAfterIdleMs` when it models sleep).
- **Drain-until-prompt**: a timeout starts a drain; `onData` discards the late reply through its
  `>`; the next command awaits it (prompt or `DRAIN_GRACE_MS` = 300 ms).
- **Diagnostics panel**: pure `connection/api/diagnoseFailure.ts` (stages
  `bluetooth | transport | init | probe | identify`, 8 ordered rules, `formatDiagnosticsReport`),
  `ui/ConnectionDiagnostics.tsx` mounted under the error panel on `ConnectionScreen` (stage chip,
  explanation, suggestions, collapsible Details with the attempt's last 20 log lines, link info,
  device, **Copy details** via `Share.share`, **Open error log**), and
  `connection/model/linkStore.ts` (`link`, `stage`, `attemptStartedAt`, `device`).
- **Simulator**: `SimScenario.sleepAfterIdleMs` (low-power model) and
  `MockTransport.dropResponses(n, { includeAt? })`. Settings gained a simulator-only **Developer**
  section — **Simulate a link drop** and **Fail next connect: no reply to ATZ** — through a new
  `connectionService.__sim` hook (`simulateDrop`, `failNextConnect`, `isFailNextConnectArmed`).
  Settings auto-reconnect copy now reads "On by default; pauses after 3 drops in a minute".
- **Tests**: `flapGuard.test.ts`, `diagnoseFailure.test.ts` (one case per rule + fallback + report),
  `BleTransport.test.ts` (39-byte write → 20 + 19 at MTU 23, one write at 247, with-response path,
  `linkInfo`, iOS passes no `requestMTU`, and a 16-byte Golf coding write through an MTU-23 BLE fake
  into the simulator), `Elm327Client.test.ts` (late reply, drain deadline, bare-CR wake, no-wake
  times out, `ATI` wake after an unsafe command, late wake reply drained, `ATI` wake in raw-CAN
  mode, no wake while busy, `isRepeatSafe` incl. raw-CAN), `MockTransport.test.ts` (sleep model,
  `dropResponses`), `connectionService.test.ts` (reconnects after a drop and pauses on the third,
  manual connect resets, spread-out drops never pause, off means off, all attempts failing ends in
  `error` with the last cause, fail-next-connect → stage `init`, a successful connect reaches
  `identify`, no 0100 reply → stage `probe`), `settingsStore.test.ts` (v3, v2 → v3 round-trips). The
  late-reply, wake and late-wake tests fail with the client changes disabled. Suite **527 → 579
  tests** (75 → 77 suites).
- **Docs:** `features/connection.md` (auto-reconnect default + flap guard, MTU/chunking, sleep/wake,
  drain, diagnostics panel + rules, `linkStore`, acceptance), `features/settings.md` (Developer
  section, auto-reconnect copy, v3 migration), `simulator.md` (`sleepAfterIdleMs`, test/dev
  controls), `obd2-reference.md` (bare-CR repeat; "Low power / auto-sleep"),
  `adapter-vgate-icar-pro.md` (quirks + what to confirm on the car), the hardening note in
  `improvement-plan-2026-07.md` marked resolved, `roadmap.md`; the context graph's connection
  concept updated.

**Review fixes (same plan):**

- **K-line rule vs. split notifications.** On BLE each rx log entry is one GATT notification (≤ 20
  bytes at MTU 23), so `UNABLE TO CONNECT` could straddle two entries and rule 6 never fired.
  `diagnoseFailure` now matches the attempt's rx text joined with whitespace removed (test: three
  split variants).
- **Panel showed the wrong device on failure.** `sessionStore.deviceId/deviceName` are only set on
  success (and kept after a drop), so a failed attempt was reported against "unknown" or the
  previous adapter. `linkStore.beginAttempt(stage, device)` now records the attempt's target and
  `ConnectionDiagnostics` reads it from there (`connectionService.test.ts` asserts it after a
  failed connect).
- **Bare-CR wake after an unconfirmed command.** `exec()` set `lastCmd` before the write, so after
  `04` and a swallowed, timed-out `03` the next wake was a bare `\r` and a real ELM327 would repeat
  its remembered `04`. A timeout, a failed write and an unanswered `ATI` wake now reset `lastCmd` to
  null (→ `ATI` wake). A failed write also starts a drain (only while it still owns `pending`).
  Tests: `04` → timed-out `03` → `ATI` wake; failed write → `ATI` wake.
- **Half-sent chunked write.** A chunk failing after earlier ones left a fragment in the ELM327's
  line buffer for the next command to be appended to. `BleTransport.write()` now sends a
  best-effort `LINE_FLUSH` (`X\r`) before rethrowing, so the fragment is rejected with `?`; a bare
  `\r` (the reviewer's suggestion) was not used because it would _execute_ the truncated fragment
  (e.g. a short `2E` write). Tests: flush after a failed second chunk; no flush when the first fails.

**Deviations from the plan:**

- **Wake-up command.** A bare `\r` makes a real ELM327 _repeat the previous command_, so a bare-CR
  wake after a clear (`04`/`14`), a coding write (`2E`), a routine (`31`) or an output test (`2F`)
  would run it again. The client sends a bare `\r` only when `isRepeatSafe(lastCmd)` (reads,
  `3E`, idempotent AT settings/queries) and otherwise — including a fresh connection, where the
  adapter's last command is unknown — wakes with the harmless `ATI`. Because `ATSP0` (init's last
  command) is not repeat-safe, the wake test reads `0100` after `init()` before idling.
- **Simulator wake answer.** With `sleepAfterIdleMs` set, a bare `\r` is answered with `\r>` whether
  the simulated chip is asleep or awake (so a wake never waits out the full 600 ms on an awake
  adapter); without the option the simulator still ignores it. The idle gap counts from the last
  write **or reply** (closer to a real chip than "last write").
- **Test timings.** The plan's 10 ms sleep / 5 ms wake / 20 ms idle are below Windows' ~15 ms timer
  tick (a `setTimeout(0)` reply took 22 ms), so the simulated chip fell asleep between init commands.
  The tests use 120 / 60 / 200 ms (and 1 200 / 300 / 1 300 ms for the `ATI` case, whose swallowed
  wake waits out the 600 ms timeout plus the 300 ms drain). The `MockTransport` sleep-model test uses
  a 400 ms sleep against 60 ms listens and 600 ms idles — a tighter 80 ms threshold was flaky under
  parallel Jest on Windows. The late-reply test sends the first command with a 50 ms timeout and
  the second with the default 1 000 ms (the plan's single 50 ms timeout would time out the second
  command too, at 200 ms latency).
- **Flap guard count.** The plan's message, acceptance ("after three drops in a minute it stops") and
  the Tests line ("false on the 4th") disagree; the guard pauses on the **third** drop inside 60 s,
  matching the message and the acceptance.
- **Classifier details.** Rule 5 ("vehicle isn't responding" → ignition) yields to rule 6 when the
  log also shows `UNABLE TO CONNECT` / `BUS INIT` — a failed K-line start-up ends in the same probe
  error, so in strict first-match order rule 6 could never fire for a connect. The Bluetooth rule
  ignores the simulator and a still-settling (`checking`) radio. The panel feeds the classifier only
  this attempt's log lines (`linkStore.attemptStartedAt`), so an older session's `ATZ` cannot
  mislead it.
- **`linkStore`** also records `attemptStartedAt`, and `link` is captured as soon as the transport
  reports `connected` (not only after `session.connect()` resolves), so a failure during init still
  shows the negotiated MTU. `stage` holds the furthest stage the attempt reached
  (`bluetooth → transport → init → probe → identify`); `DiagnosticSession.connect()` gained an
  optional `onStage` callback (`ConnectProgressStage`) for the last three.
- **Auto-reconnect giving up** ends in `error`, not `disconnected` (the plan has every connection
  failure open the diagnostics panel, which renders only on `error`), and appends the last
  attempt's error to the message.
- **Raw-CAN wake safety.** Not in the plan: while `ATCAF0` is in effect the client treats only AT
  commands as repeat-safe, so a bare-CR wake can never resend a TP2.0 data frame.
- **`MockTransport.dropResponses`** takes `{ includeAt }` (the acceptance's "extend the sim control
  to AT when a flag is set").
- The 16-byte coding-write acceptance test lives in `BleTransport.test.ts` (a BLE fake that
  reassembles writes until `\r` and feeds the Golf simulator), not a separate file.

---

## Plan 01 — Production first-run (2026-11-08)

[Plan 01](./plans/01-production-first-run.md) landed: a fresh install now behaves like a product.

- **Defaults + migration** (`shared/state/settingsStore.ts`): `adapterSource` defaults to `'ble'`,
  `injectedDtcs` to `[]`; persist `version: 2` with the pure, exported `migrateSettings` wired as
  `migrate` — a v1 blob keeps its explicit simulator choice, only missing fields get the new defaults.
  New pure `parseDtcList` backs the Settings **Custom…** DTC injection (first digit limited to
  `0`–`3`, since it is 2 bits on the wire — the plan's `[0-9A-F]{4}` would let `P4135` read back as
  `P0135`).
- **Simulator banner** (`connection/ui/SimulatorBanner.tsx`): amber one-line strip mounted in
  `_layout.tsx` via the `<Tabs screenLayout>` wrapper (inside `RootErrorBoundary`), so every route —
  hidden ones included — shows it under its header (it also shows while a session with device id
  `mock` is live). **Use real adapter** calls the new `connectionService.switchToRealAdapter()`, a
  thin wrapper over `switchAdapterSource(source)`, which the Settings segments use too: it bumps a
  connect epoch so an in-flight simulator connect tears itself down instead of publishing, cancels a
  pending auto-reconnect, resets the session store, flips the source, then closes the old session.
- **First-run card** (`onboarding/model/firstRun.ts` + `ui/FirstRunCard.tsx`): pick car → connect →
  read faults, replacing the `connect-basics` hint on the Connect tab; auto-dismisses (`first-run`)
  when complete. `dtcStore` gained an in-memory `lastReadAt`, stamped only by a real read:
  `dtcService.readAll()` now resolves `null` with no session and `useDtcs` then calls the new
  `clearResults()` (no stamp), so opening Faults while disconnected doesn't tick step 3.
- **Copy:** Connect simulator panel says readings are not from a real car and offers **Use a real
  adapter**; Settings segments renamed **Real adapter (Bluetooth)** / **Simulator (no car)** with a
  helper line.
- **Tests:** `settingsStore.test.ts` (defaults, migration incl. a real persist round-trip of v1 blobs
  through a mocked file system, `parseDtcList`), `firstRun.test.ts`, `connectionService.test.ts`
  (switching tears down a connected and an in-flight simulator session; same-source no-op) and
  `shared/state/dtcStore.test.ts` (`lastReadAt` only on real reads). Suite **504 → 527 tests**
  (71 → 75 suites).
- **Docs:** `features/settings.md`, `features/connection.md` (First run, Simulator banner), new
  `features/onboarding.md`, `features/fault-codes.md` (`dtcStore` location), `phase2-mobile-app.md`,
  root `README.md`; `features/coding.md` no longer claims coding "defaults to the simulator" and
  lists the gates as built.

**Deviations from the plan:** `FirstRunInput` gained a `genericAccepted: boolean` field (the pure
function cannot read the onboarding store, so the `first-run-generic-ok` dismissal is passed in), and
its `connectionStatus` reuses `ConnState` from `sessionStore` (same union). The banner/Connect-screen
switch goes through a new `connectionService.switchToRealAdapter()` instead of inlining
`disconnect()` + `setAdapterSource('ble')` in two places; it also cancels a pending auto-reconnect.
**Use a real adapter** sits under **Connect to simulator** (stacked) rather than beside it, to fit
phone width. The banner is mounted through `<Tabs screenLayout>` rather than as a sibling directly
above `<Tabs>`: a sibling would render above the navigator's header, under the Android edge-to-edge
status bar, whereas `screenLayout` puts it under the header on every route, which is what the plan
asks for. Custom-DTC parsing also drops duplicates and accepts whitespace as a separator.
**Layering:** `dtcStore` (and its test) moved from `features/fault-codes/model/` to
`src/shared/state/dtcStore.ts`, so the first-run card reads it through a shared store instead of
deep-importing another feature (plans/README: "never feature → feature"); EngineHost and
fault-codes now import it from `@/shared/state` too. `FirstRunCard` still deep-imports
`vehicle-select/model/vehicleStore` — kept deliberately: ~20 feature files already import it the
same way, so moving it into `shared/state` is a cross-cutting refactor better done with plan 07
(information architecture) than inside plan 01.

**Coding safety doc:** `features/coding.md` now states the gates that actually exist (CAN +
`codingModules` availability, the in-memory per-session unlock switch, a two-tap Confirm step,
backup-first + verify) in a new "Gates as built today" section, and marks the Settings flag and the
typed confirmation string as target-only, not built. With the real adapter now the default, a real
CAN write on the Golf profile is one switch and two taps away; adding those two gates is open work.

**Known limitation (migration):** v1's `partialize` always wrote `adapterSource` and `injectedDtcs`,
so every real v1 file has them — including installs that never chose anything and merely persisted
the old defaults (`'mock'`, `['P0299']`). As the plan specifies, the migration keeps them, so every
upgraded install stays in simulator mode with P0299 until the user switches (the banner flags it);
only fresh installs get the production defaults. The "v1 blob without an adapter choice" test covers
hand-edited/partial blobs only. Documented in `features/settings.md`.

**Status:** ✅ complete — no on-car part.

---

## Improvement-plan implementation (2026-07-15)

The full [`improvement-plan-2026-07.md`](./improvement-plan-2026-07.md) landed — Phases 1–5, all
ten Phase 6 nice-to-haves minus one deferral, and all ten Phase 6b VCDS-parity items.
Simulator-first, unit-tested; suite grew **309 → 504 tests** (46 → 71 suites), with `typecheck`,
`typecheck:app` and the repo-wide `lint` green.

**Phase 1 — connection correctness:** `Transport.onStatusChange` (BLE + mock, incl.
`simulateDisconnect()`); an unsolicited link drop now flips `sessionStore` to disconnected with an
actionable message; failed connects (e.g. ignition-off probe) tear the half-open transport down;
opt-in **auto-reconnect** with 2/5/10 s backoff (`connection/api/reconnect.ts`).

**Phase 2 — EngineHost:** cross-cutting engines moved out of screen hooks into a headless
`features/engine-host` mounted once in `_layout`: single demand-driven poll loop (union of
screen-acquired PIDs + alert-rule PIDs + trip set), alert evaluation, connection/diagnostic
notifications fed real `milOn`/`dtcCount`, trip sampling. Screen hooks became thin store
subscriptions; double-polling is impossible by construction.

**Phase 3 — multi-ECU parsing:** `ParsedResponse.frames` (one per plain hex line;
`bytes === frames[0]`), per-frame DTC parse + dedupe, OR-merged supported-PID bitmaps, and a
simulator secondary-ECU scenario (Punto engine+TCU) pinning the no-phantom-DTC regression.

**Phase 4 — data lifecycle:** adapter I/O log moved to a module-level ring buffer with a ~4 Hz
throttled publish and rx-pause during ATMA (`state/adapterLog.ts`); trips persist as summaries with
CSV-backed samples (`fromCsv`), CSV delete-on-remove and share; history capped at 200 with
debounced persist (`debouncedStorage`).

**Phase 5 — polish/DX:** AI `apiKey` now lives in the OS keystore (`expo-secure-store`, tolerant
import, one-time migration out of the settings file); a themed root `RootErrorBoundary` logs render
errors to the error log; ESLint covers all of `src/**` with react + react-hooks rules and a
`npm run ci` gate.

**Phase 6 — nice-to-haves:** fuel economy (015E or MAF+speed) on the dashboard + trip stats;
GPS trip tracks (expo-location, tolerant) with GPS-vs-OBD distance/speed; metric/imperial units at
display level; shareable HTML diagnostic report; dashboard gauge customization (per-vehicle,
persisted); adapter health check feature (grade + share); chart tap-inspect, pinch-zoom/pan and
window-CSV share; first-run onboarding hints + a11y labels on shared gauges; EAS Update wiring
('Check for updates' in More). _Deferred: 6.9 Web Bluetooth PWA transport._

**Phase 6b — VCDS parity, next tier:** forum-pasteable Auto-Scan text report; persisted scan
history with before/after diff; DTC search across modules; long-coding per-bit helper with label
names + live old→new preview; one-tap reversible coding tweaks (3 Golf Plus presets, sim-verified);
measuring-block CSV logging in extended-pids; per-profile guided fault finding (DTC → DIDs /
routine / freeze frame); full-car coding+adaptation backup with per-module gated restore;
readiness drive-cycle coach with flip-to-ready notifications; tester-present bus wake before scans.

Per-feature docs updated throughout; `vcds-parity-roadmap.md` status table reflects the landings.

**Status:** ✅ complete — full suite **272 tests** green (16 new), `eslint` 0, core + full-app
`tsc` 0. A code review of the VCDS-parity expansion found four real-hardware gaps the simulator
could not catch; all fixed simulator-first, with the simulator upgraded to REPRODUCE the real
adapter behaviors so the whole test suite now exercises them.

- **ISO-TP multi-frame de-framing** (was P0) — real ELM327s print >7-byte CAN responses as a hex
  length line + `N:`-prefixed segment lines; `parseElmResponse` treated those prefix digits as
  payload hex, garbling module idents, `19 02` DTC lists, `19 04` snapshots and long DIDs on real
  hardware (VIN survived only via its `49 02` marker resync). New
  `responseParser.reassembleIsoTp` strips the prefixes and uses the length line to truncate clone
  padding; `MockTransport.shapeResponse` now prints the real multi-line format on CAN, so every
  integration test exercises the de-framing (datasheet VIN example pinned in unit tests).
- **Addressing restore** (was P0) — `setHeader(null)` used to send bare `ATSH` (invalid on real
  firmware: `?`, old header kept) and `ATCRA` was never cleared, leaving the adapter deaf to
  standard replies after ANY module-scoped work. New `DiagnosticSession.resetAddressing()` —
  protocol-aware functional header (`7DF` 11-bit CAN / `686AF1` ISO 9141 / `C233F1` KWP) + bare
  `ATCRA` — is called in the `finally` of every module path: module-scan, adaptations, routines,
  coding, sensor-tests, service-reset. The simulator now rejects bare `ATSH` and models a stale
  receive filter blocking replies; regression tests pin both directions.
- **NRC 0x78 responsePending** (was P1) — `checkNegative` (deduplicated into `udsCoding`, shared
  by `udsModule`/`guidedRoutine` — was 3 copies) strips repeated `7F <svc> 78` echoes before
  judging a response, so slow operations (forced DPF regen start, security access, clears) no
  longer fail spuriously; pending-only responses throw a distinct 0x78-tagged `UdsError`.
  `securityAccess` retries once after NRC 0x37 (boot lockout) and never retries 0x36.
- **Interlocks fail closed + run continuously** (was P1) — an unreadable RPM/speed now BLOCKS a
  routine instead of silently passing (`requireEngineOff`/`maxSpeedKmh` were fail-open), and
  `useRoutines` re-checks interlocks during the run on the same periodic tick as the keep-alive
  (single interval → deterministic ordering; `checkInterlocksDuringRun` switches to the functional
  address and back), auto-stopping on violation. Spec: [`features/routines.md`](./features/routines.md).

Smaller, from the same review: `Tp20Channel` serializes requests + keep-alive channel tests
through an op queue (the `busy` flag was check-then-act racy — a keep-alive could inject `0xA3`
mid-packet); adaptation values support **signed** (two's-complement) channels; `writeChannel`
enforces min/max bounds at the service layer (was UI-only); the module-scan "skipped" copy now
points at the shipped TP2.0 gateway scan instead of calling it future work.

---

## Phase 5 — Diesel, ownership & screening (5 features)

**Status:** ✅ core + UI built, verified here (full suite **141 tests** green, `eslint` clean, full-app
`tsc -p tsconfig.app.json` **0 errors**). Specs: [`dpf`](./features/dpf.md),
[`used-car-inspection`](./features/used-car-inspection.md), [`battery-health`](./features/battery-health.md),
[`vin-decode`](./features/vin-decode.md), [`maintenance-log`](./features/maintenance-log.md).

Pure, unit-tested core (no hardware):

- `obd-core/obd/vinDecode.ts` (+ test) — `decodeVin` (WMI dictionary, ISO-3780 country, char-10 year
  with the char-7 rule, FMVSS-565 check digit). Verified against the three example VINs + a US case.
- `obd-core/analysis/battery.ts` (+ test) — `analyzeBattery` / `socFromResting` (resting SoC, cranking
  dip, alternator voltage, verdict + notes).
- `obd-core/analysis/dpf.ts` (+ test) — `assessDpf` (soot %, regen status, EGT-driven regen detection).
- `obd-core/analysis/maintenance.ts` (+ test) — `computeDue` / `dueStatus` / `projectOdometer` +
  `DEFAULT_SERVICE_ITEMS` (diesel-biased: timing belt, fuel filter, DPF check).
- `obd-core/analysis/inspection.ts` (+ test) — `assessInspection` incl. the "recently-cleared"
  readiness heuristic. All exported from `obd-core/index.ts`.

Vehicle data:

- Golf TDI profile gains a **diesel/DPF extended-PID pack** (soot mass/%, ash, distance & count since
  regen, EGT, oil temp, EGR), each `experimental` and tagged `category`/`role`; `ExtendedPid` gained
  optional `category`/`role` fields. The simulator auto-seeds every DID from its `sampleResponse`.

Feature slices (feature-sliced, Tamagui) + routes + **More** menu + hidden tabs:

- `features/dpf` — CAN/diesel-gated DPF monitor (status banner + tiles), maps DID `role`s into
  `assessDpf`.
- `features/inspection` — one-tap used-car screening (readiness + DTC 03/07/0A + freeze frame +
  distance-since-clear → verdict).
- `features/battery-health` — `ATRV` voltage capture → `analyzeBattery`.
- `features/vin-decode` — decodes the session VIN or a typed VIN; also linked from **Vehicle info**.
- `features/maintenance` — persisted logbook (`bolid.maintenance`) + due list.

---

## History feature (feature: history)

**Status:** ✅ added. A persistent, file-backed log of every AI auto-diagnose run and every
fault-code check. Spec: [`features/history.md`](./features/history.md).

- `src/shared/state/historyStore.ts` — persisted (expo-file-system, `bolid.history`) zustand store;
  `AiHistoryEntry | DtcHistoryEntry`, `addAiRun` / `addDtcCheck` / `remove` / `clear`; unlimited.
- Recorders: `useAiDiagnose` (AI runs) and `fault-codes/dtcService.readAll` (DTC checks); both use a
  new shared `vehicleLabel()` helper in `shared/vehicles`.
- `src/features/history/` — `HistoryScreen` (All/AI/Faults filter, colour-coded cards, Clear all) +
  `/history` route, hidden tab, and a **More** menu entry.

Also: settings + AI config + selected vehicle now persist across launches (zustand `persist` over the
same file storage); the AI request no longer sends `temperature`; structured output is a 3-way
schema/object/off control with auto-fallback when a server rejects `response_format`.

---

## AI auto-diagnosis (feature: ai-diagnose)

**Status:** ✅ core complete and verified (pure logic unit-tested here; 20 new tests, full core suite
green, lint clean). The RN screen + settings build on a dev machine / EAS like the rest of the app.
Spec: [`features/ai-diagnose.md`](./features/ai-diagnose.md).

One-tap health check: gather a snapshot from the live `DiagnosticSession` (DTCs 03/07/0A, readiness,
freeze frame, and a one-shot poll of the key supported live PIDs), send it to a user-configured
**OpenAI-compatible** server (e.g. a local **LM Studio**), and render a plain-language report. Falls
back to a deterministic on-device rule-based report when the AI is off/unconfigured/unreachable.

Platform-agnostic core (`src/shared/obd-core/analysis/aiDiagnosis.ts`, unit-tested):

- Types `DiagnosticSnapshot` / `AiReport` / `AiFinding` / `AiAction` / `AiClientConfig`.
- `summarizeSnapshot`, `localHeuristicReport` (MIL/DTCs/overheat/fuel-trim/charging/readiness rules).
- `buildDiagnosisMessages`, `buildChatRequestBody`, `extractMessageContent`, `parseAiReport`
  (tolerant of code-fenced/prose-wrapped JSON; falls back to local on any failure),
  `normalizeBaseUrl`, `overallFromFindings`, `KEY_DIAGNOSTIC_PIDS`.

App layer:

- `src/shared/ai/openaiClient.ts` — `chatCompletion` / `listModels` over `fetch` with an
  AbortController timeout and friendly errors (lives in `shared`, no cross-feature deps).
- `src/features/ai-diagnose/*` — store, `diagnoseService` (gather/analyze/clearCodes), `useAiDiagnose`
  hook, and `AiDiagnoseScreen` (overall banner, findings, gated Clear-DTC action, disclaimer).
- Settings → **AI assistant** section (enable, server URL, model + Detect, JSON mode, timeout, Test).
- Routing: `/ai-diagnose` route + hidden tab; entry added to the **More** menu.

Safety: reads + **clear DTCs only** (Mode 04, confirmed); the model only _suggests_ actions from a
fixed enum and never writes coding/service-reset.

---

## Phase 4 — Analysis, performance, sensor tests, coding & notifications

**Status:** ✅ core complete and verified (87 tests pass, lint clean). UI slices built on top of the
tested core; the RN/Tamagui screens compile/run on a dev machine / EAS like the rest of the app.
Specs: [`features/trip-recording`](./features/trip-recording.md), [`live-charts`](./features/live-charts.md),
[`performance-tests`](./features/performance-tests.md), [`alerts`](./features/alerts.md),
[`sensor-tests`](./features/sensor-tests.md), [`coding`](./features/coding.md),
[`notifications`](./features/notifications.md).

Platform-agnostic core (in `src/shared/obd-core`, all unit-tested here):

- `analysis/alerts.ts` — `AlertEngine` (edge detection + hysteresis), `defaultRules`.
- `analysis/performance.ts` — `computeAccelRun` (0–100 + splits), `computeDragRun` (60 ft / ⅛ / ¼
  mile + trap), `computeBrakeRun`, plus `timeToSpeed` / `cumulativeDistance` integration.
- `analysis/trip.ts` — `downsample`, `tripStats` (duration/distance/max), `toCsv` / `toJson`.
- `analysis/chartBuffer.ts` — `ChartBuffer` ring buffer + min/max `decimate` + `seriesStats`.
- `analysis/notifications.ts` — `deriveDiagnosticEvents` (MIL/connection rising edges), quiet-hours
  `filterNotifications`, `dueReminders`.
- `obd/mode06.ts` — `decodeMode06` (on-board monitor test results with pass/fail).
- `coding/coding.ts` — byte/bit helpers, schema decode, `diffCoding`.
- `coding/udsCoding.ts` — UDS sequence (`10/27/22/2E/3E`) and the guarded `codeModule`
  (read→backup→security→write→verify) over an injectable sender.

Engine/profile/simulator extensions:

- `vehicles/types.ts` + the Golf profile gained `mode06Tests`, `moduleSensors` (illustrative ABS
  wheel-speed), and `codingModules` (illustrative BCM coding) — all clearly experimental/unverified.
- `MockTransport` now answers **Mode 06**, **module-scoped UDS 22** (via `ATSH` addressing), and the
  **coding services**; `buildScenario` wires the new profile data through.
- `DiagnosticSession` gained additive `send` / `setHeader` / `setRxFilter` / `readMode06`.
- Integration tests cover Mode 06, an ABS module read, and a full coding backup→write→verify on the
  Golf simulator — all with no hardware.

Follow-up (reachability + Passat): added a visible **More** tab (`src/features/more`) that links to
all the Phase-4 screens (charts, performance, trips, alerts, sensor tests, service reset, coding,
notifications) via expo-router — they were previously hidden routes. Extended **service reset to the
Passat** with a **KWP2000 (K-line)** path: `serviceReset` now branches on `transport: 'uds' | 'kwp'`
(KWP uses `10`/`27`/`31`/`3B`/`21`); the simulator answers the KWP session-start + routine; the
Passat profile carries an illustrative KWP descriptor; UI gating matches the link (CAN for UDS,
K-line for KWP). Tests: 87 passing.

Follow-up (service reset): added a **service-interval reset** ("oil service / SRI reset") — a write
to the instrument cluster via UDS **RoutineControl `31`** or adaptation `2E`, in
`obd-core/coding/udsCoding` (`routineControl`, `serviceReset`) with unit + Golf-simulator integration
tests; `MockTransport` answers RoutineControl; the Golf profile carries an illustrative `serviceReset`
descriptor; a gated `service-reset` feature slice + route. Experimental — extended to the Passat via
KWP2000 in the follow-up above. Spec: [`features/service-reset`](./features/service-reset.md).

UI (feature-sliced, `src/features/*`, each with `model` Zustand store + `hooks` + `ui` screen +
`index`): `alerts`, `live-charts`, `performance-tests`, `trip-recording`, `sensor-tests`, `coding`,
`notifications`; a shared `src/shared/notify` delivers local notifications (dependency-tolerant
wrapper) so features don't depend on each other. New expo-router routes registered (hidden tabs);
`expo-notifications` / `expo-file-system` / `expo-haptics` / `expo-location` / `expo-sharing` added
to `package.json` (install on a dev machine with `npx expo install`).

Verified here: `npm test` (87 passing), `npm run lint` (0 issues). Note: `npm run typecheck` currently
trips on a pre-existing `expo/tsconfig.base` `customConditions` vs `moduleResolution` conflict in the
toolchain (unrelated to this code); ts-jest type-checks the core on every test run.

---

## Phase 3 — Polish (in progress)

Done:

- **Verified the whole app typechecks** against the real RN/Tamagui/`react-native-ble-plx` types
  (`npm run typecheck:app` → 0 errors), not just the core.
- **Readiness monitors** (Mode 01 PID 01) — `src/shared/obd-core/obd/readiness.ts`
  (`decodeMonitorStatus`) + `DiagnosticSession.readReadiness()`, surfaced on the Fault Codes screen
  (MIL state, monitors complete/total, spark/compression ignition, not-ready list).
- **Freeze frame** (Mode 02) — `DiagnosticSession.readFreezeFrame()` + simulator support, shown on the
  Fault Codes screen with the triggering DTC and captured PIDs.
- **CI** — `.github/workflows/ci.yml` runs lint + core typecheck + tests + full-app typecheck on
  every push.

Verified: `npm test` (39 passing, 11 suites), `npm run typecheck` (0), `npm run typecheck:app` (0),
`npm run lint` (0).

Remaining (needs hardware or external accounts):

- On-car validation against the three example cars (checklists in `testing.md`); tune the profiles
  from what the real cars report.
- Log export/share; optional persisted settings (AsyncStorage).
- iOS/Android store or EAS builds + signing (Apple Developer account / Android keystore).

## Phase 2 — Mobile app (Expo + Tamagui + BLE)

**Status:** ✅ code complete. Core stays green here; the RN app compiles/runs on a dev machine /
EAS (native build can't run in the container). See [`phase2-mobile-app.md`](./phase2-mobile-app.md).

Implemented the feature-sliced UI over the tested core:

- `src/shared/transports/ble/BleTransport.ts` — `Transport` over `react-native-ble-plx` with
  **runtime characteristic discovery** (no hard-coded UUIDs); `permissions.ts`, `manager.ts`,
  and a dependency-free `src/shared/lib/base64.ts` (unit-tested) for BLE payloads.
- `src/shared/state/*` — Zustand stores (`sessionStore`, `settingsStore` incl. the adapter I/O log)

## Error log ("logging zone")

**Status:** ✅ code complete; core verified here (`npm test`, `npm run lint`, `npm run typecheck`,
`npm run typecheck:app` all green). See [`features/error-log.md`](./features/error-log.md).

A persistent, capped on-device store of errors, reviewable and **exportable** (Markdown/JSON via the
share sheet) to fix later.

- `src/shared/lib/errorLog.ts` — pure, unit-tested core: `LoggedError` shape, `normalizeError`,
  `buildLoggedError`, and the export renderers (`formatErrorsForExport`, `errorsToJson`).
- `src/shared/state/errorLogStore.ts` — persisted Zustand store (`bolid.errors`, capped at 500) with
  the module-level `logError(...)` convenience and `installGlobalErrorHandlers()` (chains RN
  `ErrorUtils` + web `unhandledrejection`).
- `src/features/error-log/*` — `ErrorLogScreen` (severity filter, expandable stack/context, delete,
  clear, export) + `useErrorLogExport` (dependency-tolerant expo-file-system/expo-sharing). Wired
  into the `connection`, `fault-codes` and `ai-diagnose` catch blocks and reachable from **More**
  (`/error-log`). Partly addresses the earlier "log export/share" remaining item.

## VCDS-parity expansion (2026-07)

A large parity pass toward "do what VCDS does on the VW cars", plus OBD2 gap-fillers. All
simulator-first and unit-tested; app compiles (`typecheck`, `typecheck:app`, `lint` green; full
`npm test` green). New docs under `docs/features/` and a roadmap at
[`vcds-parity-roadmap.md`](./vcds-parity-roadmap.md).

**Passat service reset** — root-caused: the B5.5 instrument cluster speaks **KWP1281**, which a
generic ELM327 cannot address, so the OBD reset returns "No response" ("Failed: No response" on the
car). The profile now carries an honest `obdUnreachable` reason; the screen **leads with the
dash-stalk manual procedure** and demotes the OBD attempt to an explicit "try anyway".
`isModuleUnreachableError` widens error matching (No response / NO DATA / timeout / UNABLE TO
CONNECT / BUS INIT).

**New obd-core modules** (all pure, unit-tested): `uds/udsModule` (0x19 read / 0x14 clear / 0x19 04
snapshot / ident DIDs + status decode), `uds/vagDtcs` (VAG 5-digit dictionary), `uds/guidedRoutine`
(2F/31), `coding/adaptationValue`, `obd/multiPid`, `obd/iupr`, `obd/mode05`, `obd/canMonitor`,
`transport/logReplay`, and the **`tp20/`** stack (framing, `Tp20Channel`, `scanTp20`, an in-memory
`FakeTp20Bus`, `Elm327RawCanLink`, VAG address names).

**New features** (feature-sliced + routes + More entries + docs): `module-scan` (VCDS-style
auto-scan incl. TP2.0 gateway list), `adaptations` (channel browser with label packs), `routines`
(output tests / basic settings with live interlocks), `can-sniffer` (ATMA monitor). Plus:
multi-PID batching in `pollOnce` (CAN), a freeze frame per stored DTC, IUPR in `used-car-inspection`,
Mode 05 in `sensor-tests`, VIN→profile suggestion in `vehicle-select`, and adapter-log→replay-fixture
export in Settings.

**Label packs** (`src/shared/labels/`) — the open equivalent of VCDS label files, keyed by module
part-number prefix.

**Honest limits kept explicit:** the Passat (KWP1281) stays out of module scan / adaptations /
routines; every non-standard address/DID/routine id is badged illustrative; TP2.0 over a generic
ELM327 is documented as timing-sensitive and adapter-dependent.
