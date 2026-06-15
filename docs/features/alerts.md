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
- A few **starter rules** seeded per profile (sensible coolant / voltage / RPM limits) that the user
  can edit or delete.

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
- `alertsStore` (Zustand, persisted): `rules: AlertRule[]`, plus ephemeral `activeAlerts`.

## Behavior
- Evaluation is decoupled from rendering and runs on every snapshot, so alerts work the same on BLE
  and the simulator.
- Hysteresis + debounce prevent alert flapping near a threshold.
- Only PIDs in the effective PID set are selectable, so a rule can't target a PID the car can't
  report.

## Acceptance
- In the simulator, scripting coolant past a threshold fires a critical alert and a haptic; dropping
  back below the hysteresis point clears it.
- Rules persist across restart; a fired alert appears as a marker on the recorded trip.
