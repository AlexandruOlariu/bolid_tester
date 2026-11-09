import React from 'react';
import { Alert, type AlertButton } from 'react-native';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderWithProviders } from '@test/renderWithProviders';
import { fileSystemMock, memoryFiles } from '@test/mocks/fileSystem';
import { useHistoryStore } from '@/shared/state/historyStore';
import { useTripStore, type TripSummary } from '@/features/trip-recording/model/tripStore';
import { useOnboardingStore } from '@/features/onboarding/model/onboardingStore';
import { useBackupStore } from '../model/backupStore';
import { connectSimulator } from '@test/simulator';
import { resetStores } from '@test/resetStores';
import { PROTOCOL_LABELS } from '@/shared/obd-core';
import { getVehicleProfile, vehicleLabel } from '@/shared/vehicles';
import { useSessionStore } from '@/shared/state/sessionStore';
import { useVehicleStore } from '@/shared/state/vehicleStore';
import { disconnect } from '@/features/connection/api/connectionService';
import * as dtcService from '@/features/fault-codes/api/dtcService';
import { scanModule } from '@/features/module-scan/api/moduleScanService';
import { buildSavedScan, useScanHistoryStore } from '@/features/module-scan/model/scanHistoryStore';
import { useMaintenanceStore } from '@/features/maintenance/model/maintenanceStore';
import { useDashboardLayoutStore } from '@/features/live-data/model/dashboardLayoutStore';
import { BackupScreen } from './BackupScreen';

// The UI project cannot run the service's variable-specifier imports; the loader hands over the
// in-memory file system jest.setup.ui.ts installs, the sharing double and a fake document picker.
// The service itself is covered against the real stores in api/backupService.test.ts.
const mockPicker = { getDocumentAsync: jest.fn() };
jest.mock('../api/backupService', () => {
  const actual = jest.requireActual<object>('../api/backupService');
  return {
    ...actual,
    loadBackupModules: async () => ({
      FileSystem:
        jest.requireActual<typeof import('@test/mocks/fileSystem')>('@test/mocks/fileSystem')
          .fileSystemMock,
      Sharing: jest.requireMock('expo-sharing'),
      Picker: mockPicker,
    }),
  };
});

const DOC = 'file:///test/';
const VEHICLE = { id: 'golf-plus-2009-20tdi', label: 'VW Golf Plus', vin: 'WVWZZZ1KZ9W903398' };
const trip: TripSummary = {
  header: {
    id: '1762698600000',
    startedAt: 1_762_698_000_000,
    endedAt: 1_762_698_600_000,
    profileId: VEHICLE.id,
    vin: VEHICLE.vin,
    protocol: '6',
  },
  stats: { durationMs: 600_000, sampleCount: 2 } as TripSummary['stats'],
  markerCount: 0,
};

const TRIP_CSV = 'ts,010C\n1,800\n';

/** Press the first non-cancel button of every Alert (the double confirm). */
function confirmAlerts() {
  return jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons?: AlertButton[]) => {
    void buttons?.find((b) => b.style !== 'cancel')?.onPress?.();
  });
}

function addCheck(label = VEHICLE.label) {
  useHistoryStore.getState().addDtcCheck({
    vehicle: { ...VEHICLE, label },
    milOn: true,
    stored: [{ code: 'P0299', description: 'Turbo underboost' }],
    pending: [],
    permanent: [],
    monitorsComplete: 5,
    monitorsTotal: 7,
  });
}

function backupFile(): [string, string] {
  const hit = [...memoryFiles.entries()].find(([k]) => k.includes('/backups/bolid-backup-'));
  if (!hit) throw new Error('no backup written');
  return hit;
}

beforeEach(() => mockPicker.getDocumentAsync.mockReset());

/** Render and wait for the trip-recordings summary the screen loads on mount. */
async function renderScreen() {
  renderWithProviders(<BackupScreen />);
  await screen.findByText(/No trip recordings yet|about/);
}

describe('BackupScreen', () => {
  it('backs up with the trip recordings and lists the file', async () => {
    addCheck();
    useTripStore.getState().finish(trip);
    memoryFiles.set(`${DOC}trip-${trip.header.id}.csv`, 'ts,010C\n1,800\n');
    await renderScreen();
    expect(await screen.findByText(/1 file, about/)).toBeTruthy();
    expect(await screen.findByText(/^The backup file will be about \d/)).toBeTruthy();
    expect(screen.queryByText(/This backup is large/)).toBeNull();
    fireEvent.press(screen.getByText('Back up now'));

    await waitFor(() => expect(screen.getByText(/^Saved bolid-backup-/)).toBeTruthy());
    const [, text] = backupFile();
    const parsed = JSON.parse(text);
    expect(parsed.format).toBe(1);
    expect(parsed.tripFiles).toHaveLength(1);
    expect(useBackupStore.getState().records).toHaveLength(1);
    expect(screen.getByLabelText(/^Share bolid-backup-/)).toBeTruthy();
  });

  it('warns when the whole bundle is estimated above 50 MB, and not once the trips are left out', async () => {
    useTripStore.getState().finish(trip);
    const csvUri = `${DOC}trip-${trip.header.id}.csv`;
    memoryFiles.set(csvUri, TRIP_CSV);
    const real = fileSystemMock.getInfoAsync.getMockImplementation()!;
    // 49.9999 MB of trip CSV: below the threshold alone, above it with the stores added.
    fileSystemMock.getInfoAsync.mockImplementation(async (uri: string) =>
      uri === csvUri ? { exists: true, uri, size: 49_999_900 } : real(uri),
    );
    try {
      await renderScreen();
      expect(await screen.findByText(/This backup is large \(about 50\.0 MB\)/)).toBeTruthy();
      fireEvent.press(screen.getByLabelText('Include trip recordings'));
      await waitFor(() => expect(screen.queryByText(/This backup is large/)).toBeNull());
    } finally {
      fileSystemMock.getInfoAsync.mockImplementation(real);
    }
  });

  it('restores a picked file after the double confirm, leaving the error log out by default', async () => {
    addCheck();
    useOnboardingStore.getState().dismiss('hint-a');
    await renderScreen();
    fireEvent.press(screen.getByText('Back up now'));
    await waitFor(() => expect(screen.getByText(/^Saved bolid-backup-/)).toBeTruthy());
    const [uri] = backupFile();

    // The data changes after the backup; the restore brings back the backed-up history only.
    await act(async () => {
      useHistoryStore.setState({ entries: [] });
      addCheck('Another car');
      useOnboardingStore.getState().dismiss('hint-b');
    });

    mockPicker.getDocumentAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri, name: 'my-backup.json' }],
    });
    fireEvent.press(screen.getByText('Choose a backup file…'));
    await waitFor(() => expect(screen.getByText('my-backup.json')).toBeTruthy());

    expect(screen.getByRole('checkbox', { name: /^History/ }).props.accessibilityState).toEqual({
      checked: true,
      disabled: false,
    });
    expect(
      screen.getByRole('checkbox', { name: 'Dismissed hints' }).props.accessibilityState.checked,
    ).toBe(false);
    expect(
      screen.getByRole('checkbox', { name: 'Error log' }).props.accessibilityState.disabled,
    ).toBe(true);

    const alert = confirmAlerts();
    fireEvent.press(screen.getByLabelText('Restore the selected data'));
    await waitFor(() => expect(screen.getByText('Restore finished')).toBeTruthy());
    expect(alert).toHaveBeenCalledTimes(2);
    alert.mockRestore();

    const entries = useHistoryStore.getState().entries;
    expect(entries).toHaveLength(1);
    expect(entries[0].vehicle.label).toBe(VEHICLE.label);
    // dismissed hints were not selected, so they stay as they are now
    expect(useOnboardingStore.getState().dismissed).toEqual(['hint-a', 'hint-b']);
    expect(screen.getByText(/saved as pre-restore-/)).toBeTruthy();
    expect([...memoryFiles.keys()].some((k) => k.includes('/backups/pre-restore-'))).toBe(true);
  });

  it('says why a picked file is not a backup', async () => {
    memoryFiles.set('file:///test-cache/photo.json', '{"hello":1}');
    mockPicker.getDocumentAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'file:///test-cache/photo.json', name: 'photo.json' }],
    });
    await renderScreen();
    fireEvent.press(screen.getByText('Choose a backup file…'));
    await waitFor(() => expect(screen.getByText('This file is not a Bolid backup.')).toBeTruthy());
  });

  it('restores from a file in the list (undo via the pre-restore snapshot)', async () => {
    addCheck();
    await renderScreen();
    fireEvent.press(screen.getByText('Back up now'));
    await waitFor(() => expect(screen.getByText(/^Saved bolid-backup-/)).toBeTruthy());
    await act(async () => useHistoryStore.setState({ entries: [] }));

    fireEvent.press(screen.getByLabelText(/^Restore bolid-backup-/));
    await waitFor(() =>
      expect(
        screen.getByText('Choose what to restore. Everything else stays as it is.'),
      ).toBeTruthy(),
    );
    const alert = confirmAlerts();
    fireEvent.press(screen.getByLabelText('Restore the selected data'));
    await waitFor(() => expect(screen.getByText('Restore finished')).toBeTruthy());
    alert.mockRestore();
    expect(useHistoryStore.getState().entries).toHaveLength(1);
  });

  it('exports one store as JSON and CSV', async () => {
    addCheck();
    await renderScreen();
    fireEvent.press(screen.getByLabelText(/^Export History.* as CSV$/));
    await waitFor(() => expect(screen.getByText(/^Saved bolid-history-.*\.csv\.$/)).toBeTruthy());
    const csv = [...memoryFiles.entries()].find(
      ([k]) => k.endsWith('.csv') && k.includes('bolid-history-'),
    );
    expect(csv?.[1]).toContain('P0299');

    fireEvent.press(screen.getByLabelText('Export Settings as JSON'));
    await waitFor(() => expect(screen.getByText(/^Saved bolid-settings-.*\.json\.$/)).toBeTruthy());
    expect(screen.queryByLabelText('Export Settings as CSV')).toBeNull();
  });

  it('simulator walk-through: back up, clear the app, restore, same data', async () => {
    const GOLF = 'golf-plus-2009-20tdi';
    useVehicleStore.setState({ selectedProfileId: GOLF });
    await connectSimulator({ vehicleId: GOLF, injectedDtcs: ['P0299'] });
    const { session, info } = useSessionStore.getState();
    if (!session || !info) throw new Error('no session');
    const profile = getVehicleProfile(GOLF);
    const vehicle = { id: GOLF, label: vehicleLabel(profile), vin: info.vin };
    await act(async () => {
      const read = await dtcService.readAll();
      if (!read) throw new Error('no fault read');
      useHistoryStore.getState().addDtcCheck({
        vehicle,
        milOn: read.readiness?.milOn ?? null,
        stored: read.stored,
        pending: read.pending,
        permanent: read.permanent,
        monitorsComplete: null,
        monitorsTotal: null,
      });
      const results = [];
      for (const m of profile.modules ?? []) results.push(await scanModule(session, m));
      await session.setHeader(null);
      useScanHistoryStore
        .getState()
        .saveScan(buildSavedScan({ vehicle, protocol: PROTOCOL_LABELS[info.protocol], results }));
      useTripStore.getState().finish({ ...trip, header: { ...trip.header, vin: info.vin } });
      useMaintenanceStore
        .getState()
        .addEntry([`id:${GOLF}`], { itemId: 'engine-oil', date: Date.now(), odoKm: 180000 });
      useDashboardLayoutStore.getState().setOrder(GOLF, ['010D', '010C']);
      useOnboardingStore.getState().dismiss('live-hint');
    });
    await disconnect();
    memoryFiles.set(`${DOC}trip-${trip.header.id}.csv`, TRIP_CSV);
    const scanIds = useScanHistoryStore.getState().scans.map((x) => x.id);
    expect(scanIds).toHaveLength(1);

    await renderScreen();
    fireEvent.press(screen.getByText('Back up now'));
    await waitFor(() => expect(screen.getByText(/^Saved bolid-backup-/)).toBeTruthy());
    const [uri, text] = backupFile();
    screen.unmount();

    // "Reinstall": every store and file gone, only the user's copy of the backup survives.
    act(() => resetStores());
    expect(useHistoryStore.getState().entries).toHaveLength(0);
    memoryFiles.set(uri, text);

    await renderScreen();
    mockPicker.getDocumentAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri, name: 'kept.json' }],
    });
    fireEvent.press(screen.getByText('Choose a backup file…'));
    await waitFor(() => expect(screen.getByText('kept.json')).toBeTruthy());
    fireEvent.press(screen.getByRole('checkbox', { name: 'Dismissed hints' }));
    const alert = confirmAlerts();
    fireEvent.press(screen.getByLabelText('Restore the selected data'));
    await waitFor(() => expect(screen.getByText('Restore finished')).toBeTruthy());
    alert.mockRestore();

    const entry = useHistoryStore.getState().entries[0];
    expect(entry.kind === 'dtc' && entry.stored.map((d) => d.code)).toEqual(['P0299']);
    expect(entry.vehicle.vin).toBe(info.vin);
    expect(useScanHistoryStore.getState().scans.map((x) => x.id)).toEqual(scanIds);
    expect(useTripStore.getState().trips.map((t) => t.header.id)).toEqual([trip.header.id]);
    expect(memoryFiles.get(`${DOC}trip-${trip.header.id}.csv`)).toBe(TRIP_CSV);
    expect(useMaintenanceStore.getState().byVehicle[`id:${GOLF}`].entries).toHaveLength(1);
    expect(useDashboardLayoutStore.getState().byProfile[GOLF].order).toEqual(['010D', '010C']);
    expect(useVehicleStore.getState().selectedProfileId).toBe(GOLF);
    expect(useOnboardingStore.getState().dismissed).toEqual(['live-hint']);
    expect(screen.getByText(/Trip recordings restored: 1/)).toBeTruthy();
  });
});
