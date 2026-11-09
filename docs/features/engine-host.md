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
   - computes the key set with `computePollPids` and splits it with `planSweep` into Mode 01 PIDs
     and extended DIDs (see [Split sweep](#split-sweep-mode-01--mode-22)); an empty result marks
     `liveDataStore.polling = false` and re-checks next tick, so nothing is sent on the bus;
   - otherwise calls `session.pollOnce(pids)`, then — when there are DIDs —
     `session.pollExtendedOnce(dids)` decoded by `decodeExtendedSnapshot`, writes the merged
     snapshot to `liveDataStore.setValues` and evaluates alerts on it; while `tripStore.recording`
     it pushes a numeric sample of the **Mode 01** part (`tripStore.pushSample({ t, values })`);
   - **period, not gap**: the next sweep is scheduled `max(0, intervalMs - elapsed)` after this one
     started, so the interval is the target period. On a slow K-line car a sweep can exceed the
     interval and the next one fires at once, paced by the bus;
   - **error dedup**: a failed sweep keeps the loop going and logs `source: 'live-data'` (warning)
     only when the message differs from the previous failure; a successful sweep resets it, so a
     persistent fault leaves one entry in the capped error log instead of one per interval;
   - **phases fail independently**: the Mode 01 read and the extended read each have their own
     `try`. An extended read that throws (an ELM timeout on an unanswered DID, a link hiccup) logs
     `source: 'live-data/extended'` (deduped the same way) and drops only that sweep's DID values;
     the Mode 01 snapshot is still published, alerted on and trip-sampled. When the Mode 01 read
     fails, its last values stay and fresh DID values are merged in, with no alert or trip pass.

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
   [vehicle-select](./vehicle-select.md#vin-auto-select). The effect is keyed on the session and
   the VIN, so a later `info` patch (the part number below) never re-runs it.
7. **Engine part number** (plan 14) — `connectionService` reads `22 F187` at connect when the
   profile active then declares extended DIDs. If none is cached and the active profile gains DIDs
   later in the session (VIN auto-select above, or a manual switch to the Golf), EngineHost reads
   it then (`session.readPartNumber()`, through the ELM queue) and caches it with
   `sessionStore.setPartNumber(session, pn)` — a no-op for a stale session or when one is already
   cached. `readPartNumber()` memoises its outcome per session (a `null` "no answer" too; only a
   thrown read is forgotten), so a retry after an unanswered connect-time read, or on a later
   profile switch, sends no second `22 F187`. Only on CAN; failures log
   `source: 'connection/part-number'`. The Extended PIDs screen uses it to pick the label pack for
   its measuring groups.

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

## Split sweep (Mode 01 + Mode 22)

Plan 14. A live-value key is a Mode 01 PID (`'010C'`) or an extended DID key `'22:<DID>'`
(`'22:1701'`, helpers in `shared/obd-core/obd/liveKeys.ts`: `extendedKey`, `isExtendedKey`,
`didOfKey`, `splitPollKeys`, `labelForLiveKey`). Both kinds share `liveDataStore.registrations` and
`liveDataStore.values`, so charts, the Extended PIDs screen and alert rules register and read them
the same way.

- `planSweep(keys, declaredDids, can)` (`pollPids.ts`, pure) splits the union with
  `splitPollKeys` and keeps a DID only when the link is **CAN** and the active profile **declares**
  it (`profile.extendedPids`). A stale `22:` registration — a chart panel left from the Golf after
  switching to the Punto, or a rule on a DID this profile lacks — costs no bus traffic.
- `session.pollExtendedOnce(dids)` reads the DIDs **sequentially** (`22 <did>` each; multi-DID
  requests are ECU-dependent and outgrow one ISO-TP frame) and returns the bytes after `62 <did>`, or
  null for NO DATA / a negative reply. Off CAN it sends nothing.
- `decodeExtendedSnapshot(raw, profile.extendedPids, ts)` (`extendedSnapshot.ts`, pure) turns them
  into `LiveValue`s keyed `22:<DID>` through each definition's `decode`; a DID with no definition,
  null bytes or a failing decoder is omitted, so its last value simply ages out (as for Mode 01).
- **Default header only.** The sweep never calls `setHeader` / `setRxFilter`: extended DIDs are read
  on the default (functional / engine) addressing. Module-scoped groups (ABS, cluster) would need
  re-addressing per sweep and `resetAddressing()` in a `finally`; they are deferred, as is KWP
  `21 <group>` over TP2.0.
- Alerts: `AlertRule.pid` may be an extended key — the engine evaluates the merged snapshot.
- Trip recording is unchanged: the trip PID set is the effective Mode 01 set and samples hold only
  Mode 01 values.
- The Extended PIDs measuring-block log keeps its own 1 s sweep; both may run, the ELM queue
  serialises them. How many DIDs per sweep a BLE link sustains is measured on the car (deferred).

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
  fault-codes, live-data, module-scan, onboarding, routines, sensor-tests,
  service-reset, settings, trip-recording. Since plan 06 both modules live in `src/shared/state/`
  (`vehicleStore.ts`, `activeProfile.ts`) and the vehicle-select paths only re-export them, so each
  of these is fixed by switching the import to the shared path; `maintenance` already does;
- 8 other imports: adaptations → `module-scan` store, coding → `adaptations` service,
  connection → `onboarding` (`FirstRunCard`), history → `fault-codes` (`useDtcExport`),
  live-charts → `onboarding` (`HintCard`),
  settings → `connection` (`connectionService`). Plan 14 moved two stores to `src/shared/state/`
  so it adds no feature → feature import: the chart panel store (`chartsStore.ts`, for the Extended
  PIDs screen's "Chart this") and the live-value store (`liveDataStore.ts`, for its DID
  registrations; this also removed live-charts' old import of the `live-data` store). The feature
  paths only re-export them.

This is layering debt, not a pattern to copy. A new cross-cutting engine goes here (or into a
shared store), never into a new feature → feature import.

The [report](./report.md) slice (plan 15) is the second sanctioned composition point: building one
document for the whole car is its job, so it reads the module-scan, inspection, battery, AI and
maintenance stores; nothing imports it back.

## api / model

- `index.ts` exports `EngineHost`, `computePollPids`, `enabledRulePids`, `planSweep`,
  `decodeExtendedSnapshot` and the `PollPidInput` type. No store of its own: the engines write into the stores they serve.

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
- `pollPids.test.ts` covers the union, ordering, de-duplication and disabled-rule exclusion, plus
  mixed Mode 01 / extended keys and `planSweep`'s CAN / declared-DID filter.
- Golf simulator: a `22:1701` registration is polled with `010C` and lands in
  `liveDataStore.values` without the Extended PIDs screen open; Punto / Passat: no `22` request in
  the adapter log even with a stale `22:` registration; a throwing `pollExtendedOnce` still
  publishes `010C` and logs `live-data/extended`; connecting under Generic and then selecting the
  Golf reads the part number (`EngineHost.extended.test.tsx`).
  `extendedSnapshot.test.ts` covers the decode and one full sweep on the simulator.
