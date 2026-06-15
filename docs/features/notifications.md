# Feature: notifications

A single **local notification** layer (no server, no push tokens) that surfaces important events to
the OS notification centre and as in-app banners. Three sources feed it: **threshold alerts**
([`alerts`](./alerts.md)), **connection & diagnostic events**, and **maintenance reminders**.

> **Scope (chosen): foreground + local.** Notifications are delivered via on-device local
> notifications (`expo-notifications`). Two honest limits:
> 1. **Live monitoring needs the session active.** Alert and diagnostic notifications fire while the
>    app is connected to the adapter (foreground / app-active). There is **no** continuous background
>    OBD2 monitoring — BLE background execution on iOS/Android is too constrained to promise it.
> 2. **Maintenance reminders are time-scheduled**, so they fire reliably even when the app is closed,
>    because the OS holds the scheduled notification — they do not depend on a live connection.

## Sources
- **Threshold alerts** — when [`alertService`](./alerts.md) raises a `warn`/`critical` alert, it also
  emits a local notification (respecting a per-severity toggle). Critical alerts can use a distinct
  channel/sound.
- **Connection & diagnostic events:**
  - Adapter **connected / disconnected / connection lost** (mid-drive drop is worth surfacing).
  - **New fault code / MIL on** — a DTC appears or the malfunction lamp turns on (from
    [`fault-codes`](./fault-codes.md)).
  - **Readiness ready** — emissions monitors complete → "ready for inspection".
  - **Trip recorded** — a drive finished and saved (from [`trip-recording`](./trip-recording.md)).
- **Maintenance reminders** — user-defined, **date-** and/or **mileage-based** (see below).

## Maintenance reminders
- A reminder: `{ title, due }` where `due` is a **date** ("inspection 2026-09"), a **mileage target**,
  or both; with a lead time ("notify 7 days / 200 km before").
- **Mileage source, honestly:** odometer is **not** a standard OBD2 PID (it lives on the
  instrument cluster), so mileage is **user-entered**, optionally assisted by distance accumulated
  from recorded trips (speed-integrated — approximate, opt-in). Date-based reminders need no vehicle
  data at all.
- Date reminders are scheduled as OS notifications up front. Mileage reminders are evaluated when the
  app next has a fresh mileage figure and then (if close) scheduled.

## UI
- **NotificationsScreen** (or a Settings section):
  - **Permission** prompt + status; deep-link to OS settings if denied.
  - **Per-category toggles**: alerts (by severity), connection events, diagnostic events, trip saved,
    maintenance.
  - **Quiet hours** + a global mute.
  - **Maintenance reminders** list: add/edit/complete, with date/mileage + lead time.
- A small unread/active indicator on the relevant tab.

## hooks
- `useNotificationPermission()` — request/read permission status.
- `useNotificationPrefs()` — persisted per-category toggles + quiet hours.
- `useMaintenanceReminders()` — CRUD reminders; schedule/cancel OS notifications.

## api (service layer)
- `notificationService` — the **single** place that calls `expo-notifications`. Exposes
  `notify({ category, title, body, severity })`, applies prefs/quiet-hours/dedupe, sets up Android
  channels + iOS categories, and schedules/cancels date-based reminders. Other features call it; they
  never touch the OS API directly.
- Subscribes to the `DiagnosticSession`/connection store for the diagnostic-event triggers (edge
  detection: notify on MIL **rising** edge, not every poll), reusing the same edge logic style as
  [`alerts`](./alerts.md).

## model
- `notificationsStore` (Zustand, persisted): `prefs`, `reminders: MaintenanceReminder[]`,
  `permissionStatus`, and a short in-app `history` of recent notifications.

## Behavior
- All event sources route through `notificationService`, so prefs, quiet hours, and dedupe apply
  uniformly.
- Diagnostic/alert notifications are **best-effort and tied to an active session**; the UI never
  implies 24/7 background monitoring.
- Maintenance/date reminders fire independent of any connection.
- Fully testable in the **simulator**: scripting a coolant-overheat, a simulated MIL-on, or a saved
  trip produces the corresponding notification through the same path.

## Acceptance
- With permission granted, a simulator overheat raises both an in-app banner and a local
  notification; muting that category suppresses the notification but keeps the in-app banner.
- A date-based maintenance reminder scheduled for the near future fires even with the app closed and
  no adapter connected.
- A simulated MIL-on emits exactly one "new fault code" notification (rising edge), not one per poll.
- Quiet hours suppress non-critical notifications and defer them; critical alerts can be configured
  to override.
