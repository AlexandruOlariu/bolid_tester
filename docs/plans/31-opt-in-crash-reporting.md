# Plan 31 — Opt-in crash reporting

**Size:** S–M (½–1 day) · **Depends on:** plan 08 (release builds, privacy policy), plan 32
(log bundle) · **Roadmap:** v1.0 "Opt-in crash reporting"

## Goal

A user who wants to help can switch on anonymous crash reports; everyone else sends nothing. The
decision, the wording, the scrubbing and the privacy-policy text are all in the repo, and the
feature degrades to "nothing is sent" when the DSN is absent (dev builds, forks).

## Why

The error log (`src/shared/state/errorLogStore.ts`, capped at 500, file-backed) already captures
caught errors, uncaught JS errors and unhandled rejections (`installGlobalErrorHandlers`) and render
errors (`RootErrorBoundary`). What it cannot do is tell the maintainer that a release build crashes
for users who never open More → Error log, nor aggregate across installs. A store release needs a
crash-free KPI (plan 30). Default-off is both the GDPR-friendly choice for a Romanian/EU user base and
the honest one for a hobby-scale app.

## Options evaluated

| Option                                                                       | Pros                                                                                                                                                                         | Cons                                                                                    | Verdict                          |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------- |
| **A. No third party** — rely on the error log + plan 32's one-tap log bundle | Zero data leaves the device unless the user shares; nothing to configure; no SDK weight                                                                                      | No crash-free rate, no native crash capture (JS-only), depends on users reporting       | Baseline; always present         |
| **B. `expo-updates` only**                                                   | Already a dependency                                                                                                                                                         | Not a crash reporter; only rollback telemetry                                           | Not applicable                   |
| **C. `@sentry/react-native` (Expo plugin), opt-in, DSN from env**            | Native + JS crashes, breadcrumbs, release health → crash-free sessions %, free tier sufficient, official Expo config plugin, source maps via `sentry-expo`-less modern setup | ~1 MB native SDK, must scrub PII, needs a DSN secret, EU data-residency choice required | **Recommended, strictly opt-in** |

Recommendation: ship **A** always (already true) and add **C** behind a default-off switch. Use a
Sentry **EU region** project (data residency in the EU) and set `sendDefaultPii: false`.

## Read first

- `src/shared/state/errorLogStore.ts` (`logError`, `installGlobalErrorHandlers`, dedup window),
  `src/shared/lib/errorLog.ts` (`LoggedError`, `LogErrorInput`, `normalizeError`),
  `src/shared/ui/RootErrorBoundary.tsx` (`componentDidCatch`).
- `src/shared/state/settingsStore.ts` (persist version — plans 01/06/11 bump it; coordinate),
  `src/shared/state/secureApiKey.ts` (the "never persist secrets in the settings file" pattern).
- `src/features/connection/api/connectionService.ts` (device ids/names flow through
  `sessionStore` — what must be scrubbed), `src/shared/state/sessionStore.ts` (`deviceId`,
  `deviceName`, `info.vin`).
- `app.json` `plugins`, `eas.json`, `.github/workflows/ci.yml` (plan 08 shape).
- Sentry docs: `@sentry/react-native` Expo setup (`@sentry/react-native/expo` plugin,
  `Sentry.init`, `beforeSend`, `beforeBreadcrumb`, `enabled`), source-map upload in EAS/CI.

## Design

### Settings and consent

`settingsStore`: `crashReports: boolean` (default `false`), `setCrashReports`. Persist with the
next version bump via `migrateSettings` (default `false` for existing blobs).

Settings → Privacy (new section, between General and AI):

> **Send anonymous crash reports** — Off by default. When on, crashes and unexpected errors are sent
> to a crash-reporting service in the EU so they can be fixed. Reports contain the app version,
> device model and OS version, and the error. They never contain your VIN, adapter name or address,
> AI server address or key, trip data, or location. You can turn this off any time.

A one-time `Alert.alert` confirm when switching **on** (same text, "Turn on" / "Cancel"). Link to
the privacy policy (plan 08) under the switch.

### Module `src/shared/telemetry/crashReporting.ts` (dependency-tolerant)

```ts
export interface CrashReporter {
  init(dsn: string): Promise<void>;
  setEnabled(on: boolean): void;
  captureError(input: LogErrorInput): void;
  addBreadcrumb(category: string, message: string): void;
}
export const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN ?? ''; // empty in dev/forks → reporter stays a no-op
export function scrubText(s: string): string; // pure: VIN → last 5, MAC → masked, http(s) URLs with host → '<url>', bearer-like tokens → '<token>'
export function scrubEvent<
  T extends {
    message?: string;
    exception?: unknown;
    breadcrumbs?: unknown;
    user?: unknown;
    contexts?: unknown;
    tags?: Record<string, string>;
  },
>(e: T): T; // pure: applies scrubText to message/exception values/breadcrumb messages, deletes user/ip, drops contexts.device.name, whitelists tags
export async function startCrashReporting(enabled: boolean): Promise<void>; // loads '@sentry/react-native' via variable specifier; no-op when DSN empty or module missing
export function setCrashReportingEnabled(on: boolean): void;
```

Scrub rules (`scrubText`, in this order):

1. VIN: `/\b[A-HJ-NPR-Z0-9]{17}\b/g` → `***` + last 5 (`WVWZZZ1KZ9W903398` → `***03398`).
2. MAC / BLE id: `/\b([0-9A-F]{2}:){5}[0-9A-F]{2}\b/gi` and iOS UUID
   `/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi` → `<device-id>`.
3. URLs: `/\bhttps?:\/\/[^\s'"]+/gi` → `<url>` (the AI server address is the user's LAN).
4. Tokens: `/\b(sk-[A-Za-z0-9]{8,}|Bearer\s+\S+)/g` → `<token>`.
5. GPS pairs: `/-?\d{1,2}\.\d{4,},\s*-?\d{1,3}\.\d{4,}/g` → `<coords>`.

`scrubEvent` also removes `event.user`, `event.request`, `contexts.device.name`, keeps
`contexts.device.model`, `contexts.os`, `contexts.app`, and allows only tags `screen`, `source`,
`severity`, `adapterSource` (`mock`/`ble`), `protocol`.

Wiring:

- `logError` (errorLogStore): after the store write, `if (severity !== 'warning') captureError(input)`.
  The reporter's `enabled` gate (not the caller) decides whether anything leaves the device; keep the
  dedup logic in `logError` only.
- `installGlobalErrorHandlers` fatal path: Sentry's native handler captures native crashes itself
  once initialised; keep the 150 ms deferral.
- `_layout.tsx`: `useEffect(() => { void startCrashReporting(useSettingsStore.getState().crashReports) }, [])`
  and a subscription that calls `setCrashReportingEnabled` on changes. `Sentry.init` options:
  `{ dsn, enabled, sendDefaultPii: false, attachStacktrace: true, maxBreadcrumbs: 30, tracesSampleRate: 0, enableAutoSessionTracking: true, beforeSend: scrubEvent, beforeBreadcrumb: scrubBreadcrumb, release: Constants.expoConfig?.version, environment: __DEV__ ? 'dev' : 'production' }`.
  `enableAutoSessionTracking` gives the crash-free sessions metric plan 30 reads.
- Breadcrumbs: only navigation (expo-router `usePathname` → `addBreadcrumb('nav', path)`) and
  connection status transitions (`sessionStore.subscribe` → `addBreadcrumb('connection', status)`).
  Never adapter I/O lines.

### Build configuration

- `app.json` plugins: `["@sentry/react-native/expo", { "organization": "<org>", "project": "bolid-tester", "url": "https://sentry.io/" }]` — the plugin only matters for source-map upload during
  EAS/CI builds; the DSN is read at runtime from `EXPO_PUBLIC_SENTRY_DSN` (set in `eas.json` `env`
  per profile and as a CI env from secret `SENTRY_DSN`). Empty DSN ⇒ reporter no-op; the settings
  switch then shows a muted "Unavailable in this build" line.
- `SENTRY_AUTH_TOKEN` secret for source-map upload in the plan 08 `build-android` job.
- `.gitignore`: nothing new (no local Sentry files committed).

### Privacy policy (plan 08 doc) addition

Section "Crash reports (optional)": what is sent (listed above), where (EU-hosted processor,
named), retention (Sentry default 90 days), legal basis (consent), how to withdraw (switch off; data
is not retroactively deletable by the user but is not linkable to them — no user id is set).

## Steps

1. `scrubText` / `scrubEvent` / `scrubBreadcrumb` + tests (pure, under `src/shared/lib/scrub.ts`
   so the core tsconfig covers it; the telemetry module imports it).
2. `settingsStore.crashReports` + migration; Settings Privacy section with the consent alert.
3. `crashReporting.ts` (tolerant import), `logError` hook, `_layout.tsx` start/subscribe, breadcrumbs.
4. Install `@sentry/react-native` (`npx expo install @sentry/react-native`), `app.json` plugin,
   `eas.json` env, CI secret wiring (plan 08 job).
5. Privacy policy text; `docs/features/settings.md`, `docs/features/error-log.md` (relationship:
   error log is the complete local record; crash reports are a scrubbed subset).
6. `npm run ci`.

## Tests

- `scrub.test.ts`: each rule with a positive and a near-miss (16-char not-a-VIN stays; a MAC inside
  a sentence; URL with port; `sk-` key; coordinates); `scrubEvent` removes `user`, keeps
  `contexts.os`, drops a non-whitelisted tag, scrubs nested `exception.values[0].value` and
  breadcrumb messages; idempotent (scrubbing twice equals once).
- `crashReporting.test.ts` (node): with `DSN = ''` → `startCrashReporting(true)` resolves and
  `captureError` does not throw and calls no module (mock the dynamic import to throw
  `MODULE_NOT_FOUND`); with a mocked module → `init` called once, `captureException` called only when
  enabled, not for `severity: 'warning'`.
- `settingsStore.test.ts` (plan 01): `crashReports` default `false` after migration.

## Docs

- `docs/features/settings.md` (Privacy section), `docs/features/error-log.md`, privacy policy,
  `docs/release.md` (SENTRY secrets), `docs/architecture.md` (telemetry module, opt-in rule).

## Acceptance

- [ ] Fresh install: switch is **off**; no network call to the crash service happens (verify with
      the emulator's network inspector / `adb shell tcpdump` not required — assert via the mocked
      module test and a debug log line "crash reporting: disabled").
- [ ] Dev build with no `EXPO_PUBLIC_SENTRY_DSN`: switch shows "Unavailable in this build"; nothing
      initialises.
- [ ] Release build with DSN, switch on, trigger a test error from Settings → Developer → **Send test
      crash report** (dev-only button): the event arrives scrubbed (VIN masked, no device name, no
      URLs) and tagged `environment: production`.
- [ ] Switch off → subsequent `logError` calls produce no events; switch on again resumes without
      restart.
- [ ] `npm run ci` green.

## Owner actions

- Create the Sentry organisation/project in the **EU region**; add `SENTRY_DSN` and
  `SENTRY_AUTH_TOKEN` to GitHub secrets and `EXPO_PUBLIC_SENTRY_DSN` to the EAS production profile.
- Approve the privacy-policy wording.
