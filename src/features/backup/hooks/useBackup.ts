/** Screen-side wrapper over `api/backupService.ts` (plan 18): loads the native modules once per
 *  action, tracks which action is running, estimates the backup size, and tears the connection
 *  down before a restore (`connectionService.resetForRestore`): a restored adapter source or
 *  simulated car must not leave the old session — or a connect still in flight, or an adapter log
 *  from the old source — behind. */
import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import type { BackupBundle, BackupValidation } from '@/shared/lib/backup';
import { isWebRuntime } from '@/shared/lib/webRuntime';
import { NOT_ON_WEB_YET, showToast } from '@/shared/state/toastStore';
import { connectionService } from '@/features/connection';
import { useTripStore } from '@/features/trip-recording/model/tripStore';
import { useBackupStore, type BackupRecord } from '../model/backupStore';
import {
  createBackup,
  deleteBackupFile,
  exportStore,
  loadBackupModules,
  pickBackupFile,
  readListedBackup,
  restoreBackup,
  shareBackupFile,
  storesEstimateBytes,
  tripFilesSummary,
  type BackupModules,
  type CreatedBackup,
  type ExportFormat,
  type PickResult,
  type RestoreResult,
} from '../api/backupService';

export type BackupAction = 'backup' | 'pick' | 'restore' | 'export' | 'file';

export function useBackup() {
  const records = useBackupStore((s) => s.records);
  const tripCount = useTripStore((s) => s.trips.length);
  const [busy, setBusy] = useState<BackupAction | null>(null);
  const [trips, setTrips] = useState<{ count: number; bytes: number }>({ count: 0, bytes: 0 });
  /** The store part of the bundle, as it would be written (the screen adds the trip CSVs). */
  const [storesBytes, setStoresBytes] = useState(0);

  // Re-estimated when a trip lands and after every backup / restore (the list changes then).
  useEffect(() => {
    let live = true;
    void (async () => {
      const mods = await loadBackupModules();
      const summary = mods ? await tripFilesSummary(mods) : { count: 0, bytes: 0 };
      const stores = mods ? await storesEstimateBytes() : 0;
      if (live) {
        setTrips(summary);
        setStoresBytes(stores);
      }
    })();
    return () => {
      live = false;
    };
  }, [tripCount, records]);

  const run = useCallback(
    async <T>(
      action: BackupAction,
      fallback: T,
      fn: (m: BackupModules) => Promise<T>,
    ): Promise<T> => {
      // Web (plan 28): backups are files on the phone; the browser has none to write or pick yet.
      if (isWebRuntime()) {
        showToast(NOT_ON_WEB_YET);
        return fallback;
      }
      setBusy(action);
      try {
        const mods = await loadBackupModules();
        return mods ? await fn(mods) : fallback;
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const backUpNow = useCallback(
    (includeTrips: boolean): Promise<CreatedBackup | null> =>
      run('backup', null, (m) =>
        createBackup(m, { includeTrips, share: true, platform: Platform.OS }),
      ),
    [run],
  );

  const pick = useCallback(
    (): Promise<PickResult> =>
      run<PickResult>('pick', { status: 'unavailable' }, (m) => pickBackupFile(m)),
    [run],
  );

  const open = useCallback(
    (record: BackupRecord): Promise<BackupValidation> =>
      run<BackupValidation>('file', { ok: false, reason: 'This device has no app storage.' }, (m) =>
        readListedBackup(m, record),
      ),
    [run],
  );

  const restore = useCallback(
    (bundle: BackupBundle, stores: string[], includeTrips: boolean): Promise<RestoreResult> =>
      run<RestoreResult>(
        'restore',
        { ok: false, reason: 'This device has no app storage to restore into.' },
        async (m) => {
          await connectionService.resetForRestore();
          return restoreBackup(m, bundle, { stores, includeTrips, platform: Platform.OS });
        },
      ),
    [run],
  );

  const exportOne = useCallback(
    (name: string, format: ExportFormat): Promise<string | null> =>
      run('export', null, (m) => exportStore(m, name, format)),
    [run],
  );

  const share = useCallback(
    (record: BackupRecord): Promise<boolean> =>
      run('file', false, (m) => shareBackupFile(m, record)),
    [run],
  );

  const remove = useCallback(
    (record: BackupRecord): Promise<void> =>
      run('file', undefined, (m) => deleteBackupFile(m, record)),
    [run],
  );

  return {
    records,
    trips,
    storesBytes,
    busy,
    backUpNow,
    pick,
    open,
    restore,
    exportOne,
    share,
    remove,
  };
}
