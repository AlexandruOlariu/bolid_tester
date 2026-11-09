# Feature: engine-host

The headless **engine host**: one component, mounted once at the app root, that owns every
cross-cutting engine — the live-data poll loop, alert evaluation, diagnostic / connection
notifications, trip sampling and the readiness coach. It has no screen and renders nothing.

## Why it exists

Finding **F1** of the [2026-07 improvement plan](../improvement-plan-2026-07.md) ("cross-cutting
engines only run while their screen is mounted"): the poll loop, the alert engine and trip sampling
used to live in screen hooks, so an overheat alert only fired while the Alerts screen was open, a
trip stopped sampling when the user left the Trips screen, and two mounted screens ran two poll
loops on the same half-duplex adapter. EngineHost (improvement-plan Phase 2) moved all of them into
one place that lives as long as the app.

## Where it is mounted

`src/app/_layout.tsx` renders `<EngineHost />` once, inside `RootErrorBoundary` and before the tab
navigator, so it runs on every route (tabs and hidden routes alike) and a render error elsewhere
cannot unmount it without also showing the fallback.

## The engines

`src/features/engine-host/EngineHost.tsx` is a set of independent `useEffect`s:

1. **Poll loop** — the only live-data loop in the app, started per `session` and restarted when
   `settingsStore.pollIntervalMs` changes. Each sweep:
   - computes the PID set with `computePollPids` (below); an empty set marks
     `liveDataStore.polling = false` and re-checks next tick, so nothing is sent on the bus;
   - otherwise calls `session.pollOnce(pids)`, writes the snapshot to `liveDataStore.setValues`,
     evaluates alerts on it, and, while `tripStore.recording`, pushes a numeric sample
     (`tripStore.pushSample({ t, values })`);
   - **period, not gap**: the next sweep is scheduled `max(0, intervalMs - elapsed)` after this one
     started, so the interval is the target period. On a slow K-line car a sweep can exceed the
     interval and the next one fires at once, paced by the bus;
   - **error dedup**: a failed sweep keeps the loop going and logs `source: 'live-data'` (warning)
     only when the message differs from the previous failure; a successful sweep resets it, so a
     persistent fault leaves one entry in the capped error log instead of one per interval.

   The effect cleanup cancels the timer and clears `polling`.

2. **Alerts** — `AlertEngine` (`shared/obd-core`) evaluates `alertsStore.rules` against every
   snapshot (reset on each new session); `alertsStore.setActive(active)` feeds the banner, and every
   newly fired `warn` / `critical` alert calls `notify({ category: 'alert', … })`. Failures log
   `source: 'alerts'`. **Default-rule seeding**: when `alertsStore.rules` is empty and the session
   reports supported PIDs, it calls `setRules(defaultRules(info.supportedPids))`, whether or not the
   Alerts screen was ever opened. See [alerts](./alerts.md).
3. **Notifications** — `setNotifPrefs(prefs)` keeps the shared notifier in sync with
   `notificationsStore.prefs` at start-up and on every change. Diagnostic / connection events come
   from `deriveDiagnosticEvents(prev, cur)` on rising edges of a `DiagSnapshot` built from **real**
   state: the session status (`initializing` reported as `connecting`), `milOn` from
   `dtcStore.readiness` and `dtcCount` from `dtcStore.stored.length` (the latest fault read).
   Failures log `source: 'notifications'`. See [notifications](./notifications.md).
4. **Trip sampling** — part of the poll loop (above): while recording, the trip's PID set is
   added to the sweep and every snapshot becomes a sample. See
   [trip-recording](./trip-recording.md).
5. **Readiness coach** — a separate watcher, active only while `coachStore.enabled` **and** the
   session is `connected`. It calls `session.readReadiness()` (`0101`) every **30 s**
   (`COACH_POLL_MS`), stores the result in `coachStore`, and notifies (`category: 'diagnostic'`,
   info) for each monitor that `diffReadiness` reports as newly ready, plus once when all are ready.
   Failures log `source: 'readiness-coach'`. A second effect calls `coachStore.reset()` as soon as
   the status leaves `connected`, so coach mode never resumes silently on the next connection. See
   [fault-codes](./fault-codes.md).
6. **VIN auto-select** (plan 06) — on every new `SessionInfo` with a VIN it calls
   `autoSelectGarageCarForVin(vin)` from `vehicle-select`: when `settings.autoSelectByVin` is on and
   the VIN equals a garage car's learned VIN, that car becomes the active vehicle ("Car recognised"
   info notification). It lives here, not in `connectionService`, so the connection slice does not
   gain a feature import. Failures log `source: 'vehicle-select/auto-select'`. See
   [vehicle-select](./vehicle-select.md#vin-auto-select).

## Demand-driven PID set

`src/features/engine-host/pollPids.ts` (pure, unit-tested in `pollPids.test.ts`):

- `computePollPids({ registrations, alertPids, tripPids })` — the de-duplicated union of
  - `registrations`: the PID interest of mounted screens (`liveDataStore.registrations`, written by
    `useLiveData()` through `acquire(id, pids)` and released on unmount);
  - `alertPids`: `enabledRulePids(alertsStore.rules)`, the PIDs of **enabled** rules only (a
    disabled rule costs no bus traffic);
  - `tripPids`: the session's effective PID set (`session.effectivePids(profile.supportedPids)`,
    or all supported PIDs for Auto / Generic) while recording, otherwise `[]`.

  Order is stable: registrations (screen order), then alert-only, then trip-only PIDs.

- Nothing mounted, no enabled rule and no recording ⇒ an empty set ⇒ the loop idles.

## The composition rule

The [architecture](../architecture.md#ui-feature-sliced) rule is that features import only
`@/shared/*`. EngineHost is the **one sanctioned exception**: composing several feature stores
(`vehicle-select`, `live-data`, `alerts`, `notifications`, `trip-recording`, the `fault-codes`
coach store) is its job, so it is allowed to read them all.

The rest of the code does not follow the rule yet. As of 2026-11-09 (after plan 06), 19 other
slices import another feature (production code, tests excluded):

- 16 read `vehicle-select` — its `model/vehicleStore` (the selected id) or, since plan 06, its
  `api/activeProfile` (`getActiveProfile` / `useActiveProfile`, the selection resolved over the
  registry and the garage): adaptations, ai-diagnose, can-sniffer, coding, dpf, extended-pids,
  fault-codes, live-data, module-scan, onboarding, routines, sensor-readings, sensor-tests,
  service-reset, settings, trip-recording. Since plan 06 both modules live in `src/shared/state/`
  (`vehicleStore.ts`, `activeProfile.ts`) and the vehicle-select paths only re-export them, so each
  of these is fixed by switching the import to the shared path; `maintenance` already does;
- 8 other imports: adaptations → `module-scan` store, coding → `adaptations` service,
  connection → `onboarding` (`FirstRunCard`), history → `fault-codes` (`useDtcExport`),
  live-charts → `live-data` store and `onboarding` (`HintCard`), sensor-readings → `live-data`
  (`useLiveData`), settings → `connection` (`connectionService`).

This is layering debt, not a pattern to copy. A new cross-cutting engine goes here (or into a
shared store), never into a new feature → feature import.

## api / model

- `index.ts` exports `EngineHost`, `computePollPids`, `enabledRulePids` and the `PollPidInput`
  type. No store of its own: the engines write into the stores they serve.

## Acceptance

- With several screens mounted (Live + Charts), the adapter log shows **one** poll sweep per
  interval reading the union of their PIDs, never one loop per screen.
- With no screen registered, no enabled rule and no trip, the poll loop sends nothing.
- An alert rule fires (banner + OS notification) while the user is on any screen, without the Alerts
  screen ever having been opened; default rules exist after the first connect.
- A trip keeps sampling after the user leaves the Trips screen.
- A persistent poll error leaves one `live-data` entry in the error log, not one per interval.
- The readiness coach polls every 30 s while enabled and connected, and stops (and resets) on
  disconnect.
- `pollPids.test.ts` covers the union, ordering, de-duplication and disabled-rule exclusion.
