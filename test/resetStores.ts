/** Between-test reset for the `ui` Jest project (run from jest.setup.ui.ts `beforeEach`): every
 *  zustand store a tab screen reads goes back to the state it had when its module first loaded, and
 *  the in-memory filesystem behind `fileStateStorage` is emptied — so no test sees another's
 *  settings, session, codes or dismissed hints. Add a store here when a new screen test reads it.
 *
 *  Restoring a persisted store makes zustand-persist write it again, and stores on
 *  `debouncedStorage` (history, dashboard layout) only *schedule* that write. `persist.clearStorage()`
 *  goes through the storage's `removeItem`, which cancels the pending flush, so no write lands in
 *  the emptied filesystem during the next test and no timer outlives the file
 *  (`cancelPendingWrites`, also run from `afterAll`). */
import type { StoreApi, UseBoundStore } from 'zustand';
import { useSettingsStore } from '@/shared/state/settingsStore';
import { useSessionStore } from '@/shared/state/sessionStore';
import { useDtcStore } from '@/shared/state/dtcStore';
import { useHistoryStore } from '@/shared/state/historyStore';
import { useGarageStore } from '@/shared/state/garageStore';
import { useLabelPackStore } from '@/shared/state/labelPackStore';
import { useSeedKeyStore } from '@/shared/state/seedKeyStore';
import { useChartsStore } from '@/shared/state/chartsStore';
import { useErrorLogStore } from '@/shared/state/errorLogStore';
import { clearAdapterLog } from '@/shared/state/adapterLog';
import { useVehicleStore } from '@/features/vehicle-select/model/vehicleStore';
import { useLiveDataStore } from '@/shared/state/liveDataStore';
import { useDashboardLayoutStore } from '@/features/live-data/model/dashboardLayoutStore';
import { useOnboardingStore } from '@/shared/state/onboardingStore';
import { useCoachStore } from '@/features/fault-codes/model/coachStore';
import { useLinkStore } from '@/shared/state/linkStore';
import { useScanStore } from '@/features/connection/model/scanStore';
import { useMaintenanceStore } from '@/features/maintenance/model/maintenanceStore';
import { useTripStore } from '@/features/trip-recording/model/tripStore';
import { useAiDiagnoseStore } from '@/features/ai-diagnose/model/aiDiagnoseStore';
import { useCarBackupStore } from '@/features/coding/model/carBackupStore';
import { useCodingStore } from '@/features/coding/model/codingStore';
import { useBackupWorkStore } from '@/features/coding/model/backupWorkStore';
import { useAdaptationsStore } from '@/features/adaptations/model/adaptationsStore';
import { useLoginBookStore } from '@/features/adaptations/model/loginBookStore';
import { useScanHistoryStore } from '@/features/module-scan/model/scanHistoryStore';
import { useModuleScanStore } from '@/features/module-scan/model/moduleScanStore';
import { useDpfStore } from '@/features/dpf/model/dpfStore';
import { useInspectionStore } from '@/features/inspection/model/inspectionStore';
import { useBatteryStore } from '@/features/battery-health/model/batteryStore';
import { useAlertsStore } from '@/features/alerts/model/alertsStore';
import { useNotificationsStore } from '@/features/notifications/model/notificationsStore';
import { useBackupStore } from '@/features/backup/model/backupStore';
import { useAdapterHealthStore } from '@/features/adapter-health/model/adapterHealthStore';
import { memoryFiles } from './mocks/fileSystem';
import { setMockFocused, setMockSearchParams } from './mocks/router';
import { resetMockWindow } from './mocks/window';
import { resetCrashReporting } from '@/shared/telemetry/crashReporting';

type AnyStore = UseBoundStore<StoreApi<any>> & {
  persist?: { clearStorage: () => void };
};

const STORES: AnyStore[] = [
  useSettingsStore,
  useSessionStore,
  useDtcStore,
  useHistoryStore,
  useErrorLogStore,
  useVehicleStore,
  useGarageStore,
  useLabelPackStore,
  useSeedKeyStore,
  useMaintenanceStore,
  useTripStore,
  useLiveDataStore,
  useDashboardLayoutStore,
  useOnboardingStore,
  useCoachStore,
  useLinkStore,
  useScanStore,
  useChartsStore,
  useAiDiagnoseStore,
  useCarBackupStore,
  useCodingStore,
  useBackupWorkStore,
  useAdaptationsStore,
  useLoginBookStore,
  useScanHistoryStore,
  useModuleScanStore,
  useDpfStore,
  useInspectionStore,
  useBatteryStore,
  useAlertsStore,
  useNotificationsStore,
  useBackupStore,
  useAdapterHealthStore,
];

/** Each store's state (actions included) captured at module load, before any test touched it. */
const INITIAL = STORES.map((store) => ({ store, state: store.getState() }));

/** Drop every persisted store's file and cancel its pending debounced write (if any). */
export function cancelPendingWrites(): void {
  for (const store of STORES) store.persist?.clearStorage();
  memoryFiles.clear();
}

export function resetStores(): void {
  for (const { store, state } of INITIAL) store.setState(state, true);
  clearAdapterLog();
  cancelPendingWrites();
  setMockSearchParams({});
  setMockFocused(true);
  resetMockWindow();
  // Opt-in crash reports (plan 31): no DSN, no SDK double and the switch off again.
  resetCrashReporting();
}
