# Feature: history

A persistent, on-device **history** of diagnostic activity: every **AI auto-diagnose run** and every
**fault-code check**, each **linked to a car** (by VIN when available, else the selected profile). File-backed (expo-file-system) like settings, so it survives app restarts.
Retention is **capped** at the newest `MAX_HISTORY` (200) entries. Reachable from the **More** tab
(`/history`).

## What gets recorded
- **AI diagnosis runs** — saved by `useAiDiagnose` after each run: vehicle label, source (AI vs
  local), overall verdict, summary, finding count, and the full `AiReport`.
- **Fault-code checks** — saved by the fault-codes service (`dtcService.readAll`) on every read:
  vehicle label, MIL state, stored/pending/permanent codes, and monitor-readiness counts.

The DTC read that happens *inside* an AI run is part of that AI entry; only the dedicated **Fault
codes** screen creates `dtc` entries, so there is no double-logging.

## UI
- **HistoryScreen** — newest-first list with a **per-car filter** (a chip per distinct car, shown
  when more than one car has history) plus an **All / AI / Faults** type filter and a **Clear all**
  (confirmed) button. Each card shows the car (and VIN when known), is colour-coded (AI by overall
  verdict; faults by MIL/codes), and is timestamped. Empty state when nothing is saved yet.

## model
- `historyStore` (Zustand, **persisted** to `bolid.history` via `shared/state/persistStorage`):
  `entries: HistoryEntry[]` (a union of `AiHistoryEntry | DtcHistoryEntry`) plus `addAiRun`,
  `addDtcCheck`, `remove`, `clear`. Lives in `shared/state` so any feature can record without
  depending on another feature.
- Persist writes are wrapped in **`debouncedStorage(fileStateStorage, 500)`**: a burst of
  adds/removes rewrites the JSON file once, ~500 ms after the last mutation, instead of once per
  mutation (finding F7). Accepted loss window: up to ~500 ms of the most-recent list state on a hard
  kill — fine for history (a lost just-added entry re-derives on the next run). The error log
  deliberately stays on the **un-debounced** path (crash-time writes must not be delayed).
- A `merge` (mirroring the error-log store) concatenates rehydrated + in-memory entries deduped by
  id and re-applies the cap, so an entry added during the async hydration window survives.
- Each entry carries a `vehicle: { id, label, vin }` descriptor. Entries are grouped by
  `historyVehicleKey()` — the **VIN** when the ECU reports one, otherwise the selected profile `id`
  — so the same physical car is grouped even across profile changes. A persist `migrate` (v1→v2)
  lifts older `vehicleLabel`-only entries into the new `vehicle` shape.

## Retention
- **Capped at `MAX_HISTORY` (200)** newest entries — adding beyond the cap evicts the oldest (mirrors
  the `MAX_ERRORS` pattern), so the file and launch-time hydration stay bounded. The full `AiReport`
  is kept intact on each AI entry (not stripped) — the detail view re-opens it. **Clear all** still
  empties the list.

## Acceptance
- Running a diagnosis adds one `ai` entry; reading fault codes adds one `dtc` entry.
- Entries persist across app restarts and render under the correct filter.
- Clear all empties the list and the persisted file.
