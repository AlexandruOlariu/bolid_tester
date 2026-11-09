/** **Reset all app data** (plan 07, Settings → Developer & simulator): put the app back to the state
 *  of a fresh install. Every persisted `bolid.*` store goes back to its initial state and its file is
 *  removed — the stores a backup holds (`PERSISTED_STORES`) **and** the two it leaves out (the list
 *  of backups, the security-access plugin index). The AI keys leave the keystore, and the app's own
 *  files are deleted: the trip recordings (`trip-<id>.csv`), the backup files (`backups/`), the
 *  security-access plugin files (`seedkeys/`) and the staging copies every export writes to the
 *  document directory before the share sheet opens (car-coding snapshots, reports, CSVs, captures,
 *  fixtures, garage / profile exports — see `isExportFile`). A fresh install has none of them. The
 *  copies the share sheet handed to other apps live outside the sandbox and are not touched.
 *
 *  Lives in `features/backup` because this slice already composes every persisted store (like
 *  `engine-host`); `storeVersions.test.ts` scans the source for `persist(` stores and fails when one
 *  is missing here. The in-memory result stores (inspection, battery, AI diagnosis, module scan, DPF,
 *  adapter health, fault codes) and the adapter log are cleared too, so no screen shows the previous
 *  car's results. The caller tears the connection down first with
 *  `connectionService.resetForRestore()` (Settings does), which also invalidates a connect in flight. */
import { useSettingsStore, forgetAllApiKeys } from '@/shared/state/settingsStore';
import { useGarageStore } from '@/shared/state/garageStore';
import { useVehicleStore } from '@/shared/state/vehicleStore';
import { useHistoryStore } from '@/shared/state/historyStore';
import { useLabelPackStore } from '@/shared/state/labelPackStore';
import { useSeedKeyStore } from '@/shared/state/seedKeyStore';
import { useErrorLogStore, logError } from '@/shared/state/errorLogStore';
import { useDtcStore } from '@/shared/state/dtcStore';
import { clearAdapterLog } from '@/shared/state/adapterLog';
import { useMaintenanceStore } from '@/features/maintenance/model/maintenanceStore';
import { useTripStore } from '@/features/trip-recording/model/tripStore';
import { useScanHistoryStore } from '@/features/module-scan/model/scanHistoryStore';
import { useCarBackupStore } from '@/features/coding/model/carBackupStore';
import { useDashboardLayoutStore } from '@/features/live-data/model/dashboardLayoutStore';
import { useOnboardingStore } from '@/shared/state/onboardingStore';
import { useAlertsStore } from '@/features/alerts/model/alertsStore';
import { useNotificationsStore } from '@/features/notifications/model/notificationsStore';
import { useLoginBookStore } from '@/features/adaptations/model/loginBookStore';
import { useBackupStore } from '../model/backupStore';
import { useInspectionStore } from '@/features/inspection/model/inspectionStore';
import { useBatteryStore } from '@/features/battery-health/model/batteryStore';
import { useAiDiagnoseStore } from '@/features/ai-diagnose/model/aiDiagnoseStore';
import { useModuleScanStore } from '@/features/module-scan/model/moduleScanStore';
import { useDpfStore } from '@/features/dpf/model/dpfStore';
import { useAdapterHealthStore } from '@/features/adapter-health/model/adapterHealthStore';
import { translate } from '@/shared/i18n';

/** The slice of a zustand `persist` store a reset needs. */
interface ResettableStore {
  getInitialState: () => unknown;
  setState: (state: never, replace: true) => void;
  persist: {
    clearStorage: () => void | Promise<void>;
    getOptions: () => { name?: string };
  };
}

/** Every persisted store, in the order the reset clears them. */
const RESET_STORES: readonly ResettableStore[] = [
  useSettingsStore,
  useGarageStore,
  useVehicleStore,
  useLoginBookStore,
  useLabelPackStore,
  useHistoryStore,
  useMaintenanceStore,
  useTripStore,
  useScanHistoryStore,
  useCarBackupStore,
  useDashboardLayoutStore,
  useAlertsStore,
  useNotificationsStore,
  useOnboardingStore,
  useBackupStore,
  useSeedKeyStore,
  // Last, so a problem logged while clearing the others does not survive the reset.
  useErrorLogStore,
];

/** The slice of an in-memory (not persisted) zustand store a reset needs. */
interface MemoryStore {
  getInitialState: () => unknown;
  setState: (state: never, replace: true) => void;
}

/** The in-memory stores that hold a car's results (shown on their screens and read by the vehicle
 *  report). They forget on restart anyway; the reset clears them now so nothing from the previous
 *  car is left on screen. Write-flow state (coding, adaptations, routines) is left alone: it holds
 *  the unlock state and in-session before-write backups a write flow relies on, and a reconnect
 *  re-reads it per car anyway. */
const RESULT_STORES: readonly MemoryStore[] = [
  useInspectionStore,
  useBatteryStore,
  useAiDiagnoseStore,
  useModuleScanStore,
  useDpfStore,
  useAdapterHealthStore,
];

/** The persist keys a reset clears (e.g. `bolid.garage`). */
export function resetStoreNames(): string[] {
  return RESET_STORES.map((s) => s.persist.getOptions().name ?? '');
}

/** The slice of `expo-file-system/legacy` a reset needs. Without `readDirectoryAsync` only the
 *  known files (`seedkeys/`, `backups/`, the trip CSVs) are deleted. */
export interface ResetFileSystem {
  documentDirectory?: string | null;
  deleteAsync: (uri: string, options?: { idempotent?: boolean }) => Promise<void>;
  readDirectoryAsync?: (uri: string) => Promise<string[]>;
}

/** The extensions of the files the app's exports write to the document directory: car-coding
 *  snapshots, garage / profile / label-pack exports and replay fixtures (`.json`), trip, chart,
 *  measuring-log and sniffer CSVs (`.csv`), adapter-health, auto-scan and raw sniffer text
 *  (`.txt`), fault-code and error-log reports (`.md` / `.json`), vehicle reports (`.html` /
 *  `.pdf`). */
const EXPORT_EXTENSIONS = /\.(json|csv|txt|md|html|pdf)$/i;

/** A top-level document-directory entry the reset deletes as an export's staging copy: a file with
 *  an export extension that is neither hidden (`.expo-internal` and other library state) nor one
 *  of the persisted stores' own files (`persistFiles`, which `clearStorage` removes — the error log
 *  among them keeps the problems this reset logs). Pure. */
export function isExportFile(name: string, persistFiles: ReadonlySet<string>): boolean {
  return !name.startsWith('.') && EXPORT_EXTENSIONS.test(name) && !persistFiles.has(name);
}

/** `bolid.garage` → `bolid.garage.json`, as `persistStorage.ts` names a store's file. */
function persistFileName(storeName: string): string {
  return `${storeName.replace(/[^a-zA-Z0-9._-]/g, '_')}.json`;
}

/** Load the file system, or null where it is missing (tests, web). Variable specifier, as in
 *  `features/error-log/hooks/useErrorLogExport.ts`. */
export async function loadResetFileSystem(): Promise<ResetFileSystem | null> {
  try {
    return (await import('expo-file-system/legacy' as string)) as ResetFileSystem;
  } catch {
    return null;
  }
}

export interface ResetOutcome {
  /** The persist keys that were cleared. */
  stores: string[];
  /** App files (relative to the document directory) that were deleted. */
  files: string[];
  /** Plain-English problems; each is also in the (fresh) error log. */
  problems: string[];
}

/** Reset every persisted store, the AI keys and the app's own data files. Never throws: a file that
 *  cannot be deleted is reported in `problems` and logged (source `settings/reset`). */
export async function resetAllAppData(
  opts: { fileSystem?: ResetFileSystem | null } = {},
): Promise<ResetOutcome> {
  // The trip recordings' files are named after the trips, which the reset is about to forget.
  const tripFiles = useTripStore.getState().trips.map((t) => `trip-${t.header.id}.csv`);
  const problems: string[] = [];

  const stores: string[] = [];
  for (const store of RESET_STORES) {
    store.setState(store.getInitialState() as never, true);
    // Removes the file (and cancels a pending debounced write). The reset above may have started a
    // write of the initial state; whichever lands last, the file holds nothing but the defaults.
    await store.persist.clearStorage();
    stores.push(store.persist.getOptions().name ?? '');
  }
  for (const store of RESULT_STORES) store.setState(store.getInitialState() as never, true);
  useDtcStore.getState().clearResults();
  clearAdapterLog();
  await forgetAllApiKeys();

  const files: string[] = [];
  const fs = opts.fileSystem === undefined ? await loadResetFileSystem() : opts.fileSystem;
  const dir = fs?.documentDirectory ?? '';
  if (fs && dir) {
    const names = ['seedkeys/', 'backups/', ...tripFiles];
    if (fs.readDirectoryAsync) {
      const persistFiles = new Set(stores.map(persistFileName));
      try {
        for (const entry of await fs.readDirectoryAsync(dir)) {
          if (isExportFile(entry, persistFiles) && !names.includes(entry)) names.push(entry);
        }
      } catch (e) {
        problems.push(translate('backup:reset.listFailed'));
        logError({
          source: 'settings/reset',
          error: e,
          severity: 'warning',
          context: { op: 'list' },
        });
      }
    }
    for (const name of names) {
      try {
        await fs.deleteAsync(`${dir}${name}`, { idempotent: true });
        files.push(name);
      } catch (e) {
        problems.push(translate('backup:reset.deleteFailed', { name }));
        logError({ source: 'settings/reset', error: e, severity: 'warning', context: { name } });
      }
    }
  }
  return { stores, files, problems };
}
