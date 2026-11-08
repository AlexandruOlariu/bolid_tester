# Plan 18 — Export everything, one-tap backup and restore

**Size:** M (1–1½ days) · **Depends on:** nothing (06 adds `bolid.garage` to the registry when it
lands) · **Roadmap:** v0.4 "Export everything", "Backup / restore"

## Goal

Every persisted store can be exported as JSON (and CSV where tabular); one tap writes a single
**backup bundle** (all stores + trip CSV files) to a file the user can keep anywhere; restoring
from such a file validates it, snapshots the current state first, writes the stores back through
their own `persist` migrations, and rehydrates without a restart. No cloud, no new native module
except a document picker. The API key is never included.

## Why

All app data lives in `documentDirectory/bolid.*.json` files written by
`src/shared/state/persistStorage.ts` plus `trip-<id>.csv`. Reinstalling or changing phones loses
garage, history, scans, trips, maintenance and coding backups. Per-store exports exist only for
errors (MD/JSON), DTC history (MD), scans (`.txt`) and trips (CSV).

## Read first

- `src/shared/state/persistStorage.ts`: `fileStateStorage` (`fileFor(name)` =
  `${DIR}${name.replace(/[^a-zA-Z0-9._-]/g,'_')}.json`), `debouncedStorage`, `setPersistLogger`.
  zustand writes the envelope `{"state": <partialized>, "version": <n>}`.
- Every `persist(` store (grep `name: 'bolid.`):

  | key                      | file                                                   | version                          | store                     | notes                                                       |
  | ------------------------ | ------------------------------------------------------ | -------------------------------- | ------------------------- | ----------------------------------------------------------- |
  | `bolid.settings`         | `src/shared/state/settingsStore.ts`                    | 1 (2–3 after plans 01/06/19)     | `useSettingsStore`        | `partialize` already redacts `ai.apiKey` via `redactApiKey` |
  | `bolid.vehicle`          | `src/features/vehicle-select/model/vehicleStore.ts`    | 1                                | `useVehicleStore`         |                                                             |
  | `bolid.history`          | `src/shared/state/historyStore.ts`                     | 2                                | `useHistoryStore`         | has `migrate` v1→v2                                         |
  | `bolid.errors`           | `src/shared/state/errorLogStore.ts`                    | 1                                | `useErrorLogStore`        | un-debounced; `MAX_ERRORS` 500                              |
  | `bolid.maintenance`      | `src/features/maintenance/model/maintenanceStore.ts`   | 1 (2 after plan 06)              | `useMaintenanceStore`     |                                                             |
  | `bolid.trips`            | `src/features/trip-recording/model/tripStore.ts`       | 1                                | `useTripStore`            | summaries only; samples in `trip-<id>.csv`                  |
  | `bolid.scans`            | `src/features/module-scan/model/scanHistoryStore.ts`   | **none** (zustand defaults to 0) | `useScanHistoryStore`     |                                                             |
  | `bolid.carBackups`       | `src/features/coding/model/carBackupStore.ts`          | **none**                         | `useCarBackupStore`       |                                                             |
  | `bolid.dashboard-layout` | `src/features/live-data/model/dashboardLayoutStore.ts` | 1                                | `useDashboardLayoutStore` |                                                             |
  | `bolid.onboarding`       | `src/features/onboarding/model/onboardingStore.ts`     | 1                                | `useOnboardingStore`      |                                                             |
  | `bolid.garage`           | plan 06                                                | 1                                | `useGarageStore`          | add when it lands                                           |

- `src/shared/state/secureApiKey.ts` (`API_KEY_STORE_KEY = 'bolid.ai.apiKey'`, `redactApiKey`) —
  the key lives in the OS keystore and is **never** part of a bundle.
- `src/features/trip-recording/hooks/useTripRecorder.ts` (CSV naming `trip-<id>.csv`, tolerant
  `expo-file-system` import), `src/features/error-log/hooks/useErrorLogExport.ts` (export pattern).
- `src/features/settings/ui/SettingsScreen.tsx` (sections; plan 07 adds a Developer section and
  "Reset all app data" — this plan adds a **Data** section next to it).
- Installed: `expo-file-system` 56.0.8 (`legacy` entry used by persistStorage), `expo-sharing`
  56.0.20, `expo-constants`. **Not installed:** `expo-document-picker`, `react-native-zip-archive`.
- **Discovery:** `src/features/alerts/model/alertsStore.ts` and
  `src/features/notifications/model/notificationsStore.ts` are **not persisted** (plain `create`),
  so alert rules and notification prefs are lost on every restart. Out of scope here; see
  "Out of scope".

## Design

### Bundle format (pure, `src/shared/lib/backup.ts`)

```ts
export const BACKUP_FORMAT = 1 as const;
export interface BackupStoreBlob {
  name: string;
  version: number;
  state: unknown;
}
export interface BackupTripFile {
  id: string;
  csv: string;
}
export interface BackupBundle {
  format: typeof BACKUP_FORMAT;
  createdAt: number;
  app: { version: string | null; platform: string };
  stores: BackupStoreBlob[];
  tripFiles?: BackupTripFile[];
  /** Sizes for the UI estimate; computed on build. */
  sizes: { storesBytes: number; tripBytes: number };
}
export interface RawStoreFile {
  name: string;
  raw: string | null;
} // raw = file contents or null when absent

export function parseEnvelope(raw: string): { state: unknown; version: number } | null; // tolerant: missing version → 0
export function buildBackup(
  files: RawStoreFile[],
  tripFiles: BackupTripFile[],
  app: BackupBundle['app'],
  now?: number,
): BackupBundle;
export function redactBackup(b: BackupBundle): BackupBundle; // deletes stores[settings].state.ai.apiKey if a legacy blob still has it
export type BackupValidation =
  | { ok: true; bundle: BackupBundle; warnings: string[] }
  | { ok: false; reason: string };
export function validateBackup(x: unknown, known: string[]): BackupValidation; // format === 1, stores array, each name string + version number; unknown store names → warning, not error
export function envelopeFor(blob: BackupStoreBlob): string; // JSON.stringify({ state, version })
export function estimateBundleBytes(b: BackupBundle): number;
export function backupFileName(now: number): string; // `bolid-backup-<yyyymmdd-hhmm>.json`
```

Why a single JSON and **no zip library**: every payload is text (zustand JSON + trip CSV), so a JSON
bundle is lossless, human-inspectable, shareable through any channel, and needs no native module.
Size: a 1-hour trip at 1 Hz with ~15 PIDs is ≈ 0.4 MB of CSV; 20 such trips ≈ 8 MB, well inside
`writeAsStringAsync`/`readAsStringAsync` limits. The UI shows the estimate and offers "Include trip
recordings" (default on) and warns above 50 MB. `react-native-zip-archive` would only buy
compression; revisit if a user hits the warning.

### Store registry and apply (feature layer)

`src/features/backup/` is a **composition slice** (like `engine-host`): it may import the other
features' stores. `api/registry.ts`:

```ts
export interface PersistedStoreRef {
  name: string;
  api: {
    persist: {
      rehydrate: () => Promise<void> | void;
      clearStorage: () => void;
      getOptions: () => { version?: number };
    };
  };
  csv?: (state: unknown) => string | null;
}
export const PERSISTED_STORES: PersistedStoreRef[]; // the eleven rows above (garage when present); `csv` for history (dtc entries), scans (one row per module fault), maintenance entries
export const STORE_NAMES = PERSISTED_STORES.map((s) => s.name);
```

`api/backupService.ts`:

- `exportStore(name, format: 'json' | 'csv')` → writes `${documentDirectory}bolid-<name>-<stamp>.<ext>`
  and shares it (tolerant imports; `logError({ source: 'backup/export' })`).
- `createBackup({ includeTrips })` → reads each `fileFor(name)` through `fileStateStorage.getItem`,
  reads `trip-<id>.csv` for every `useTripStore.getState().trips[].header.id` that exists, builds +
  redacts the bundle, writes `${documentDirectory}backups/<backupFileName>` (`makeDirectoryAsync`
  with `intermediates`), shares it, records `{ fileName, createdAt, bytes }` in a small
  `backupStore` (`bolid.backups`, last 20 entries, not itself included in bundles).
- `pickBackupFile()` → `const Picker = await import('expo-document-picker' as string);
const res = await Picker.getDocumentAsync({ type: 'application/json', copyToCacheDirectory: true,
multiple: false }); if (res.canceled) return null; return FileSystem.readAsStringAsync(res.assets[0].uri)`.
- `restoreBackup(bundle, opts: { stores: string[]; includeTrips: boolean })`:
  1. `createBackup({ includeTrips: true })` without sharing → `backups/pre-restore-<stamp>.json`
     (keep the newest 3 pre-restore files, delete older).
  2. For each selected store: `await fileStateStorage.setItem(name, envelopeFor(blob))` then
     `await ref.api.persist.rehydrate()` — zustand runs the store's own `migrate` when
     `blob.version < getOptions().version`, so old bundles upgrade through the normal path. A bundle
     with a **newer** version than the app knows is refused for that store with a clear message.
  3. Trip files: write each `trip-<id>.csv` (overwrite); summaries come with `bolid.trips`.
  4. Return `{ restored: string[]; skipped: { name; reason }[] }`; UI shows it; error log unaffected
     unless the user selected it.
     Debounced stores (`history`, `trips`, `scans`, `carBackups`, `dashboard-layout`) must not have a
     pending flush overwrite the restored file: call `clearStorage()`-free path — instead write the
     file directly (above) and rehydrate; because rehydrate replaces in-memory state, any later flush
     writes the restored state. Add `flushNow()` to `debouncedStorage` (exported) and call it for every
     store before step 1 so the pre-restore snapshot is complete.

### UI (`src/features/backup/ui/BackupScreen.tsx`, route `/backup`)

- **Back up now**: toggle "Include trip recordings (N files, ~X MB)"; button writes + shares; list
  of previous backups (name, date, size) with Share / Delete.
- **Restore from file**: pick → validation summary (app version in file, date, stores with item
  counts, warnings) → store checklist (all on; `bolid.errors` and `bolid.onboarding` off by default)
  → **Restore** with `Alert.alert` double confirm ("Current data is snapshotted first") → result
  sheet. Settings restore flips `adapterSource`/theme live (stores rehydrate).
- **Export one store**: list of the registry with JSON (and CSV when available) buttons.
- Entry points: Settings → new **Data** section ("Backup & restore", "Export data…") and More →
  Tools ("Backup & restore"). Plan 32 (feedback bundle) reuses `exportStore` and `createBackup`.

## Steps

1. `backup.ts` + `backup.test.ts`; `debouncedStorage.flushNow`.
2. `features/backup/{api/registry.ts, api/backupService.ts, model/backupStore.ts, hooks/useBackup.ts}`.
3. `npx expo install expo-document-picker`; `BackupScreen.tsx`; route + entries.
4. Docs; `npm run ci`.

## Simulator

Populate every store in the simulator (connect, faults, scan, trip, maintenance entry, AI run,
coding backup, dashboard reorder, dismiss a hint), back up, **Reset all app data** (plan 07) or
clear each store, restore → every screen shows the same data; a trip opens with its samples.

## Tests

- `backup.test.ts`: `parseEnvelope` handles missing `version` (→ 0) and garbage (→ null);
  `buildBackup` skips absent files and sums sizes; `redactBackup` removes `ai.apiKey` from a legacy
  settings blob and leaves other blobs byte-identical; `validateBackup` rejects `format: 2`,
  non-array stores, a store with a string version; unknown store names produce a warning;
  `envelopeFor(parse(envelopeFor(x)))` round-trips; `backupFileName` is sortable.
- `persistStorage.test.ts` (exists): `flushNow` writes the pending value immediately and cancels the
  timer.
- `backupService` logic that does not touch native modules → extract `planRestore(bundle, known,
currentVersions)` (pure: which stores restore, which are skipped for a newer version) and test it.

## Docs

- New `docs/features/backup.md` (format, registry, restore sequence, pre-restore snapshot, what is
  excluded and why: API key, adapter log, in-memory alert rules).
- `docs/features/settings.md` (Data section), `docs/features/more.md` (Tools entry),
  `docs/architecture.md` (backup as a composition slice; persisted-store registry is the one list
  to update when adding a store — add a line to the "Persistence" rule in `docs/plans/README.md`).
- `docs/privacy-policy.md` (plan 08): backups are user-initiated files; no key inside.

## Acceptance

- [ ] Backup file opens in a text editor and contains `format: 1`, the store list and (when
      enabled) `tripFiles`; `grep apiKey` on the file finds nothing but the redacted empty string
      or no key at all.
- [ ] Restore onto a cleared app reproduces history, scans, trips (openable), maintenance,
      dashboard layout and the selected vehicle; a `backups/pre-restore-*.json` exists afterwards.
- [ ] A bundle whose `bolid.history` has `version: 1` restores and shows migrated `vehicle` fields.
- [ ] A bundle with a store version newer than the app is skipped with a message, others restore.
- [ ] Per-store JSON export shares a file for every registry row; CSV for history/scans/maintenance.
- [ ] `npm run ci` green.

## Out of scope

Persisting `alertsStore` and `notificationsStore` (recommended small follow-up: `bolid.alerts`,
`bolid.notifications` with `persist`, then add them to the registry); cloud sync; encryption of
bundles (document that the file is plaintext and contains VINs).

## Deferred until an on-car session

None.
