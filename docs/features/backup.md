# Feature: backup

**Backup & restore** (plan 18, [plan](../plans/18-backup-restore.md)): every persisted store
exports as JSON (and CSV where it is a table); one tap writes a single **backup file** with all
stores and the trip recordings; restoring from such a file validates it, snapshots the current data
first, writes the stores back through their own `persist` migrations and rehydrates them without a
restart. No cloud, no account; the AI API keys are never in a backup.

Reached from **Settings → Data** ("Backup & restore", "Export data…") and **More → Backup &
restore**. Route `/backup` (`src/app/backup.tsx`, hidden tab).

## The backup file

One JSON file, `bolid-backup-<yyyymmdd-hhmm>.json` (UTC, so names sort by date; a second backup in
the same minute gets `-2`), written to `documentDirectory/backups/` and then offered to the share
sheet. Built by the pure `src/shared/lib/backup.ts`:

```json
{
  "format": 1,
  "createdAt": 1762698600000,
  "app": { "version": "0.9.0", "platform": "android" },
  "stores": [{ "name": "bolid.history", "version": 2, "state": { "entries": [] } }],
  "tripFiles": [{ "id": "1762698600000", "csv": "ts,010C\n…" }],
  "sizes": { "storesBytes": 51234, "tripBytes": 401234 }
}
```

- `stores[]` is each store's zustand file (`{"state", "version"}`) as it is on disk
  (`parseEnvelope`; a missing version reads as 0). Absent or unreadable files are skipped.
- `tripFiles[]` (only when **Include trip recordings** is on) are the `trip-<id>.csv` files of the
  trips in the list; the summaries travel in `bolid.trips`.
- **Why one JSON and no zip:** every payload is text, so JSON is lossless, opens in a text editor,
  shares through any channel and needs no native module. A one-hour 1 Hz trip with ~15 PIDs is
  about 0.4 MB of CSV; the screen estimates the size of the **whole file** (the stores serialized
  as written, `storesEstimateBytes` → `estimateBundleBytes`, plus the trip CSVs when included) and
  warns above 50 MB (`LARGE_BACKUP_BYTES` = 50 000 000 bytes, the SI unit `formatBytes` shows). A
  zip library would only buy compression.
- **Plaintext.** The file is not encrypted and holds the VINs and the whole history. It never
  holds an API key: those live in the OS keystore (`secureApiKey.ts`), the settings store writes
  `apiKey: ""`, and `redactBackup` blanks any non-empty `apiKey` it finds (a legacy settings blob)
  — when the backup is built **and** before one is restored, so a hand-edited file cannot plant a
  key either.

Pure helpers (`src/shared/lib/backup.ts`, core tsconfig, `backup.test.ts`): `parseEnvelope`,
`envelopeFor`, `buildBackup`, `redactBackup` / `redactState`, `validateBackup` / `parseBackup`,
`planRestore`, `serializeBackup`, `estimateBundleBytes`, `backupFileName`, `preRestoreFileName`,
`preRestoreFilesToDelete`, `uniqueFileName`, `countItems`, `formatBytes` (metric: B / kB / MB),
`utf8Bytes`.

### Validation

`validateBackup(x, knownStoreNames)` refuses: anything that is not an object, a `format` other than
1 ("Update the app to restore it"), a missing `stores` array, a store without a string name, an
integer version ≥ 0 or a `state`. It **warns** (the rest still restores) about a store name this app
does not know, a duplicate store (first wins), and malformed trip files — a trip id must be a plain
file-name part (`^[A-Za-z0-9_-][A-Za-z0-9._-]*$`), so `../settings` can never be written.

## The store registry

`api/registry.ts` — `PERSISTED_STORES` is **the one list to update when a store gains `persist`**.
`api/storeVersions.test.ts` scans `src/` for every `persist(` store name and fails when the
registry misses one. Rows, in restore order:

| Store                    | Label                                           | CSV | Restored by default |
| ------------------------ | ----------------------------------------------- | --- | ------------------- |
| `bolid.settings`         | Settings                                        |     | yes                 |
| `bolid.garage`           | Garage (my cars)                                |     | yes                 |
| `bolid.vehicle`          | Selected vehicle                                |     | yes                 |
| `bolid.loginBook`        | Module login codes (code book)                  |     | yes                 |
| `bolid.labelPacks`       | Imported label packs                            |     | yes                 |
| `bolid.history`          | History (diagnoses, fault-code checks, reports) | yes | yes                 |
| `bolid.maintenance`      | Maintenance log                                 | yes | yes                 |
| `bolid.trips`            | Trips                                           |     | yes                 |
| `bolid.scans`            | Module scans                                    | yes | yes                 |
| `bolid.carBackups`       | Coding backups (full-car snapshots)             |     | yes                 |
| `bolid.dashboard-layout` | Dashboard layout                                |     | yes                 |
| `bolid.alerts`           | Alert rules                                     |     | yes                 |
| `bolid.notifications`    | Notification settings and reminders             |     | yes                 |
| `bolid.onboarding`       | Dismissed hints                                 |     | no                  |
| `bolid.errors`           | Error log                                       |     | no                  |

The garage and the selected car come before the maintenance logbook, whose legacy-bucket adoption
reads them. `bolid.backups` (the list of backup files, `model/backupStore.ts`: the newest 20
backups the user made, plus the pre-restore snapshots, **capped separately** by `withRecord` so a
snapshot never pushes a user's backup, possibly the file being restored, off the list) is
deliberately not in the registry: a backup never contains the list of backups. When a new file
pushes an entry off the list, `createBackup` deletes that entry's file too, so old backups cannot
pile up in `backups/` out of sight. A record holds the **file name only**; its URI is derived at use
time (`backupFileUri`), because on iOS the app container path — and so `documentDirectory` —
changes across app updates (a record from an early build that still carries a `uri` loses it on
load).

Each row (`PersistedStoreRef`) carries `name`, `label`, `restoreByDefault`, `version()`,
`migrates()` (the store declares a `migrate`), `snapshot()` (the partialized in-memory state, used when a store has no file yet),
`rehydrateFresh()`, `count(state)` (items for the restore summary) and, for the tables, `csv(state)`.

**CSV exports** (`api/storeCsv.ts`, ISO 8601 UTC dates, km): history — one row per code of each
fault-code check (a clean check gets one "No fault codes" row); module scans — one row per module
fault, UDS and TP2.0; maintenance — one row per logbook entry, newest first per car.

## Restore sequence

`api/backupService.ts → restoreBackup(mods, bundle, { stores, includeTrips })`:

1. **Redact and plan.** `planRestore(bundle, selected, currentVersions(), migratableStores())`
   restores a store whose version equals the app's, or is older and the store has a `migrate`; a
   store **written by a newer app** (higher version) is skipped with "Saved by a newer app version
   … Update the app to restore it."; an **older** version of a store without a `migrate` is skipped
   with "Saved with an older data version … that this app cannot upgrade" (zustand would discard
   such a blob and hydrate nothing, so the store would come back empty); one the backup lacks is
   "Not in this backup."
2. **Snapshot first.** `createBackup({ includeTrips: true, kind: 'pre-restore' })` writes
   `backups/pre-restore-<stamp>.json` (no share sheet). If it cannot be written, **nothing is
   restored**. Only the newest 3 pre-restore files are kept (`prunePreRestore`); they appear in the
   list as "Automatic, before a restore", and restoring one is the undo.
3. **Each selected store:** `flushPendingWrites()` (so a debounced write still pending from before
   cannot land after ours), write its file with `fileStateStorage.setItem(name, envelopeFor(blob))`
   and **read it back** (`setItem` is best-effort: it logs a `persist` warning and resolves, so a
   failed write would otherwise be reported as restored — such a store is skipped with "Could not be
   restored (see the error log)."), then `rehydrateFresh()`. zustand runs the store's own `migrate` when the blob is older (e.g.
   `bolid.history` v1 → v2 lifts `vehicleLabel` into `vehicle`), and writes the migrated state back.
   zustand's `hydrate()` swallows an error thrown by `migrate` or `merge` (a hand-edited blob such
   as `bolid.trips` `{ trips: [{}] }`), so `rehydrateFresh` captures it through
   `onRehydrateStorage` and rejects; the store keeps its old data in memory, is skipped with "Could
   not be restored", and its **previous file is put back** so the next launch does not load the
   rejected blob.
4. **Trip files:** the `trip-<id>.csv` of each trip in the trips list (as restored) is written
   (overwritten), so the restored trips open with their samples; a recording whose trip is not in
   the list is not written (nothing could open or delete it). When `bolid.trips` was restored, the
   CSVs of the trips that dropped out of the list are deleted (the pre-restore snapshot holds them).
5. Returns `{ restored, skipped: { name, reason }[], tripFilesWritten, snapshot }`; the screen shows
   it. The error log is only touched when the user ticked it.

`rehydrateFresh` **replaces** the persisted fields instead of merging with memory: the stores' own
`merge` functions keep items added during the start-up hydration window (right at launch, wrong for
a restore — a restored history would otherwise be the union of old and new). It temporarily wraps
the store's `merge` so it runs against the store's initial values for its persisted keys, then puts
the original back. Live, non-persisted state is left alone: a trip being recorded keeps recording,
active alerts and the OS notification permission stay, and the settings store reloads the current
provider's API key from the keystore (`onRehydrateStorage`). Before a restore the hook calls
`connectionService.resetForRestore()` — the same teardown as `switchAdapterSource`: a connect still
in flight is invalidated (it never publishes a session built for the old source), auto-reconnect is
cancelled, the session store is reset and the **adapter log is cleared** (a restored
`bolid.settings` can flip `adapterSource`, and a replay fixture exported from the log is labelled
with the current source), then the old session is closed.

## UI

`ui/BackupScreen.tsx` ("Backup & restore", "Everything in one file you keep"):

- **Back up** — what is in the file and that it is plaintext with VINs but no API key; **Include
  trip recordings** ("N files, about X MB"; off when there are none); "The backup file will be about
  X MB." (stores + trips when included) and a warning when that estimate is above 50 MB;
  **Back up now** writes, records and shares the file, then "Saved <file> (<size>)."
- **Restore from file** — **Choose a backup file…** (system document picker, `expo-document-picker`,
  JSON / text / any binary type since Android may label a shared file oddly; the content is
  validated anyway). A file that is not a backup says why. A valid one shows a card: "Made <date>
  by app version <v> (<platform>)", warnings, one checkbox per registry row with its item count
  (rows the file lacks are disabled; error log and dismissed hints start unticked), **Trip
  recordings**, then **Restore** → two confirmations ("Your current data is snapshotted first, so
  you can undo." → "Replace your data?") → a result card: restored, skipped with the reason, trip
  recordings restored, and the name of the pre-restore snapshot.
- **Backups on this phone** — the newest 20 backups, the automatic snapshots counted apart ("an
  older file is deleted when a new one is saved"; name, date, size, "with trips", "Automatic, before a restore") with **Share**, **Restore**
  (opens the same checklist) and **Delete** (confirm).
- **Export one part** — one row per registry store with **JSON** (`{ name, version, exportedAt,
state }`, secrets blanked) and, for history / module scans / maintenance, **CSV**. Files are
  `bolid-<store>-<yyyymmdd-hhmm>.<json|csv>` in the document directory, shared at once.

## Native modules

`loadBackupModules()` loads `expo-file-system/legacy` (required), `expo-sharing` and
`expo-document-picker` (both optional) with variable specifiers; every service function takes them
as a parameter, so `api/backupService.test.ts` runs the whole flow in the core project against the
real stores and an in-memory file system, and the UI test hands the same doubles to the screen.
`expo-document-picker` (`~56.0.4`) is a native module: an installed build older than plan 18 has no
picker until the next native build — **Choose a backup file…** then says so, and restoring from the
list still works.

## What is not in a backup, and why

- **API keys** — kept in the OS keystore, one per provider (see [settings](./settings.md)).
- **The adapter I/O log** — in memory only, a debugging aid (export it as a replay fixture).
- **Live state** — the connection, the live values, a trip still recording, active alerts, the
  notification permission.
- **The list of backup files** (`bolid.backups`).
- **Security-access plugins** (`bolid.seedKeys`, plan 23) — the index points at plugin files in
  `documentDirectory/seedkeys/`, which belong to the phone and car they were imported for; on a new
  phone, import the files again. Both are listed in `NOT_BACKED_UP` (`api/registry.ts`), which
  `storeVersions.test.ts` checks.

## Plans that build on this

Plan 32 (feedback / log bundle) reuses `exportStore` and `createBackup` (exported from
`src/features/backup/index.ts`). Plan 07's "Reset all app data" is the natural partner of restore;
until it lands, clearing app storage in Android settings gives the "cleared app" a restore is tested
against.

## Acceptance

- The backup file opens in a text editor and holds `format: 1`, the store list and (when enabled)
  `tripFiles`; every `apiKey` in it is `""`.
- Restoring onto a cleared app brings back history, scans, trips (they open with their samples —
  the trip recorder reads and writes its CSVs through `expo-file-system/legacy`, like the backup),
  maintenance, dashboard layout, the garage and the selected vehicle; a `backups/pre-restore-*.json`
  exists afterwards.
- A backup whose `bolid.history` has `version: 1` restores with migrated `vehicle` fields.
- A store with a version newer than the app is skipped with a message; the others restore.
- Per-store JSON export shares a file for every registry row; CSV for history, scans, maintenance.
