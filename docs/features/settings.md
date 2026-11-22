# Feature: settings

A short hub: the everyday preferences inline, everything else one tap away on its own page.

## UI

**SettingsScreen** (plan 07, route `/settings`) is a hub about one and a half phone screens tall:

1. **General** — **Theme** (**System** / **Light** / **Dark**), **Language** (plan 11, see
   [Language](#language-plan-11)) and the line "Units are metric: km/h, °C, km, kPa and L/100 km."
   The app is **metric only** — no unit conversion layer and no unit setting (decision 2026-11-08);
   values show as obd-core decodes them.
2. **Connection** — **Auto-reconnect** ("Retry the last adapter after a dropped link."), **Poll
   interval** (250 / 500 / 1000 / 2000 ms; "How often live values are read.") and **Recognise my
   cars by VIN** ("Select a garage car when its VIN connects."): one switch or segment each with a
   one-line hint. What they do in detail is under **User preferences** below.
3. **The pages** — one card of rows (`ui/SettingsRow.tsx`: `SettingsRow` in a `SettingsRowGroup`),
   each a title, a grey status line and a `›` chevron, announced as one button
   "<title>. <status>" (`testID="settings-row-<page>"`):

| Row                         | Status (examples)                                                    | Opens                   | Screen                              |
| --------------------------- | -------------------------------------------------------------------- | ----------------------- | ----------------------------------- |
| **AI assistant**            | "Off" · "On · Local server" (the provider)                           | `/settings-ai`          | `ui/AiSettingsScreen.tsx`           |
| **Notifications**           | "Alerts, reminders and quiet mode"                                   | `/notifications`        | [notifications](./notifications.md) |
| **Privacy**                 | "Crash reports off" / "… on" ("… unavailable in this build", no DSN) | `/settings-privacy`     | `ui/PrivacySettingsScreen.tsx`      |
| **Backup & restore**        | "Back up, restore or export your data"                               | `/backup`               | [backup](./backup.md)               |
| **Label packs**             | "2 bundled · 0 imported"                                             | `/settings-label-packs` | `ui/LabelPacksScreen.tsx`           |
| **Security access plugins** | "None installed" · "2 installed"                                     | `/settings-plugins`     | `ui/SeedKeysScreen.tsx`             |
| **Developer & simulator**   | the adapter source: "Bluetooth LE" · "Wi-Fi adapter" · "Simulator" … | `/settings-developer`   | `ui/DeveloperSettingsScreen.tsx`    |
| **About**                   | "v0.9.1" (plus " (<build>)" when `app.json` carries one)             | `/settings-about`       | `ui/AboutSettingsScreen.tsx`        |

Then **Disconnect** while a session is connected.

The pages are routes in `src/app/` (thin files that re-export the screen) registered in
`src/app/_layout.tsx` as hidden tabs (`href: null`), like every other screen that is not a tab, so
no tab is highlighted while one is open. Android's back button on a page returns to the hub
(`hooks/useBackToSettings.ts`: a `BackHandler` listener while the page is focused) instead of the
tab navigator's default, its first route (Connect); on iOS the Settings tab is the way back.
**Backup & restore** opens the backup screen directly (the old Data section's text and its two
buttons only opened it too). Each page's title is its row's title.

**The pages:**

- **AI assistant** — the **Enabled** switch. While it is off the page shows only that switch and
  one line ("When on, Diagnose (AI) asks an AI model you choose — on your own computer or in the
  cloud — to explain the car's faults.", `settings-ai-off`); on, the provider configuration below
  it (see **User preferences**).
- **Privacy** — **Send anonymous crash reports**, its full text and **Read the privacy policy**
  (see [Privacy](#privacy-crash-reports-plan-31)).
- **Label packs** and **Security access plugins** — `ui/LabelPacksSection.tsx` and
  `ui/SeedKeysSection.tsx` under the page title (see **User preferences**).
- **Developer & simulator** — everything at once, in one card (`testID="settings-developer"`):
  **Adapter source**, then (Wi-Fi only) **Wi-Fi adapter address**, (Classic Bluetooth only) the
  pairing note, then (simulator only) **Simulated vehicle**, **Injected DTCs** and **Simulator test
  controls**, then the **Adapter log** with the replay-fixture export, **Problem report** (**Preview
  feedback bundle**), **Crash reports** (**Send test crash report**), and **Hints and app data**
  (**Show hints again**, **Reset all app data**). The route `src/app/settings-developer.tsx` hands
  the page the backup slice's `resetAllAppData`. The simulator banner (plan 01) stays the always-on
  indicator that the simulator is selected.
- **About** — "Bolid Tester <version>", the build when there is one and the OTA note, then a list
  of rows: **Rate this app** (`↗`), **Privacy policy** (expands the policy below the list, `▾` /
  `▴`), **Report a problem**, **Licences** and **Documentation (GitHub)** (`↗`).

**Controls (plan 20, [accessibility](../accessibility.md)).** Every single-choice row (theme, poll
interval, AI provider, structured output, timeout, adapter source, simulated vehicle, injected
DTCs) is the shared `SegmentedControl`: a named `radiogroup` ("Theme", "Poll interval", "Adapter
source", …) of `radio` options that report `selected` / `checked`, 36 dp with an 8 dp hit slop;
terse options carry a spoken name (`15s` → "15 seconds", `250 ms` → "250 milliseconds", theme
`light` → "Light"). Every on / off setting is a `LabeledSwitch` (visible label + a `switch` that
reports `checked`): AI **Enabled** ("AI assistant enabled"), **Send anonymous crash reports**,
**Auto-reconnect** and **Recognise my cars by VIN**. Section labels and page titles are headings;
the hub rows are buttons named "<title>. <status>"; the inputs are labelled (**AI server URL**, **AI model**, **<provider> API key**, **Flow name**, **Wi-Fi adapter
host / port**, custom DTCs).

The parts in detail:

### Language (plan 11)

[Plan 11](../plans/11-i18n.md), [docs/i18n.md](../i18n.md). A `SegmentedControl` named
**Language** (`testID="settings-language"`) with **Phone language** (`system`, the default),
**English** and **Română** — the language names are shown in their own language. The choice is
`settingsStore.language` (persisted; settings schema **v9**, an older file migrates to `system`,
an unknown stored value is ignored on load and in a restored backup). Picking one applies it at
once (`initI18n`), live, without a restart; the root layout's `useLanguageSync` also follows the
stored value and holds the splash until the first language is applied, so the app never flashes
English on a Romanian phone. **Phone language** takes the first supported language among the
device's preferred locales (`expo-localization`), else English. Every label, hint and
accessibility name on this screen is translated; numbers and dates follow the language, unit
symbols do not. The privacy policy under About stays English (a note says so in Romanian).

### Privacy: crash reports (plan 31)

[Plan 31](../plans/31-opt-in-crash-reporting.md). One switch, **Send anonymous crash reports**
(a `LabeledSwitch` "Help fix crashes", spoken name "Send anonymous crash reports",
`testID="settings-crash-reports"`, inside `testID="settings-privacy"`), **off by default**, with this
text under it
(`CRASH_REPORTS_TEXT`):

> Off by default. When on, crashes and unexpected errors are sent to a crash-reporting service in
> the EU so they can be fixed. Reports contain the app version, device model and OS version, and the
> error. Before a report leaves the phone, the app removes your VIN, adapter name and address, and
> AI server address and key; a crash inside the phone's own system code is sent without that
> clean-up and could, rarely, include a Bluetooth adapter's address. Reports never contain trip
> data or location. You can turn this off any time.

- Switching **on** opens a confirmation (`appAlert`, same text, **Cancel** / **Turn on**) and the
  switch stays off; only **Turn on** stores `crashReports: true`. Switching **off** applies at once,
  no question.
- **Read the privacy policy** opens `docs/privacy-policy.md` on GitHub (`PRIVACY_POLICY_URL`); its
  section "Crash reports (optional)" says what is sent, where, for how long and on what legal basis.
- A build without a crash-service address (`EXPO_PUBLIC_SENTRY_DSN` empty: dev builds, forks, the
  tests) shows **Unavailable in this build** (`crash-reports-unavailable`) and the switch is
  disabled: the reporter is a no-op there whatever is stored.
- **Developer & simulator → Crash reports → Send test crash report** hands the crash service one
  event whose message carries a sample VIN, adapter address and server address
  (`TEST_REPORT_MESSAGE`), so the received report shows them removed (`***03398`, `<device-id>`,
  `<url>`). Disabled while reporting is off or unavailable; the alert says "Sent." or "Not sent".

How it works (`src/shared/telemetry/`, [architecture → Telemetry](../architecture.md#telemetry-opt-in-crash-reports-plan-31)):

- `crashReporting.ts` loads `@sentry/react-native` through a variable import specifier and calls
  `Sentry.init` **only once the switch is on** (`sendDefaultPii: false`, no `tracesSampleRate` —
  any number, even 0, turns on Sentry tracing and its `sentry-trace` / `baggage` headers on every
  request — plus `enableAutoPerformanceTracing: false` and `tracePropagationTargets: []`,
  `maxBreadcrumbs: 30`, `enableAutoSessionTracking: true` for the crash-free-sessions figure,
  `release` = the app version, `environment` `dev` / `production`). Switching off closes the SDK
  and closes the `beforeSend` gate (anything still queued is dropped); switching on again
  re-initialises it without a restart. No DSN, or no SDK, = nothing loaded and nothing sent.
- `logError` forwards every `error` / `fatal` entry to `captureError` after writing the error log;
  the reporter alone decides whether it leaves the phone. Warnings never do, and the `global` /
  `unhandledRejection` entries are skipped because the SDK's own handlers already capture them.
- Every JavaScript event passes `scrubEvent` (`src/shared/lib/scrub.ts`) in `beforeSend` (native
  crashes — Java / Objective-C / NDK / ANR — are sent by the native SDK without it; the privacy
  policy says so): VINs → `***` + last
  5 (and the VINs the app knows — connected car, garage — wherever they occur), MAC / UUID device
  ids → `<device-id>`, URLs → `<url>`, a scheme-less network address (the Wi-Fi adapter's
  `192.168.0.10:35000`, which the TCP transport's connect errors quote) → `<address>`, API keys and bearer tokens → `<token>`, GPS pairs →
  `<coords>`, e-mail addresses → `<email>`; `user`, `request` and `server_name` removed; contexts
  reduced to the device model, the OS and the app version (never the device name or an id); tags
  limited to `screen`, `source`, `severity`, `adapterSource`, `protocol`.
- Breadcrumbs: only `nav` (the screen path, from `usePathname`) and `connection` (status changes);
  `scrubBreadcrumb` drops every other one (the SDK's console, fetch, touch breadcrumbs) and never
  an adapter I/O line. `useCrashReporting()` (mounted by `src/app/_layout.tsx`) wires the switch,
  the breadcrumbs and the known VINs.

- **Developer & simulator** page parts:
  - **Adapter source** toggle — **Real adapter (Bluetooth)** (default), **Wi-Fi adapter** (plan 26),
    **Classic Bluetooth** (plan 27; the segment exists **only on Android** — `Platform.OS ===
'android'` — because iOS cannot open non-MFi classic accessories) or **Simulator (no car)**. The simulator is an explicit opt-in and, while it is on, an amber **simulator banner** stays visible on every screen
    (see [connection](./connection.md#simulator-banner)). The segments call
    `connectionService.switchAdapterSource()`, so switching disconnects any session built for the
    other source (a simulator session never survives under the real adapter, or vice versa) and
    clears the adapter log, so the log never mixes or carries over traffic from the other source. In
    simulator mode a picker chooses which car to emulate (generic / Golf / Punto / Passat, then the
    garage cars). A garage car is emulated from its base profile with its learned VIN, PIDs and
    calibration id on top (plan 06, see [vehicle-select](./vehicle-select.md#simulator)).
  - **Wi-Fi adapter address** (Wi-Fi only, `testID="settings-wifi"`) — a host field ("Wi-Fi adapter
    host") and a port field ("Wi-Fi adapter port"), prefilled with the saved endpoint (default
    `192.168.0.10` / `35000`, the `WiFi_OBDII` class). Every edit is checked with `parseEndpoint`
    (IPv4 or host name, port 1–65535): a valid pair is saved at once (`setWifi`); an invalid one
    shows why in red (`settings-wifi-error`: "Enter an IP address (like 192.168.0.10) or a host
    name." / "Enter a port from 1 to 65535.", plus "The app keeps using `<saved address>`") and
    saves nothing. If the saved address changes elsewhere while the section is open (a restore from
    Backup), the fields follow it. **Use the default address** appears once the address differs
    from the default.
    The Connect screen shows the address and connects to it (see
    [connection](./connection.md#wi-fi-adapters-tcp-plan-26)).
  - **Classic Bluetooth note** (Classic Bluetooth only, `testID="settings-spp"`) — pair the adapter
    in Android Settings → Bluetooth first (usually "OBDII", PIN 1234 or 0000), then pick it on the
    Connect tab; the bus sniffer is not available over classic Bluetooth (see
    [connection](./connection.md#classic-bluetooth-spp-android--plan-27)).
  - **Injected DTCs** (simulator only) — **None** (default), **P0299**, **P0299+P0401**, or
    **Custom…**, which reveals a text field taking comma-separated codes. Each code must be a letter
    `P`/`C`/`B`/`U`, a first digit `0`–`3`, then three hex digits (`/^[PCBU][0-3][0-9A-F]{3}$/i` —
    the first digit is only 2 bits on the wire, so `P4135` would read back as `P0135` and is
    rejected); codes are uppercased, invalid ones ignored, duplicates dropped (`parseDtcList` in
    `settingsStore.ts`). The injected set is read
    when the simulator connects, so reconnect to apply a change.
  - **Simulator test controls** (simulator only) — two test controls for the link-robustness paths
    (plan 12): **Simulate a link drop** (enabled while connected; calls
    `connectionService.__sim.simulateDrop()` → `MockTransport.simulateDisconnect()`, so
    auto-reconnect and the flap guard can be watched with no car) and **Fail next connect: no reply
    to ATZ** (`__sim.failNextConnect()`: the next simulator connect's `MockTransport` gets
    `dropResponses(1, { includeAt: true })`, so `ATZ` times out and the Connect screen's
    diagnostics panel opens at stage "Adapter start-up").
  - **Adapter log** — live log of adapter I/O (sent commands ↔ raw responses) with **Clear**, a
    **Flow name** field (default `session`) and **Export as replay fixture** (plan 02). The export
    (`model/replayExport.ts` → `api/replayFixtureFile.ts`, through `expo-file-system/legacy`, which
    `hooks/useLogFixtureExport.ts` wraps) writes
    `bolid-replay-<vehicleId>-<flow>-<stamp>.json` and opens the share sheet: a `ReplayFixture`
    with `pairs`, `sequences` and `meta` — `source` (`car` on the real adapter, `simulator` in
    simulator mode), `vehicleId` (the registry id of the selected profile, or of the simulated car
    — a garage car exports its base registry profile via `fixtureVehicleId`, never a `user:` id, so
    it fits `fixtures/<vehicleId>/`), `flow`, `adapter` and `protocol`, and `appVersion`
    (`APP_VERSION`). `source`, the simulated car, `adapter` and `protocol` come from **how the log
    was recorded** (`useAdapterLogStore`'s `origin`, plan W2): the connect that produced the traffic
    stamps its source and simulated car before its first command and adds the adapter version and
    protocol once it succeeds, so the label survives a disconnect, another simulated car picked
    afterwards, or a settings change behind the service's back (a restore) — a simulator session can
    never pass for validation. A connect to another source, simulated car or BLE adapter (the
    origin's `deviceId`) clears the log first (a fixture never mixes two recordings). A reconnect
    on the same adapter that reaches another car — another VIN, or another negotiated protocol
    when a VIN is missing (`noteAdapterLogLink`, which also stamps the session's `vin`) — drops the
    earlier car's traffic and keeps only the new session's, so its link details never relabel the
    previous car. A source switch clears the log too, and a superseded link logs nothing more. **Clear** drops the entries but keeps the origin (`clearAdapterLogEntries`):
    only a connect writes to the log and it stamps the origin first, so the next flow recorded on
    the live session after a Clear is still labelled by that session, and the next connect
    re-stamps it. A connect also clears traffic no connect stamped before recording. Only such an
    unstamped log (after a source switch reset the log, which then logs nothing) falls back to the
    settings and live session at export time. On success the copy reads "Saved <file>. Clear the log before
    recording the next flow."; on failure it points at the error log, which always has a
    `settings/replay-export` entry for it. **Clear** puts the default hint back, and the "log is
    full" warning (next) replaces a saved message as soon as the log wraps further. The log keeps only the last
    300 lines: once it has wrapped (`useAdapterLogStore`'s `dropped` > 0), the hint reads "The log
    is full: the oldest N lines were dropped, so the export starts mid-session. Clear the log and
    record a shorter flow.", the saved message says the same, and the fixture records
    `meta.droppedEntries: N`. The file goes into
    `src/shared/obd-core/transport/fixtures/<vehicleId>/` — see
    [simulator.md → Replay fixtures](../simulator.md#replay-fixtures).
  - **Problem report** (plan 32) — one button, **Preview feedback bundle**, that opens
    `/feedback?preview=1`: [Report a problem](./feedback.md) with the redacted bundle already built,
    so its size shows and a size regression is visible (the adapter log is capped at
    `ADAPTER_LOG_CAPACITY` lines). Nothing is shared until a share button there is pressed.
  - **Show hints again** — `useOnboardingStore.getState().reset()`: every dismissed hint, the
    first-run card on the Connect tab included, shows again ("Hints are back: the first-run card
    shows on the Connect tab again."). The card comes back even when its three steps are already
    done this session: it auto-dismisses only on the change to complete, so it shows them ticked
    until the user closes it.
  - **Reset all app data** — asks twice (`Alert.alert` "Reset all app data?" listing what goes,
    **Continue**; then "Delete all app data?" — "This cannot be undone. Make a backup first …" —
    **Reset everything**), then tears the connection down with `connectionService.resetForRestore()`
    (the restore teardown: a connect still in flight is invalidated, so it cannot publish a session
    built for the old adapter source after the reset; a failing close is logged, not fatal) and runs
    `resetAllAppData()` (`features/backup/api/resetAppData.ts`). Settings does not import the
    backup slice: the route `src/app/settings-developer.tsx` passes it in as the page's `resetAppData`
    prop (features never import each other), and without that prop the button is not shown. Every
    persisted store goes back to its initial state
    and its file is removed — `bolid.settings`, `bolid.garage`, `bolid.vehicle`, `bolid.loginBook`
    (code book), `bolid.labelPacks`, `bolid.history`, `bolid.maintenance`, `bolid.trips`,
    `bolid.scans` (scan history), `bolid.carBackups` (coding backups), `bolid.dashboard-layout`,
    `bolid.alerts`, `bolid.notifications`, `bolid.onboarding`, `bolid.backups` (the backup list),
    `bolid.seedKeys` (security-access plugin index) and `bolid.errors`. The AI keys leave the
    keystore (`forgetAllApiKeys`: every provider slot and the legacy slot), the in-memory results
    (fault codes, inspection, battery health, AI diagnosis, module scan and discovery, DPF, adapter
    health — what those screens and the vehicle report show) and the adapter log are cleared, and the app's own files are deleted:
    `seedkeys/` (plugin programs), `backups/` (backup files), each trip's `trip-<id>.csv`, and the
    staging copy every export writes to the document directory before the share sheet opens
    (coding snapshots, vehicle and fault-code reports, chart / measuring-log / sniffer CSVs,
    adapter-health and auto-scan text, error-log, garage, profile and label-pack exports, replay
    fixtures: every top-level `.json` / `.csv` / `.txt` / `.md` / `.html` / `.pdf` file except the
    stores' own `bolid.<store>.json`; hidden entries such as `.expo-internal` are skipped). The
    copies the share sheet handed to other apps live outside the app and stay. The result: a fresh install — real adapter, no garage, no
    history, hints back. A file that cannot be deleted (or a directory that cannot be listed) is
    named in the note and logged (`settings/reset`); the stores are reset anyway. `resetAppData.test.ts` scans the source for
    every `persist(` store named `bolid.*` and fails when one is missing from the reset.
- **User preferences**:
  - **Auto-reconnect** switch (Connection, hint "Retry the last adapter after a dropped link.") — on
    by default; pauses after 3 drops in a minute. When the connection drops unexpectedly it
    reconnects to the same device with backoff (2 s, 5 s, 10 s — up to 3 attempts); a manual
    disconnect / connect cancels it.
    See [connection](./connection.md#auto-reconnect-on-by-default-with-a-flap-guard).
  - **Poll interval** (Connection, hint "How often live values are read.") — a slow K-line car sets
    its own pace whatever is chosen.
  - **Recognise my cars by VIN** switch (plan 06, Connection, hint "Select a garage car when its VIN
    connects.") — on by default. When the connected car's VIN (vehicle identification number)
    matches a car you added from a connection, that car becomes the active vehicle. Built-in
    profiles are only suggested on the Vehicle screen. See
    [vehicle-select](./vehicle-select.md#vin-auto-select).
  - **AI assistant (auto-diagnose)** (plan 19, its own page) — **Enabled**, then (only while it is
    on) a **Provider** segment
    (**Local server** · **OpenAI** · **Anthropic** · **Custom**) with the preset's one-line hint.
    Switching provider applies that preset once (`setAi({ provider })` →
    `applyProviderPreset`): Anthropic fills `https://api.anthropic.com`, `claude-sonnet-5-5` and
    structured output off; OpenAI fills `https://api.openai.com` and `gpt-5-mini`; local / custom
    get back the URL, model and output mode last used with them (`ai.remembered`, never a key).
    **Server URL** is an input for local / custom and read-only for OpenAI / Anthropic, whose
    **Edit** button flips to **Custom** keeping the address. **API key** (hidden for local; optional
    for custom; `secureTextEntry`) with the note "Stored in the phone's secure keystore, never in
    backups. Each provider keeps its own key." **Model** + **Detect model**, **Structured output**
    (hidden for Anthropic), **Timeout**, **Test connection** — all through the `getAiClient`
    dispatcher. A Test / Detect that finishes after the provider or address changed is dropped (no
    model written into the new provider, no stale status). See [ai-diagnose → Providers](./ai-diagnose.md#providers).
  - **Metric only** — no unit conversion layer: every screen shows km/h, °C, km, kPa and L/100 km
    as decoded (the dead imperial path — a `units` field no control ever set, and its conversion
    module — was deleted in plan 07).
  - **Backup & restore** (plan 18) — the hub row opens `/backup` ([backup](./backup.md): one file
    with every store and the trip recordings, restore with a pre-restore snapshot, per-store JSON /
    CSV). The AI keys are never in a backup.
    - **Label packs** (plan 13, page `/settings-label-packs`, `ui/LabelPacksSection.tsx`): the copy "Label packs name a
      module's measurements, coding bits and adaptation channels by part number. Import one from a file;
      imported names take precedence over the bundled ones.", then **Import label pack** (file picker →
      the shared import preview, see [exchange-formats.md](../exchange-formats.md)), **Imported (_n_)**
      — one card per imported pack (module, prefixes, counts, **Export**, **Delete** after "Delete this
      label pack? … Bundled names for the same part numbers come back.") or "No imported label packs
      yet." — and **Bundled with the app** with **Export as template** (a starting point to edit and
      re-import). Exports go through `api/labelPackFile.ts` (`bolid-labelpack-<id>-<stamp>.json`, a
      `settings/label-packs` warning when nothing was written).
    - **Security access plugins** (plan 23, page `/settings-plugins`, `ui/SeedKeysSection.tsx`): what a seed / key unlock is
      and that the app ships, downloads and derives no routine; **Import plugin** (file picker →
      `parseSeedKeyFile`: a refused file shows "Can’t import this file", the reason, the first
      three errors and "Nothing was changed."; a valid one a preview — name, file, scope, widths,
      steps written / run, notes, an **Only for this car** switch that pins it to the active car's
      key — with **Install** / **Cancel**); **Installed (_n_)** — one card per plugin (scope,
      widths, any / this / another car, import date, **Test in simulator**, **Delete** after
      "Delete this plugin?") or "No plugins installed. Writes to modules that need security
      access are refused." See [coding → Security-access plugins](./coding.md#security-access-plugins-plan-23).
  - **About** (plan 08, plan 07, page `/settings-about`) — "Bolid Tester <version>" (`APP_NAME` / `APP_VERSION` from
    `shared/lib/appInfo.ts`, read from `app.json`; the version is also the OTA runtime version),
    "Build <n>" when `app.json` carries `expo.extra.build` (`APP_BUILD`; none today), a
    note that OTA updates only reach the same version and are checked only from **More → Check for
    updates**, and a **Privacy policy** row that expands the policy below the rows ("Last updated
    <date>", then each section). The text lives in `model/privacyPolicy.ts` and is published as
    [docs/privacy-policy.md](../privacy-policy.md); `privacyPolicy.test.ts` fails when a heading or
    paragraph differs between the two. **Documentation (GitHub)** opens `DOCS_URL` (the repo's
    `docs/` folder) with `Linking.openURL`; a failure logs `settings/about`. See
    [release.md](../release.md).
    Store items (plan 30): **Rate this app** (`rateAppLinks` in `shared/lib/storeLinks.ts`) opens
    `market://details?id=com.bolidtester.app` on Android, falling back to the Play web page when
    the store app is missing, and the App Store review page on iOS once `expo.extra.appStoreId` is
    set (`APP_STORE_ID`); it is hidden on the web and on iOS before that. **Report a problem**
    opens `/feedback` ([feedback](./feedback.md), plan 32). **Licences** opens `/licenses`.
  - **Licences** (`/licenses`, `ui/LicensesScreen.tsx`, plan 30) — the third-party notices for the
    production dependency tree: the package count, a per-licence summary ("MIT 552 · ISC 27 · …"),
    a filter by package or licence, 40 packages at a time with **Show _n_ more**, and per package
    (tap to expand, one at a time) its copyright lines, repository and licence text, or "ships no
    licence file; published under _X_" when the package has none. **Full list on GitHub** opens
    [docs/third-party-licenses.md](../third-party-licenses.md). The data is
    `model/thirdPartyLicenses.json`, generated with the Markdown page by `npm run licenses`
    (`scripts/licenses.mjs`: walks `dependencies` recursively from `node_modules`, skips one-platform
    binary packages so the output is the same on every OS, stores each distinct licence text once);
    `model/licenses.test.ts` fails when a `package.json` dependency is missing from it.

## hooks

- `useAdapterSource()` — read/set mock-vs-real + simulated car.
- `useAdapterLogStore((s) => s.entries)` — subscribe to the throttled I/O-log snapshot.

## api (service layer)

- Writes the adapter-source choice that `connectionService` reads when building the `Transport`.

## adapter I/O log (`shared/state/adapterLog.ts`)

- The raw tx/rx traffic is a **module-level ring buffer** (fixed 300 entries, O(1) append), **not**
  a zustand array. It counts the entries it overwrites (`dropped`, reset by **Clear**, which keeps the
  recording's `origin`; a source switch resets both via `clearAdapterLog`) and publishes
  the count with the snapshot, so the replay-fixture export can warn that it starts mid-session. `connectionService.withLog` mirrors every tx command and rx chunk into it; a
  separate **throttled publish (~4 Hz, trailing flush)** snapshots the buffer into a tiny zustand
  store (`useAdapterLogStore`) that the UI subscribes to. This kills the per-chunk array copies +
  re-renders the old design did during a CAN sniff (finding F5).
- While the ELM client is in **monitor mode** (`ATMA` sniff), rx mirroring is **paused** — the
  sniffer feature has its own line listener on that firehose, so logging it here would
  double-handle hundreds of frames/sec. tx commands are still logged.
- Text normalisation is obd-core's `logTxText` / `logRxText` (`transport/recordingTransport.ts`,
  shared with `RecordingTransport`): tx loses its line ending; an rx chunk loses the `>` prompt but
  **keeps its line breaks (each as one CR)** and is not trimmed, so an exported fixture still tells several
  ECUs' answers and ISO-TP segment lines apart (plan 02). The log views collapse whitespace when
  they display a line.
- The log is **never persisted** (it never was) and is intentionally not part of `settingsStore`.

## model

- `settingsStore` (Zustand, **persisted**): `adapterSource` (`'mock' | 'ble' | 'wifi' | 'spp'`),
  `simulatedVehicleId`, `injectedDtcs`, `pollIntervalMs`, `autoReconnect`, `autoSelectByVin`,
  `theme`, `wifi: { host, port }` (the Wi-Fi adapter endpoint, plan 26; `setWifi(patch)` ignores a
  patch that would make it invalid), `crashReports` (opt-in crash reports, plan 31, default `false`,
  `setCrashReports`), and the `ai` config
  (`provider`, server URL, model, structured-output mode, timeout, `remembered` per-provider URL /
  model / mode, and the current provider's key in runtime state only). It no longer holds the
  adapter I/O log (see above). Runtime only (never persisted): `adapterSourceNotice` +
  `dismissAdapterSourceNotice()` — the one-time notice when a stored source was replaced (below).
- **API keys (finding F8, per provider since plan 19)** live only in the OS keystore
  (`shared/state/secureApiKey.ts`, expo-secure-store), one slot per provider:
  `bolid.ai.apiKey.<provider>` (`apiKeyStoreKey`). `partialize` writes `ai` through `redactApiKey`,
  so no key ever reaches `bolid.settings.json` (nor anything built from it). `setAi({ apiKey })`
  writes the current provider's slot; a provider switch shows that provider's key at once (from
  this session's memory) and then loads its slot. At startup `hydrateApiKey()` runs
  `planApiKeyHydration(provider, fileKey, slotKey, legacyKey)`: a plaintext key still in an old
  settings file moves into the current provider's slot and leaves the file; else the slot key is
  loaded; else a pre-plan-19 single-slot key (`bolid.ai.apiKey`) moves into the current provider's
  slot; the legacy slot is deleted once its key is safe (loaded from the provider slot, or the move
  into it succeeded — a failed keystore write keeps it for the next start). Without the native module (Expo Go, web, tests) keys
  live in memory for the session.
- Persisted as `bolid.settings` at **version 8**. Defaults: `adapterSource: 'ble'`,
  `simulatedVehicleId: 'golf-plus-2009-20tdi'`, `injectedDtcs: []`, `autoReconnect: true`,
  `autoSelectByVin: true`, `wifi: { host: '192.168.0.10', port: 35000 }`, `crashReports: false`. `simulatedVehicleId` may be a registry id or a garage `user:` id.
- **Migrations** (`migrateSettings`, pure and unit-tested; each step only fills _missing_ fields, so
  an explicit stored choice always survives):
  - **v1 → v2** (plan 01): a v1 blob keeps its explicit `adapterSource` and `injectedDtcs` — a tester
    who chose the simulator is never flipped under them — and only missing fields get the new
    defaults (`'ble'`, `[]`).
  - **v2 → v3** (plan 12): `autoReconnect: p.autoReconnect ?? true`. A stored value (including an
    explicit `false`) is kept; a blob without the field, and every fresh install, gets `true`.
    Because v2's `partialize` always wrote `autoReconnect`, upgraded installs keep whatever they had
    (the old default was `false`) — only fresh installs and partial blobs get it on.
  - **v3 → v4** (plan 06): `autoSelectByVin: p.autoSelectByVin ?? true`. No earlier version wrote
    the field, so every upgraded install and every fresh install gets it on; every v3 field is kept.
  - **v4 → v5** (plan 19): `ai.provider = inferProvider(ai.baseUrl)` (api.openai.com → `openai`,
    api.anthropic.com → `anthropic`, blank → `local`, anything else → `custom`); every other `ai`
    field is kept and a blob without `ai` stays without it (the defaults fill it).
  - **v5 → v6** (plan 07): metric only — a stale `units` key is dropped (`withoutUnits`); every
    other field is kept. `merge` drops it too, so a restored or hand-edited v6 file carrying it
    never brings it back.
  - **v6 → v7** (plan 26): `wifi: p.wifi ?? DEFAULT_WIFI_ENDPOINT` (a copy); every other field is
    kept.
  - **v7 → v8** (plan 31): `crashReports: p.crashReports === true` — an upgrade never opts anyone
    in; every other field is kept.
  - From v8 on it is the identity. The existing `merge` still deep-merges `ai` over the defaults
    (and infers `provider` if a blob somehow lacks a valid one), keeps the current `wifi` when a
    restored or hand-edited file carries an unusable one (`isValidEndpoint`), and reads anything but
    an explicit `crashReports: true` as off.
  - **Platform fallback** (plan 27, no version bump — the shape did not change): Classic Bluetooth
    is Android only (`isAdapterSourceSupported(source, os)`). The root layout calls
    `setSettingsPlatform(Platform.OS)` at startup; `merge` then turns a stored `'spp'` on any other
    platform (a backup restored from an Android phone onto an iPhone) into `'ble'` and sets
    `adapterSourceNotice` ("Classic Bluetooth adapters work only on Android, so the app switched to
    Bluetooth LE…", shown once on the Connect screen). If hydration finished before the platform
    was known, `setSettingsPlatform` applies the same fallback itself. A fallback made in `merge`
    is written back by `onRehydrateStorage` (zustand's persist rewrites the file after hydration
    only when a migration ran), so the next launch reads `'ble'` and the notice does not return.
    With no platform set (tests) nothing is replaced. In the browser (plan 28, [web](../web.md))
    Wi-Fi is unsupported too (no raw TCP sockets), so a stored `'wifi'` or `'spp'` source falls back
    to `'ble'` with `WEB_SOURCE_FALLBACK_NOTICE`; the Developer page offers only **Real adapter
    (Bluetooth)** and **Simulator (no car)** there, and under the AI key field a note says the key
    is kept only until the tab closes (no keystore in the browser).
- **Known limitation:** v1's `partialize` always wrote `adapterSource` and `injectedDtcs`, so every
  real v1 file carries them — including installs that never chose anything and just persisted the
  old defaults (`'mock'`, `['P0299']`). The migration cannot tell those apart from a deliberate
  choice, so every upgraded install stays in simulator mode with the P0299 fault until the user
  switches (the simulator banner makes that visible). The default-fill path only covers hand-edited or
  partial blobs. Only fresh installs get the production defaults.
- The selected real-car profile (`vehicleStore.selectedProfileId`) is persisted too.
- Persistence uses zustand's `persist` middleware over a small `StateStorage` backed by
  **expo-file-system** (`shared/state/persistStorage.ts`) — JSON files in the app document
  directory. No extra native dependency; best-effort (a filesystem error just means no persistence).
  On the **web** there is no document directory, so the same storage uses the browser's
  `localStorage` under the store's `bolid.<area>` key (plan 28; `persistBackend()` reports
  `'file' | 'localStorage' | 'none'`); a full quota or blocked site data is logged as a `persist`
  warning and the app keeps running on in-memory state.

## Behavior

- A fresh install starts on the **real adapter** with no injected fault. Switching to **Simulator**
  lets the entire app run with no car — used for development, demos, and as the backbone of the
  automated tests — and is always flagged by the simulator banner.
- The I/O log is the first place to look when debugging a real car.

## Acceptance

- A fresh install (or cleared app data) shows **Real adapter (Bluetooth)** selected and no injected
  DTC; a persisted v1 file with `adapterSource: 'mock'` still opens in simulator mode.
- With the simulator and **Injected DTCs: None**, Faults shows no codes; **Custom…** `P0135` shows
  `P0135`.
- App is fully usable end-to-end in simulator mode.
- Settings opens as the hub: General, Connection, then the rows AI assistant, Notifications,
  Privacy, Backup & restore, Label packs, Security access plugins, Developer & simulator and About,
  in that order, each showing its state; no page control (AI address, adapter source, log, reset,
  label packs, plugins) is on the hub, and each row opens its page (`SettingsScreen.test.tsx`).
  Android back on a page returns to the hub.
- **AI assistant** switched off shows only the Enabled switch and its one-line explanation
  (`AiSettingsScreen.test.tsx`).
- **Privacy**: a fresh install has **Send anonymous crash reports** off and sends nothing; without
  `EXPO_PUBLIC_SENTRY_DSN` it shows **Unavailable in this build** and nothing initialises; **On**
  asks first (Cancel keeps it off); off → later errors produce no events; on again resumes without
  a restart (`crashReporting.test.ts`, `useCrashReporting.test.tsx`, `PrivacySettingsScreen.test.tsx`).
- No imperial code remains: `grep -rn "UnitSystem\|imperial\|displayUnit\|convertValue" src` is
  empty; Dashboard and Trips show km/h, °C, km and L/100 km.
- **Show hints again** brings back the first-run card; **Reset all app data**, after two
  confirmations, returns the app to a fresh state (real adapter, no garage, no history) and no
  `bolid.*` store is missed.
- **Notifications** opens `/notifications`; **Backup & restore** opens `/backup`.
- **Label packs**: importing the example pack (`docs/examples/label-pack.example.json`)
  lists it under Imported; Delete brings the bundled names back; a corrupted file shows its first
  three errors and stores nothing.
- **Security access plugins**: importing a valid plugin shows the preview, Install lists
  it, **Test in simulator** reports "Passed in the simulator…"; a plugin over the DSL limits is
  refused with the reason and nothing is installed.
- **About** shows the app version from `app.json`; **Privacy policy** expands every section of
  `docs/privacy-policy.md` and collapses again.
- **About** (plan 30): **Rate this app** opens the Play Store app (web page if the store app is
  missing) on Android and is hidden on iOS without an App Store id and on the web; **Report a
  problem** opens `/feedback`; **Licences** opens `/licenses`, which lists every package with its
  licence, filters, and shows a package's copyright and licence text on tap.
- Log shows every command/response pair.
