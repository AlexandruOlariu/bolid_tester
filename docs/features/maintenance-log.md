# Feature: maintenance-log

A persistent **service logbook**: record what was done, when, and at what odometer, then see **what's
due** (oil, filters, timing belt, brake fluid, coolant, DPF check…) by distance and by time. This is
the richer record behind the date/mileage **reminders** in [`notifications`](./notifications.md) — the
log is the history; reminders are the alarms.

> Honest scope: the **odometer is not a standard OBD2 PID** (it lives on the instrument cluster), so
> mileage is **user-entered**. The app can _pre-fill_ a projected odometer from average yearly
> distance (or from accumulated [`trip`](./trip-recording.md) distance), but it never claims an exact
> reading.

## What it does

- A catalogue of **service items** (`DEFAULT_SERVICE_ITEMS`, diesel-biased) each with a km and/or
  month interval; the user can log a completion (`{ itemId, date, odoKm, note }`).
- For each item, computes **due-in-km** and **due-in-days** from the latest log entry + the current
  odometer/date, and a status: **ok / soon / overdue / unknown**.
- Per-car: every car keeps its own logbook — see [Per-car logbook](#per-car-logbook).

## Per-car logbook

Since [plan 06](../plans/06-garage-learned-profiles.md) each car has its own entries, odometer and
yearly mileage, and the screen shows the **active car's** logbook ("Logbook for _car_. Each car keeps
its own logbook — switch cars on the Vehicle screen."). Switching the active car switches the
logbook and resets the odometer field to that car's value.

- **Key** (`maintenanceKeysFor(profileId, garage)`), like [`history`](./history.md):
  `vin:<VIN>` for a garage car learned with a VIN, else `id:<profile id>`. A learned garage car keeps
  its `id:` key as an alias, so a logbook started before the car was learned is folded into the VIN
  key on the next edit (`consolidate`). A re-learn of the same car keeps the same VIN key.
- **Migration v1 → v2.** A v1 file holds one global logbook (`{ entries, odoKm, kmPerYear }`).
  `migrateMaintenance` moves it under the key of the car that is selected when the upgrade runs, so
  an existing user keeps every entry under the car they had selected. The two persisted stores
  hydrate asynchronously; when the vehicle store has not hydrated yet the bucket is parked under
  `legacy:v1` and `adoptLegacyBucket` moves it once both stores have hydrated. An empty v1 logbook
  migrates to nothing. The vehicle selection itself is untouched.

## UI

- **MaintenanceScreen** — the active car's name, the current odometer (editable, with an optional projected value), a **due
  list** sorted worst-first with color-coded status and "in N km / N days" (or "overdue by…"), and an
  **add entry** form (pick item, odometer, date = today). Past entries are listed per item.
- One-tap "create a reminder" hands a due item to [`notifications`](./notifications.md).

## hooks

- `useMaintenance()` — the active car's logbook: `vehicleKey`, `vehicleLabel`, items, entries,
  current odometer, `computeDue(...)` results, and `addEntry / removeEntry / setOdometer` bound to
  the active car's keys.

## api (core)

- Pure math in [`obd-core/analysis/maintenance`](../architecture.md) — `computeDue(items, entries,
current)`, `dueStatus`, `lastEntryFor`, `projectOdometer`, and `DEFAULT_SERVICE_ITEMS`. No I/O;
  unit-tested.

## model

- `maintenanceStore` (Zustand, **persisted** `bolid.maintenance` **v2** via `fileStateStorage`):
  `items: ServiceItem[]` (the catalogue, not persisted) and
  `byVehicle: Record<key, { entries: LogEntry[]; odoKm: number | null; kmPerYear }>`. Every action
  takes the car's keys (`setOdometer(keys, v)`, `addEntry(keys, e)`, …).

## Behavior

- Entirely hardware-free — it's a logbook plus date/odometer math, usable with no car connected.
- Complements rather than duplicates notifications: completing a service here can advance the
  matching reminder by advancing its due point.

## AI agent

- AI agent: `read_maintenance` — `agent/agentTools.ts` contributes the tool, the `maintenance`
  procedure (it calls `read_maintenance {}`, so `run_skill` and the no-AI mode can run it) and the
  `maintenance` skill to the [AI agent](./ai-diagnose.md#agent). Always offered, no adapter time.
  It reads the **active car's** bucket exactly as `useMaintenance` does (`maintenanceKeysFor(
  getActiveProfile().id, garage)` → `bucketFor`) and runs `computeDue` with the run's clock. A car
  with no log entries reads `No maintenance recorded for this car.`; otherwise the first line is the
  logbook odometer (or `not entered, so the km left are unknown`), then one line per item worst
  first: `<name> (every <km> km / <months> months): <ok|soon|overdue|unknown>, last <yyyy-mm-dd> at
<km> km; <n> km left|overdue, <n> days left|overdue` (`never logged` when there is no entry).
  Findings: `maintenance:agent.finding.overdue` (`warn`) per overdue item and
  `maintenance:agent.finding.soon` (`info`) per item due soon, both with `values: { item }` (the
  item's name in the app language).

## Acceptance

- Logging an oil change at 100 000 km then setting the odometer to 114 000 km shows oil service **soon**
  (within the 15 000 km interval); 13 months later it reads **overdue** on time.
- With no history every item reads **unknown**.
- Entries added while car A is active are not shown for car B; an upgrade from a v1 file keeps the
  old entries under the car that was selected.
- `projectOdometer(100000, oneYearAgo, 15000)` ≈ 115 000.
