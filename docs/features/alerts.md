# Feature: alerts

User-defined **thresholds** on live PIDs that fire visual + haptic (and optional audible) alerts —
e.g. coolant overheat, boost overshoot, low battery voltage, over-rev. Driven off the existing poll
loop; no new device protocol.

## UI

- **AlertsScreen** — list of rules; add/edit/enable per rule.
  - A rule: **PID**, **comparison** (`>`, `<`, in/out of range), **value**, optional **hysteresis**
    (clear-below to stop flapping), **severity** (info / warn / critical), and **action** (banner,
    haptic, sound, and/or an OS **local notification** via [`notifications`](./notifications.md)).
- **Active-alert surface** — a banner/toast on the dashboard with the offending PID, value, and
  threshold; a critical alert is sticky until acknowledged or cleared.
- A few **starter rules** (sensible coolant / voltage / RPM limits) that the user can edit or
  delete. Each is offered **once**: on every connect `seedDefaults(supportedPids)` adds the starter
  rules the car supports that were never offered before (`seededIds`, persisted), so a later car
  that reports `0142` still gets the low-voltage rule, while a deleted starter rule (or an emptied
  list) is never brought back.

## hooks

- `useAlertRules()` — CRUD + enable/disable; persisted.
- `useAlertEngine()` — evaluates rules against each session snapshot, manages hysteresis/debounce,
  and exposes currently-active alerts.

## api (service layer)

- `alertService` — pure evaluator: `(snapshot, rules) → activeAlerts`, with edge detection (fire on
  cross, clear on hysteresis). Stamps fire/clear events onto the trip timeline
  ([`trip-recording`](./trip-recording.md)). Triggers haptics (`expo-haptics`) / sound, and routes
  `warn`/`critical` alerts to [`notificationService`](./notifications.md) for OS notifications.

## model

- `alertsStore` (Zustand, persisted as `bolid.alerts` v1 since plan 18 — it was in memory only
  before, so every launch re-seeded the defaults): `rules: AlertRule[]` and `seededIds: string[]`
  (the starter-rule ids already offered) are written (malformed rules are dropped on load by
  `sanitizeAlertRules`); `active` is live state. The stored rules win, an empty list included; with
  no file the in-memory state is kept, and a starter rule EngineHost seeded during the start-up
  hydration window survives only when the file never offered it. A file without `seededIds` that
  holds rules counts every starter rule as offered (`sanitizeSeededIds`). Included in
  [backups](./backup.md).

## Behavior

- **Hosted app-wide by `EngineHost`** (mounted once in `_layout.tsx`): starter-rule seeding and
  `AlertEngine` evaluation + `warn`/`critical` OS notifications run on every snapshot whether or not
  the Alerts screen is mounted — so an overheat fires while the user sits on the Live tab. `useAlerts`
  is now just a subscription to `alertsStore.active`. Enabled rules' PIDs are added to the poll union
  so they're always read.
- Evaluation is decoupled from rendering and runs on every snapshot, so alerts work the same on BLE
  and the simulator.
- Hysteresis + debounce prevent alert flapping near a threshold.
- Only PIDs in the effective PID set are selectable, so a rule can't target a PID the car can't
  report.

## Acceptance

- In the simulator, scripting coolant past a threshold fires a critical alert and a haptic; dropping
  back below the hysteresis point clears it.
- Rules persist across restart; a fired alert appears as a marker on the recorded trip.
