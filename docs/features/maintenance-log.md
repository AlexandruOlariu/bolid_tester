# Feature: maintenance-log

A persistent **service logbook**: record what was done, when, and at what odometer, then see **what's
due** (oil, filters, timing belt, brake fluid, coolant, DPF check…) by distance and by time. This is
the richer record behind the date/mileage **reminders** in [`notifications`](./notifications.md) — the
log is the history; reminders are the alarms.

> Honest scope: the **odometer is not a standard OBD2 PID** (it lives on the instrument cluster), so
> mileage is **user-entered**. The app can *pre-fill* a projected odometer from average yearly
> distance (or from accumulated [`trip`](./trip-recording.md) distance), but it never claims an exact
> reading.

## What it does
- A catalogue of **service items** (`DEFAULT_SERVICE_ITEMS`, diesel-biased) each with a km and/or
  month interval; the user can log a completion (`{ itemId, date, odoKm, note }`).
- For each item, computes **due-in-km** and **due-in-days** from the latest log entry + the current
  odometer/date, and a status: **ok / soon / overdue / unknown**.
- Per-car: entries are keyed to the active vehicle (VIN when known, else profile id), like
  [`history`](./history.md).

## UI
- **MaintenanceScreen** — the current odometer (editable, with an optional projected value), a **due
  list** sorted worst-first with color-coded status and "in N km / N days" (or "overdue by…"), and an
  **add entry** form (pick item, odometer, date = today). Past entries are listed per item.
- One-tap "create a reminder" hands a due item to [`notifications`](./notifications.md).

## hooks
- `useMaintenance()` — exposes the items, entries, current odometer, `computeDue(...)` results, and
  `addEntry / removeEntry / setOdometer` actions.

## api (core)
- Pure math in [`obd-core/analysis/maintenance`](../architecture.md) — `computeDue(items, entries,
  current)`, `dueStatus`, `lastEntryFor`, `projectOdometer`, and `DEFAULT_SERVICE_ITEMS`. No I/O;
  unit-tested.

## model
- `maintenanceStore` (Zustand, **persisted** via `fileStateStorage`): `items: ServiceItem[]`,
  `entries: LogEntry[]`, `odoKm: number | null`, `kmPerYear`. Survives launches like the other
  file-backed stores.

## Behavior
- Entirely hardware-free — it's a logbook plus date/odometer math, usable with no car connected.
- Complements rather than duplicates notifications: completing a service here can advance the
  matching reminder by advancing its due point.

## Acceptance
- Logging an oil change at 100 000 km then setting the odometer to 114 000 km shows oil service **soon**
  (within the 15 000 km interval); 13 months later it reads **overdue** on time.
- With no history every item reads **unknown**.
- `projectOdometer(100000, oneYearAgo, 15000)` ≈ 115 000.
