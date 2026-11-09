/** The persisted-store registry (plan 18): **the one list to update when a store gains `persist`**.
 *  Every `bolid.*` store the app writes is listed here, in restore order (the garage and the
 *  selected car before the maintenance logbook, whose legacy adoption reads them); a backup holds
 *  exactly these, and `storeVersions.test.ts` fails when a `persist` store is missing.
 *
 *  `features/backup` is a composition slice like `engine-host`: it may import other features'
 *  stores. `bolid.backups` (the list of backup files) is deliberately absent — a backup never
 *  contains the list of backups — and so is `bolid.seedKeys` (security-access plugins, plan 23);
 *  both are named in `NOT_BACKED_UP`. See docs/features/backup.md. */
import type { PersistOptions } from 'zustand/middleware';
import { useSettingsStore } from '@/shared/state/settingsStore';
import { useGarageStore } from '@/shared/state/garageStore';
import { useVehicleStore } from '@/shared/state/vehicleStore';
import { useHistoryStore } from '@/shared/state/historyStore';
import { useLabelPackStore } from '@/shared/state/labelPackStore';
import { useErrorLogStore } from '@/shared/state/errorLogStore';
import { useMaintenanceStore } from '@/features/maintenance/model/maintenanceStore';
import { useTripStore } from '@/features/trip-recording/model/tripStore';
import { useScanHistoryStore } from '@/features/module-scan/model/scanHistoryStore';
import { useCarBackupStore } from '@/features/coding/model/carBackupStore';
import { useDashboardLayoutStore } from '@/features/live-data/model/dashboardLayoutStore';
import { useOnboardingStore } from '@/shared/state/onboardingStore';
import { useAlertsStore } from '@/features/alerts/model/alertsStore';
import { useNotificationsStore } from '@/features/notifications/model/notificationsStore';
import { useLoginBookStore } from '@/features/adaptations/model/loginBookStore';
import { countItems } from '@/shared/lib/backup';
import { historyCsv, maintenanceCsv, maintenanceEntryCount, scansCsv } from './storeCsv';

/** The slice of a zustand `persist` store the backup needs. */
interface PersistedBound<S, P> {
  getState: () => S;
  getInitialState: () => S;
  persist: {
    setOptions: (options: Partial<PersistOptions<S, P>>) => void;
    getOptions: () => Partial<PersistOptions<S, P>>;
    rehydrate: () => Promise<void> | void;
  };
}

export interface PersistedStoreRef {
  /** The persist key, e.g. `bolid.history` (also the file name, `bolid.history.json`). */
  name: string;
  /** Plain-English name for the backup screen. */
  label: string;
  /** Ticked in the restore checklist by default (the error log and dismissed hints are not). */
  restoreByDefault: boolean;
  /** The data version this build reads and writes. */
  version: () => number;
  /** The store declares a `migrate`, so an older blob upgrades on rehydrate (without one zustand
   *  discards it and the store would come back empty — `planRestore` skips such a blob). */
  migrates: () => boolean;
  /** The state as the store writes it right now (partialized; functions dropped by JSON). */
  snapshot: () => { state: unknown; version: number };
  /** Re-read the store's file into memory, **replacing** its persisted fields instead of merging
   *  them with what is in memory (the stores' own `merge` keeps items added during the start-up
   *  hydration window — right at launch, wrong for a restore). Runs the store's own `migrate`
   *  when the file is older, and its own `merge` against fresh defaults. Live, non-persisted state
   *  (a trip being recorded, active alerts, the API key in memory) is left alone. **Rejects** when
   *  the store's `migrate` or `merge` throws (the old state then stays in memory). */
  rehydrateFresh: () => Promise<void>;
  /** Items in a saved state, for the restore summary (null: a settings-like blob). */
  count: (state: unknown) => number | null;
  /** CSV export of a saved state, for the tabular stores. */
  csv?: (state: unknown) => string;
}

function ref<S, P>(
  name: string,
  label: string,
  store: PersistedBound<S, P>,
  extra: Partial<Pick<PersistedStoreRef, 'count' | 'csv' | 'restoreByDefault'>> = {},
): PersistedStoreRef {
  const version = () => store.persist.getOptions().version ?? 0;
  const persistedOf = (s: S): unknown => {
    const partialize = store.persist.getOptions().partialize;
    return partialize ? partialize(s) : s;
  };
  return {
    name,
    label,
    restoreByDefault: extra.restoreByDefault ?? true,
    version,
    migrates: () => typeof store.persist.getOptions().migrate === 'function',
    snapshot: () => ({
      state: JSON.parse(JSON.stringify(persistedOf(store.getState()) ?? null)),
      version: version(),
    }),
    rehydrateFresh: async () => {
      const { merge, onRehydrateStorage } = store.persist.getOptions();
      const initial = store.getInitialState() as S;
      const persistedKeys = Object.keys((persistedOf(initial) ?? {}) as object);
      // zustand's `hydrate()` swallows a throwing `migrate` or `merge` (it only hands the error to
      // `onRehydrateStorage`'s callback), so `rehydrate()` resolves with the old state still in
      // memory. Capture the error here and rethrow it, so the caller does not report it restored.
      let failure: unknown = undefined;
      let failed = false;
      store.persist.setOptions({
        merge: (persisted, current) => {
          const fresh = { ...current } as Record<string, unknown>;
          for (const k of persistedKeys) fresh[k] = (initial as Record<string, unknown>)[k];
          return merge
            ? merge(persisted, fresh as S)
            : ({ ...fresh, ...((persisted ?? {}) as object) } as S);
        },
        onRehydrateStorage: (state) => {
          const original = onRehydrateStorage?.(state);
          return (hydrated, error) => {
            if (error !== undefined) {
              failed = true;
              failure = error;
            }
            original?.(hydrated, error);
          };
        },
      });
      try {
        await store.persist.rehydrate();
      } finally {
        store.persist.setOptions({ merge, onRehydrateStorage });
      }
      if (failed) throw failure instanceof Error ? failure : new Error(String(failure));
    },
    count: extra.count ?? countItems,
    ...(extra.csv ? { csv: extra.csv } : {}),
  };
}

const none = () => null;

export const PERSISTED_STORES: PersistedStoreRef[] = [
  ref('bolid.settings', 'Settings', useSettingsStore, { count: none }),
  ref('bolid.garage', 'Garage (my cars)', useGarageStore),
  ref('bolid.vehicle', 'Selected vehicle', useVehicleStore, { count: none }),
  ref('bolid.loginBook', 'Module login codes (code book)', useLoginBookStore, {
    count: (state) => {
      const byVehicle = (state as { byVehicle?: Record<string, unknown[]> } | null)?.byVehicle;
      return byVehicle
        ? Object.values(byVehicle).reduce((n, l) => n + (Array.isArray(l) ? l.length : 0), 0)
        : 0;
    },
  }),
  ref('bolid.labelPacks', 'Imported label packs', useLabelPackStore),
  ref('bolid.history', 'History (diagnoses, fault-code checks, reports)', useHistoryStore, {
    csv: historyCsv,
  }),
  ref('bolid.maintenance', 'Maintenance log', useMaintenanceStore, {
    count: maintenanceEntryCount,
    csv: maintenanceCsv,
  }),
  ref('bolid.trips', 'Trips', useTripStore),
  ref('bolid.scans', 'Module scans', useScanHistoryStore, { csv: scansCsv }),
  ref('bolid.carBackups', 'Coding backups (full-car snapshots)', useCarBackupStore),
  ref('bolid.dashboard-layout', 'Dashboard layout', useDashboardLayoutStore),
  ref('bolid.alerts', 'Alert rules', useAlertsStore),
  ref('bolid.notifications', 'Notification settings and reminders', useNotificationsStore),
  ref('bolid.onboarding', 'Dismissed hints', useOnboardingStore, { restoreByDefault: false }),
  ref('bolid.errors', 'Error log', useErrorLogStore, { restoreByDefault: false }),
];

export const STORE_NAMES = PERSISTED_STORES.map((s) => s.name);

/** Persisted stores a backup deliberately leaves out: the list of backups itself, and the
 *  security-access plugin index (plan 23) — a plugin's program lives in its own file beside the
 *  index and belongs to the phone and car it was imported for; on a new phone the owner imports
 *  the file again. */
export const NOT_BACKED_UP = ['bolid.backups', 'bolid.seedKeys'] as const;

export function storeRef(name: string): PersistedStoreRef | undefined {
  return PERSISTED_STORES.find((s) => s.name === name);
}

/** Every store's current data version, for `planRestore`. */
export function currentVersions(): Record<string, number> {
  return Object.fromEntries(PERSISTED_STORES.map((s) => [s.name, s.version()]));
}

/** The stores that can upgrade an older blob (they declare a `migrate`), for `planRestore`. */
export function migratableStores(): Set<string> {
  return new Set(PERSISTED_STORES.filter((s) => s.migrates()).map((s) => s.name));
}
