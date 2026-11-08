import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderWithProviders } from '@test/renderWithProviders';
import { connectSimulator } from '@test/simulator';
import { useSettingsStore } from '@/shared/state/settingsStore';
import { useSessionStore } from '@/shared/state/sessionStore';
import { APP_VERSION } from '@/shared/lib/appInfo';
import {
  ADAPTER_LOG_CAPACITY,
  appendAdapterLog,
  clearAdapterLog,
  useAdapterLogStore,
} from '@/shared/state/adapterLog';
import { useVehicleStore } from '@/features/vehicle-select/model/vehicleStore';
import { buildReplayExport, type ReplayExportInput } from '../model/replayExport';
import { SettingsScreen } from './SettingsScreen';

// The real hook loads expo-file-system / expo-sharing with a variable-specifier dynamic import,
// which Jest cannot run; this double records what Settings asked to export (the file it would
// write is `buildReplayExport(input)`, unit-tested in model/replayExport.test.ts).
const mockExportFixture = jest.fn(
  async (input: ReplayExportInput) => buildReplayExport(input).fileName,
);
jest.mock('../hooks/useLogFixtureExport', () => ({
  useLogFixtureExport: () => ({ exportFixture: mockExportFixture, busy: false }),
}));

describe('SettingsScreen', () => {
  beforeEach(() => mockExportFixture.mockClear());

  it('the adapter-source segment switches to the simulator and reveals its sections', async () => {
    useSettingsStore.setState({ adapterSource: 'ble' });
    renderWithProviders(<SettingsScreen />);
    expect(screen.queryByText('Simulated vehicle')).toBeNull();
    expect(screen.queryByText('Developer (simulator)')).toBeNull();

    fireEvent.press(screen.getByText('Simulator (no car)'));

    await waitFor(() => expect(useSettingsStore.getState().adapterSource).toBe('mock'));
    expect(screen.getByText('Simulated vehicle')).toBeTruthy();
    expect(screen.getByText('Injected DTCs')).toBeTruthy();
    expect(screen.getByText('Developer (simulator)')).toBeTruthy();
  });

  it('switching back to the real adapter drops a live simulator session', async () => {
    await connectSimulator();
    renderWithProviders(<SettingsScreen />);
    expect(screen.getByText('Disconnect')).toBeTruthy();

    fireEvent.press(screen.getByText('Real adapter (Bluetooth)'));

    await waitFor(() => expect(useSessionStore.getState().status).toBe('disconnected'));
    expect(useSettingsStore.getState().adapterSource).toBe('ble');
    expect(screen.queryByText('Disconnect')).toBeNull();
  });

  it('the theme segment updates the store', () => {
    renderWithProviders(<SettingsScreen />);
    expect(useSettingsStore.getState().theme).toBe('dark');

    fireEvent.press(screen.getByText('light'));
    expect(useSettingsStore.getState().theme).toBe('light');
  });

  it('a simulator fault preset sets the injected codes', () => {
    useSettingsStore.setState({ adapterSource: 'mock' });
    renderWithProviders(<SettingsScreen />);

    fireEvent.press(screen.getByText('P0299+P0401'));
    expect(useSettingsStore.getState().injectedDtcs).toEqual(['P0299', 'P0401']);
  });

  it('About shows the app version and opens the privacy policy', () => {
    renderWithProviders(<SettingsScreen />);
    expect(screen.getByText(`Bolid Tester ${APP_VERSION}`)).toBeTruthy();
    expect(screen.queryByText('When the app uses the internet')).toBeNull();

    fireEvent.press(screen.getByLabelText('Show the privacy policy'));

    expect(screen.getByText('What stays on your phone')).toBeTruthy();
    expect(screen.getByText('When the app uses the internet')).toBeTruthy();
    expect(screen.getByText('Deleting your data')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Hide the privacy policy'));
    expect(screen.queryByText('What stays on your phone')).toBeNull();
  });

  it('exports the adapter log as a replay fixture named after the vehicle and the flow', async () => {
    clearAdapterLog(); // the log is module-level: start from this test's own session
    await connectSimulator({ injectedDtcs: ['P0299'] });
    // The UI reads a throttled (~4 Hz) snapshot; wait until it holds the whole connect.
    await waitFor(() =>
      expect(useAdapterLogStore.getState().entries.some((e) => e.text === '0904')).toBe(true),
    );
    renderWithProviders(<SettingsScreen />);

    fireEvent.changeText(screen.getByLabelText('Flow name'), 'faults');
    fireEvent.press(screen.getByText('Export as replay fixture'));

    await waitFor(() =>
      expect(screen.getByText(/Clear the log before recording the next flow/)).toBeTruthy(),
    );
    expect(mockExportFixture).toHaveBeenCalledTimes(1);
    const fileName = await mockExportFixture.mock.results[0].value;
    expect(fileName).toMatch(/^bolid-replay-golf-plus-2009-20tdi-faults-.+[.]json$/);
    expect(
      screen.getByText(`Saved ${fileName}. Clear the log before recording the next flow.`),
    ).toBeTruthy();
    const { fixture } = buildReplayExport(mockExportFixture.mock.calls[0][0]);
    // A simulator session is labelled as one, so it can never count as an on-car validation.
    expect(fixture.meta).toMatchObject({
      source: 'simulator',
      vehicleId: 'golf-plus-2009-20tdi',
      flow: 'faults',
      adapter: 'ELM327 v2.2',
      protocol: 'ISO_15765_4_CAN_11_500',
      appVersion: APP_VERSION,
    });
    expect(fixture.pairs['ATZ']).toBe('ELM327 v2.2');
    expect(fixture.pairs['0100']).toMatch(/^4100/);
    expect(fixture.sequences).toBeDefined();
    expect(fixture.meta?.droppedEntries).toBeUndefined();
  });

  it('a real-adapter log exports as a car fixture for the selected vehicle', async () => {
    clearAdapterLog();
    useSettingsStore.setState({ adapterSource: 'ble', simulatedVehicleId: 'generic' });
    useVehicleStore.setState({ selectedProfileId: 'passat-b55-19tdi' });
    appendAdapterLog({ dir: 'tx', text: '03', ts: 1 });
    appendAdapterLog({ dir: 'rx', text: '4300\r', ts: 2 });
    await waitFor(() => expect(useAdapterLogStore.getState().entries).toHaveLength(2));
    renderWithProviders(<SettingsScreen />);

    fireEvent.changeText(screen.getByLabelText('Flow name'), 'faults');
    fireEvent.press(screen.getByText('Export as replay fixture'));

    await waitFor(() => expect(mockExportFixture).toHaveBeenCalledTimes(1));
    const fileName = await mockExportFixture.mock.results[0].value;
    expect(fileName).toMatch(/^bolid-replay-passat-b55-19tdi-faults-.+[.]json$/);
    const { fixture } = buildReplayExport(mockExportFixture.mock.calls[0][0]);
    expect(fixture.meta).toMatchObject({
      source: 'car',
      vehicleId: 'passat-b55-19tdi',
      flow: 'faults',
    });
    expect(fixture.pairs['03']).toBe('4300');
  });

  it('warns, and records it in meta, when the log wrapped before the export', async () => {
    clearAdapterLog();
    useSettingsStore.setState({ adapterSource: 'ble' });
    const total = ADAPTER_LOG_CAPACITY + 10;
    for (let i = 0; i < total; i++) appendAdapterLog({ dir: 'tx', text: `ATI${i}`, ts: i });
    await waitFor(() => expect(useAdapterLogStore.getState().dropped).toBe(10));
    renderWithProviders(<SettingsScreen />);
    expect(screen.getByText(/The log is full: the oldest 10 lines were dropped/)).toBeTruthy();

    fireEvent.press(screen.getByText('Export as replay fixture'));

    await waitFor(() =>
      expect(
        screen.getByText(/but the log was full: the oldest 10 lines were dropped/),
      ).toBeTruthy(),
    );
    const { fixture } = buildReplayExport(mockExportFixture.mock.calls[0][0]);
    expect(fixture.meta?.droppedEntries).toBe(10);
  });

  it('a saved message gives way to the default hint on Clear and to the full-log warning on a wrap', async () => {
    clearAdapterLog();
    useSettingsStore.setState({ adapterSource: 'ble' });
    appendAdapterLog({ dir: 'tx', text: '0100', ts: 1 });
    await waitFor(() => expect(useAdapterLogStore.getState().entries).toHaveLength(1));
    renderWithProviders(<SettingsScreen />);

    fireEvent.press(screen.getByText('Export as replay fixture'));
    await waitFor(() =>
      expect(screen.getByText(/Clear the log before recording the next flow/)).toBeTruthy(),
    );

    // Clear → the next flow starts from the default hint.
    fireEvent.press(screen.getByText('Clear'));
    await waitFor(() => expect(screen.getByText(/Name the flow you just ran/)).toBeTruthy());
    expect(screen.queryByText(/Clear the log before recording the next flow/)).toBeNull();

    // Export again, then let the next flow wrap the log without a Clear: the warning shows.
    appendAdapterLog({ dir: 'tx', text: '0100', ts: 2 });
    await waitFor(() => expect(useAdapterLogStore.getState().entries).toHaveLength(1));
    fireEvent.press(screen.getByText('Export as replay fixture'));
    await waitFor(() =>
      expect(screen.getByText(/Clear the log before recording the next flow/)).toBeTruthy(),
    );
    for (let i = 0; i < ADAPTER_LOG_CAPACITY + 4; i++) {
      appendAdapterLog({ dir: 'tx', text: `ATI${i}`, ts: 10 + i });
    }
    await waitFor(() =>
      expect(screen.getByText(/The log is full: the oldest 5 lines were dropped/)).toBeTruthy(),
    );
    expect(screen.queryByText(/Clear the log before recording the next flow/)).toBeNull();
  });
});
