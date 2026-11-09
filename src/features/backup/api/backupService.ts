/** Backup, restore and per-store export (plan 18). The native modules (expo-file-system legacy,
 *  expo-sharing, expo-document-picker) are loaded by `loadBackupModules` with variable specifiers
 *  and handed to every function, so the whole flow is unit-tested with in-memory fakes in the core
 *  project (the same pattern as report/api/reportExport.ts). Store files are read and written
 *  through `fileStateStorage`, the storage every persisted store uses.
 *
 *  Restore sequence: validate → redact → plan (newer data versions are skipped, and so are older
 *  ones of a store without a `migrate`) → snapshot the current data to
 *  `backups/pre-restore-<stamp>.json` (only the newest 3 are kept) → for each store: flush pending
 *  debounced writes, write its file and read it back, rehydrate it (its own `migrate` upgrades an
 *  older version; a rejected blob puts the previous file back and the store is skipped) → write
 *  the trip CSVs of the trips now listed, and delete the CSVs of trips the restored list dropped.
 *  See docs/features/backup.md. */
import { logError } from '@/shared/state/errorLogStore';
import { fileStateStorage, flushPendingWrites } from '@/shared/state/persistStorage';
import { APP_VERSION } from '@/shared/lib/appInfo';
import {
  backupFileName,
  backupStamp,
  buildBackup,
  envelopeFor,
  estimateBundleBytes,
  parseBackup,
  parseEnvelope,
  planRestore,
  preRestoreFileName,
  preRestoreFilesToDelete,
  redactBackup,
  redactState,
  serializeBackup,
  uniqueFileName,
  utf8Bytes,
  type BackupBundle,
  type BackupTripFile,
  type BackupValidation,
  type RawStoreFile,
} from '@/shared/lib/backup';
import { useTripStore } from '@/features/trip-recording/model/tripStore';
import { useBackupStore, type BackupRecord } from '../model/backupStore';
import {
  PERSISTED_STORES,
  STORE_NAMES,
  currentVersions,
  migratableStores,
  storeRef,
} from './registry';
import { translate } from '@/shared/i18n';

/** The legacy file-system entry point (the root `expo-file-system` has no `documentDirectory` on
 *  this SDK — see can-sniffer/api/captureExport.ts). */
export interface BackupFileSystem {
  documentDirectory?: string | null;
  getInfoAsync: (uri: string) => Promise<{ exists: boolean; size?: number }>;
  readAsStringAsync: (uri: string) => Promise<string>;
  writeAsStringAsync: (uri: string, contents: string) => Promise<void>;
  deleteAsync: (uri: string, opts?: { idempotent?: boolean }) => Promise<void>;
  makeDirectoryAsync: (uri: string, opts?: { intermediates?: boolean }) => Promise<void>;
  readDirectoryAsync: (uri: string) => Promise<string[]>;
}
export interface BackupSharing {
  isAvailableAsync: () => Promise<boolean>;
  shareAsync: (uri: string, opts?: { mimeType?: string; dialogTitle?: string }) => Promise<void>;
}
export interface BackupPicker {
  getDocumentAsync: (opts: {
    type?: string | string[];
    copyToCacheDirectory?: boolean;
    multiple?: boolean;
  }) => Promise<{ canceled: boolean; assets?: { uri: string; name?: string }[] | null }>;
}
export interface BackupModules {
  FileSystem: BackupFileSystem;
  /** null when sharing is not in this build: the file is still written. */
  Sharing: BackupSharing | null;
  /** null when expo-document-picker is not in this build: restore from a picked file is off. */
  Picker: BackupPicker | null;
}

/** Where backups are written, under the document directory. */
export const BACKUP_DIR = 'backups/';
/** Pre-restore snapshots kept (older ones are deleted). */
export const KEEP_PRE_RESTORE = 3;

/** Picked files Android may label as something other than JSON (a chat app, a USB copy). The
 *  content is validated anyway. */
const PICK_TYPES = ['application/json', 'text/plain', 'application/octet-stream'];

/** Same name as the trip recorder's (`trip-recording/hooks/useTripRecorder.ts`); kept here so the
 *  backup does not pull in the recorder's session and notification imports. */
export function tripCsvName(id: string): string {
  return `trip-${id}.csv`;
}

/** Load expo-file-system (legacy), expo-sharing and expo-document-picker. Null when the file
 *  system itself is missing (web without storage); sharing and the picker are optional. */
export async function loadBackupModules(): Promise<BackupModules | null> {
  let FileSystem: BackupFileSystem;
  try {
    FileSystem = (await import('expo-file-system/legacy' as string)) as BackupFileSystem;
  } catch (e) {
    logError({ source: 'backup/modules', error: e, severity: 'warning' });
    return null;
  }
  let Sharing: BackupSharing | null = null;
  try {
    const mod = (await import('expo-sharing' as string)) as Partial<BackupSharing>;
    if (typeof mod.shareAsync === 'function') Sharing = mod as BackupSharing;
  } catch {
    Sharing = null;
  }
  let Picker: BackupPicker | null = null;
  try {
    const mod = (await import('expo-document-picker' as string)) as Partial<BackupPicker>;
    if (typeof mod.getDocumentAsync === 'function') Picker = mod as BackupPicker;
  } catch {
    Picker = null; // not in this build (needs a native rebuild): backups still write and share
  }
  return { FileSystem, Sharing, Picker };
}

function docDir(mods: BackupModules): string {
  return mods.FileSystem.documentDirectory ?? '';
}

/** The URI of a file in the backup folder, derived from its name **now** (the list stores names
 *  only: on iOS `documentDirectory` changes across app updates). */
export function backupFileUri(mods: BackupModules, fileName: string): string {
  return `${docDir(mods)}${BACKUP_DIR}${fileName}`;
}

/** Open the share sheet for `uri`. A missing or failing share sheet is not an error for the
 *  caller — the file is already written (warning logged). */
async function share(mods: BackupModules, uri: string, mimeType: string, title: string) {
  try {
    if (mods.Sharing && (await mods.Sharing.isAvailableAsync())) {
      await mods.Sharing.shareAsync(uri, { mimeType, dialogTitle: title });
      return true;
    }
  } catch (e) {
    logError({ source: 'backup/share', error: e, severity: 'warning', context: { uri } });
  }
  return false;
}

/** Every registered store's file, after flushing pending debounced writes. */
export async function readStoreFiles(): Promise<RawStoreFile[]> {
  await flushPendingWrites();
  return Promise.all(
    PERSISTED_STORES.map(async (s) => ({
      name: s.name,
      raw: await fileStateStorage.getItem(s.name),
    })),
  );
}

/** The CSV of every trip in the trips list that has one on disk. */
export async function readTripFiles(mods: BackupModules): Promise<BackupTripFile[]> {
  const dir = docDir(mods);
  if (!dir) return [];
  const out: BackupTripFile[] = [];
  for (const t of useTripStore.getState().trips) {
    const id = t.header.id;
    const uri = `${dir}${tripCsvName(id)}`;
    try {
      if (!(await mods.FileSystem.getInfoAsync(uri)).exists) continue;
      out.push({ id, csv: await mods.FileSystem.readAsStringAsync(uri) });
    } catch (e) {
      logError({ source: 'backup/trips', error: e, severity: 'warning', context: { tripId: id } });
    }
  }
  return out;
}

/** Roughly how large the store part of a backup is right now: the bundle without trip files,
 *  serialized as it would be written (`estimateBundleBytes`). The screen adds the trip CSVs. */
export async function storesEstimateBytes(): Promise<number> {
  try {
    const bundle = buildBackup(await readStoreFiles(), [], { version: APP_VERSION, platform: '' });
    return estimateBundleBytes(bundle);
  } catch {
    return 0; // unreadable: no estimate (the backup itself logs it)
  }
}

/** How many trip recordings a backup would include and roughly how large they are. */
export async function tripFilesSummary(
  mods: BackupModules,
): Promise<{ count: number; bytes: number }> {
  const dir = docDir(mods);
  if (!dir) return { count: 0, bytes: 0 };
  let count = 0;
  let bytes = 0;
  for (const t of useTripStore.getState().trips) {
    try {
      const info = await mods.FileSystem.getInfoAsync(`${dir}${tripCsvName(t.header.id)}`);
      if (!info.exists) continue;
      count++;
      bytes += typeof info.size === 'number' ? info.size : 0;
    } catch {
      // unreadable: not counted (the backup itself logs it)
    }
  }
  return { count, bytes };
}

async function listDir(mods: BackupModules, folder: string): Promise<string[]> {
  try {
    return await mods.FileSystem.readDirectoryAsync(folder);
  } catch {
    return [];
  }
}

export interface CreateBackupOptions {
  includeTrips: boolean;
  /** Open the share sheet once written (the user's "Back up now"). */
  share?: boolean;
  kind?: BackupRecord['kind'];
  platform?: string;
  now?: number;
}

export interface CreatedBackup {
  record: BackupRecord;
  bundle: BackupBundle;
  shared: boolean;
}

/** Build the bundle from the store files (+ trip CSVs), redact it, write it to
 *  `backups/<bolid-backup-…|pre-restore-…>.json`, record it in the backup list and (optionally)
 *  share it. Null on failure (logged as `backup/create`). */
export async function createBackup(
  mods: BackupModules,
  opts: CreateBackupOptions,
): Promise<CreatedBackup | null> {
  const now = opts.now ?? Date.now();
  const kind = opts.kind ?? 'backup';
  try {
    const dir = docDir(mods);
    if (!dir) return null;
    const files = await readStoreFiles();
    const trips = opts.includeTrips ? await readTripFiles(mods) : [];
    const bundle = redactBackup(
      buildBackup(
        files,
        trips,
        { version: APP_VERSION, platform: opts.platform ?? 'unknown' },
        now,
      ),
    );
    const text = serializeBackup(bundle);
    const folder = `${dir}${BACKUP_DIR}`;
    await mods.FileSystem.makeDirectoryAsync(folder, { intermediates: true });
    const base = kind === 'pre-restore' ? preRestoreFileName(now) : backupFileName(now);
    const fileName = uniqueFileName(base, await listDir(mods, folder));
    const uri = `${folder}${fileName}`;
    await mods.FileSystem.writeAsStringAsync(uri, text);
    const record: BackupRecord = {
      fileName,
      createdAt: now,
      bytes: utf8Bytes(text),
      kind,
      includesTrips: opts.includeTrips,
    };
    const before = useBackupStore.getState().records;
    useBackupStore.getState().record(record);
    await deleteDroppedFiles(mods, before);
    const shared = opts.share
      ? await share(mods, uri, 'application/json', translate('backup:shareSave'))
      : false;
    return { record, bundle, shared };
  } catch (e) {
    logError({ source: 'backup/create', error: e, context: { kind } });
    return null;
  }
}

/** The list keeps the newest `MAX_BACKUP_RECORDS`; delete the file of every entry that just
 *  dropped off it, so old backups (several MB each with trips) cannot pile up out of sight. */
async function deleteDroppedFiles(mods: BackupModules, before: BackupRecord[]): Promise<void> {
  const kept = new Set(useBackupStore.getState().records.map((r) => r.fileName));
  for (const r of before) {
    if (kept.has(r.fileName)) continue;
    try {
      await mods.FileSystem.deleteAsync(backupFileUri(mods, r.fileName), { idempotent: true });
    } catch (e) {
      logError({
        source: 'backup/prune',
        error: e,
        severity: 'warning',
        context: { name: r.fileName },
      });
    }
  }
}

/** Delete all but the newest `KEEP_PRE_RESTORE` pre-restore snapshots (files and list entries). */
export async function prunePreRestore(mods: BackupModules): Promise<string[]> {
  const folder = `${docDir(mods)}${BACKUP_DIR}`;
  const doomed = preRestoreFilesToDelete(await listDir(mods, folder), KEEP_PRE_RESTORE);
  for (const name of doomed) {
    try {
      await mods.FileSystem.deleteAsync(`${folder}${name}`, { idempotent: true });
      useBackupStore.getState().remove(name);
    } catch (e) {
      logError({ source: 'backup/prune', error: e, severity: 'warning', context: { name } });
    }
  }
  return doomed;
}

export type ExportFormat = 'json' | 'csv';

/** Write one store as `bolid-<store>-<yyyymmdd-hhmm>.<json|csv>` in the document directory and
 *  share it. JSON = `{ name, version, exportedAt, state }` (secrets blanked); CSV only for the
 *  stores whose registry row has a `csv`. Returns the file URI, or null (unknown store, no CSV
 *  for it, no file system, or a failure — logged as `backup/export`). */
export async function exportStore(
  mods: BackupModules,
  name: string,
  format: ExportFormat,
  now: number = Date.now(),
): Promise<string | null> {
  const ref = storeRef(name);
  if (!ref || (format === 'csv' && !ref.csv)) return null;
  try {
    const dir = docDir(mods);
    if (!dir) return null;
    await flushPendingWrites();
    const raw = await fileStateStorage.getItem(name);
    const data = (raw ? parseEnvelope(raw) : null) ?? ref.snapshot();
    const state = redactState(data.state);
    const body =
      format === 'csv' && ref.csv
        ? ref.csv(state)
        : JSON.stringify(
            { name, version: data.version, exportedAt: new Date(now).toISOString(), state },
            null,
            2,
          );
    const short = name.replace(/^bolid\./, '');
    const uri = `${dir}bolid-${short}-${backupStamp(now)}.${format}`;
    await mods.FileSystem.writeAsStringAsync(uri, body);
    await share(
      mods,
      uri,
      format === 'csv' ? 'text/csv' : 'application/json',
      translate('backup:shareExport', {
        name: translate(`backup:store.${ref.name.replace(/^bolid\./, '')}`, {
          defaultValue: ref.label,
        }).toLowerCase(),
      }),
    );
    return uri;
  } catch (e) {
    logError({ source: 'backup/export', error: e, context: { store: name, format } });
    return null;
  }
}

/** Read and validate a backup file. */
export async function readBackupFile(mods: BackupModules, uri: string): Promise<BackupValidation> {
  try {
    return parseBackup(await mods.FileSystem.readAsStringAsync(uri), STORE_NAMES);
  } catch (e) {
    logError({ source: 'backup/read', error: e, severity: 'warning' });
    return { ok: false, reason: translate('backup:err.read') };
  }
}

export type PickResult =
  | { status: 'cancelled' }
  | { status: 'unavailable' }
  | { status: 'picked'; name: string; validation: BackupValidation };

/** Let the user pick a backup file (system document picker) and validate it. */
export async function pickBackupFile(mods: BackupModules): Promise<PickResult> {
  if (!mods.Picker) return { status: 'unavailable' };
  try {
    const res = await mods.Picker.getDocumentAsync({
      type: PICK_TYPES,
      copyToCacheDirectory: true,
      multiple: false,
    });
    const asset = res.assets?.[0];
    if (res.canceled || !asset) return { status: 'cancelled' };
    const name = asset.name ?? asset.uri.slice(asset.uri.lastIndexOf('/') + 1);
    return { status: 'picked', name, validation: await readBackupFile(mods, asset.uri) };
  } catch (e) {
    logError({ source: 'backup/pick', error: e, severity: 'warning' });
    return {
      status: 'picked',
      name: '',
      validation: { ok: false, reason: translate('backup:err.open') },
    };
  }
}

export interface RestoreOptions {
  /** Store names to restore (anything else in the bundle is left alone). */
  stores: string[];
  includeTrips: boolean;
  platform?: string;
  now?: number;
}

export type RestoreResult =
  | {
      ok: true;
      restored: string[];
      skipped: { name: string; reason: string }[];
      tripFilesWritten: number;
      /** The snapshot of the data as it was before the restore (undo = restore this file). */
      snapshot: BackupRecord;
    }
  | { ok: false; reason: string };

/** Restore the selected stores (and trip files) from `bundle`. The current data is snapshotted
 *  first; if that snapshot cannot be written nothing is restored. */
export async function restoreBackup(
  mods: BackupModules,
  bundle: BackupBundle,
  opts: RestoreOptions,
): Promise<RestoreResult> {
  const dir = docDir(mods);
  if (!dir) return { ok: false, reason: translate('backup:err.noStorage') };
  const clean = redactBackup(bundle);
  // Registry order (garage + selected car before maintenance), then anything unknown (skipped).
  const ordered = [
    ...STORE_NAMES.filter((n) => opts.stores.includes(n)),
    ...opts.stores.filter((n) => !STORE_NAMES.includes(n)),
  ];
  const plan = planRestore(clean, ordered, currentVersions(), migratableStores());

  const snap = await createBackup(mods, {
    includeTrips: true,
    kind: 'pre-restore',
    platform: opts.platform,
    now: opts.now,
  });
  if (!snap) {
    return {
      ok: false,
      reason: translate('backup:err.snapshot'),
    };
  }
  await prunePreRestore(mods);

  const tripIdsBefore = new Set(useTripStore.getState().trips.map((t) => t.header.id));
  const restored: string[] = [];
  const skipped = [...plan.skipped];
  for (const blob of plan.restore) {
    const ref = storeRef(blob.name);
    if (!ref) continue;
    let previous: string | null = null;
    let written = false;
    try {
      // A debounced write still pending from before would land after ours and undo it.
      await flushPendingWrites();
      previous = await fileStateStorage.getItem(blob.name);
      const envelope = envelopeFor(blob);
      await fileStateStorage.setItem(blob.name, envelope);
      written = true;
      // `setItem` is best-effort (it logs a `persist` warning and resolves), so read the file back:
      // a store whose file did not change must not be reported as restored.
      if ((await fileStateStorage.getItem(blob.name)) !== envelope) {
        throw new Error(`The file of ${blob.name} could not be written.`);
      }
      // Rejects when the store's `migrate` or `merge` throws on the blob (a hand-edited backup);
      // the old data is then still in memory.
      await ref.rehydrateFresh();
      restored.push(blob.name);
    } catch (e) {
      logError({ source: 'backup/restore', error: e, context: { store: blob.name } });
      skipped.push({ name: blob.name, reason: translate('backup:err.skipped') });
      // Put the store's previous file back, so the next launch does not load the blob the store
      // just rejected (it would hydrate empty, and the next write would lose the old data).
      if (written) await putBackStoreFile(blob.name, previous);
    }
  }

  let tripFilesWritten = 0;
  const tripIdsAfter = new Set(useTripStore.getState().trips.map((t) => t.header.id));
  if (opts.includeTrips) {
    for (const t of clean.tripFiles ?? []) {
      // Only recordings of a trip in the (restored) trips list: a CSV nothing lists could never be
      // opened or deleted again ("Trip recordings" ticked with "Trips" unticked).
      if (!tripIdsAfter.has(t.id)) continue;
      try {
        await mods.FileSystem.writeAsStringAsync(`${dir}${tripCsvName(t.id)}`, t.csv);
        tripFilesWritten++;
      } catch (e) {
        logError({
          source: 'backup/restore',
          error: e,
          severity: 'warning',
          context: { tripId: t.id },
        });
      }
    }
  }
  // Restoring the trips list drops the trips that are not in the backup; delete their CSVs too
  // (nothing lists them any more). The pre-restore snapshot holds them, so undo brings them back.
  if (restored.includes('bolid.trips')) {
    for (const id of tripIdsBefore) {
      if (tripIdsAfter.has(id)) continue;
      try {
        await mods.FileSystem.deleteAsync(`${dir}${tripCsvName(id)}`, { idempotent: true });
      } catch (e) {
        logError({
          source: 'backup/restore',
          error: e,
          severity: 'warning',
          context: { tripId: id, phase: 'csv-delete' },
        });
      }
    }
  }
  return { ok: true, restored, skipped, tripFilesWritten, snapshot: snap.record };
}

/** Write a store's file back to what it held before a failed restore (or remove it when there
 *  was none). Best-effort: a failure is logged, and the store's next write replaces the file. */
async function putBackStoreFile(name: string, previous: string | null): Promise<void> {
  try {
    if (previous === null) await fileStateStorage.removeItem(name);
    else await fileStateStorage.setItem(name, previous);
  } catch (e) {
    logError({ source: 'backup/restore', error: e, severity: 'warning', context: { store: name } });
  }
}

/** Read and validate a file from the backup list. */
export function readListedBackup(
  mods: BackupModules,
  record: BackupRecord,
): Promise<BackupValidation> {
  return readBackupFile(mods, backupFileUri(mods, record.fileName));
}

/** Share a file from the backup list. False when it is gone or sharing is unavailable. */
export async function shareBackupFile(mods: BackupModules, record: BackupRecord): Promise<boolean> {
  const uri = backupFileUri(mods, record.fileName);
  try {
    if (!(await mods.FileSystem.getInfoAsync(uri)).exists) return false;
  } catch {
    return false;
  }
  return share(mods, uri, 'application/json', translate('backup:shareSave'));
}

/** Delete a file from the backup list (the file and its entry). */
export async function deleteBackupFile(mods: BackupModules, record: BackupRecord): Promise<void> {
  try {
    await mods.FileSystem.deleteAsync(backupFileUri(mods, record.fileName), { idempotent: true });
  } catch (e) {
    logError({ source: 'backup/delete', error: e, severity: 'warning' });
  }
  useBackupStore.getState().remove(record.fileName);
}
