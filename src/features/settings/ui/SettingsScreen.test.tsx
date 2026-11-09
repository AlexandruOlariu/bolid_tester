import React from 'react';
import { Alert, Linking, Platform } from 'react-native';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderWithProviders } from '@test/renderWithProviders';
import { mockPush } from '@test/mocks/router';
import { connectSimulator } from '@test/simulator';
import { useSettingsStore } from '@/shared/state/settingsStore';
import { useSessionStore } from '@/shared/state/sessionStore';
import { connect, disconnect } from '@/features/connection/api/connectionService';
import { APP_VERSION } from '@/shared/lib/appInfo';
import { setAiFetch } from '@/shared/ai';
import {
  ADAPTER_LOG_CAPACITY,
  adapterLogSnapshot,
  appendAdapterLog,
  clearAdapterLog,
  useAdapterLogStore,
} from '@/shared/state/adapterLog';
import { useVehicleStore } from '@/shared/state/vehicleStore';
import { useGarageStore } from '@/shared/state/garageStore';
import { useHistoryStore } from '@/shared/state/historyStore';
import { useOnboardingStore } from '@/shared/state/onboardingStore';
import { FIRST_RUN_HINT_ID, FirstRunCard } from '@/features/onboarding';
import { useDtcStore } from '@/shared/state/dtcStore';
import { DOCS_URL } from '@/shared/lib/appInfo';
import { buildReplayExport, type ReplayExportInput } from '../model/replayExport';
import { resetAllAppData } from '@/features/backup';
import {
  TEST_REPORT_MESSAGE,
  crashReportingReady,
  getCrashReportingStatus,
  setCrashReportingDsn,
  setCrashReportingModuleLoader,
  startCrashReporting,
} from '@/shared/telemetry/crashReporting';
import { PRIVACY_POLICY_URL } from '@/shared/lib/appInfo';
import { SettingsScreen } from './SettingsScreen';
import { i18n } from '@/shared/i18n';

// The real hook loads expo-file-system / expo-sharing with a variable-specifier dynamic import,
// which Jest cannot run; this double records what Settings asked to export (the file it would
// write is `buildReplayExport(input)`, unit-tested in model/replayExport.test.ts).
const mockExportFixture = jest.fn(
  async (input: ReplayExportInput) => buildReplayExport(input).fileName,
);
jest.mock('../hooks/useLogFixtureExport', () => ({
  useLogFixtureExport: () => ({ exportFixture: mockExportFixture, busy: false }),
}));

/** Developer & simulator is collapsed on open (plan 07): expand it. */
function openDeveloper() {
  fireEvent.press(screen.getByText('Developer & simulator'));
}

type AlertButtons = { text?: string; onPress?: () => void }[];

/** Press `text` in the buttons of the `index`-th `Alert.alert` call. */
function pressAlertButton(alert: jest.SpyInstance, index: number, text: string) {
  const buttons = alert.mock.calls[index][2] as AlertButtons;
  const button = buttons.find((b) => b.text === text);
  if (!button?.onPress) throw new Error(`no "${text}" button in alert ${index}`);
  button.onPress();
}

describe('SettingsScreen', () => {
  beforeEach(() => mockExportFixture.mockClear());

  it('opens with the sections in order and Developer & simulator collapsed (plan 07)', () => {
    renderWithProviders(<SettingsScreen resetAppData={resetAllAppData} />);
    const order = [
      'General',
      'Connection',
      'Privacy',
      'AI assistant (auto-diagnose)',
      'Notifications',
      'Data',
      'Developer & simulator',
      'About',
    ];
    const tops = order.map((label) => screen.getByText(label));
    const all = screen.UNSAFE_root.findAll(() => true);
    const positions = tops.map((el) => all.indexOf(el));
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);

    // Collapsed: the header offers "Show"; none of the developer controls is rendered.
    expect(screen.getByRole('button', { name: 'Developer & simulator. Show' })).toBeTruthy();
    expect(screen.queryByText('Simulator (no car)')).toBeNull();
    expect(screen.queryByText('Export as replay fixture')).toBeNull();
    expect(screen.queryByText('Reset all app data')).toBeNull();
    expect(screen.queryByText('Show hints again')).toBeNull();

    openDeveloper();
    expect(screen.getByRole('button', { name: 'Developer & simulator. Hide' })).toBeTruthy();
    expect(screen.getByText('Simulator (no car)')).toBeTruthy();
    expect(screen.getByText('Export as replay fixture')).toBeTruthy();
    expect(screen.getByText('Reset all app data')).toBeTruthy();

    fireEvent.press(screen.getByText('Developer & simulator'));
    expect(screen.queryByText('Simulator (no car)')).toBeNull();
  });

  it('hides Reset all app data when the route passes no reset action', () => {
    renderWithProviders(<SettingsScreen />);
    openDeveloper();
    expect(screen.getByText('Show hints again')).toBeTruthy();
    expect(screen.queryByText('Reset all app data')).toBeNull();
  });

  it('the adapter-source segment switches to the simulator and reveals its sections', async () => {
    useSettingsStore.setState({ adapterSource: 'ble' });
    renderWithProviders(<SettingsScreen resetAppData={resetAllAppData} />);
    openDeveloper();
    expect(screen.queryByText('Simulated vehicle')).toBeNull();
    expect(screen.queryByText('Simulator test controls')).toBeNull();

    fireEvent.press(screen.getByText('Simulator (no car)'));

    await waitFor(() => expect(useSettingsStore.getState().adapterSource).toBe('mock'));
    expect(screen.getByText('Simulated vehicle')).toBeTruthy();
    expect(screen.getByText('Injected DTCs')).toBeTruthy();
    expect(screen.getByText('Simulator test controls')).toBeTruthy();
  });

  it('switching back to the real adapter drops a live simulator session', async () => {
    await connectSimulator();
    renderWithProviders(<SettingsScreen resetAppData={resetAllAppData} />);
    expect(screen.getByText('Disconnect')).toBeTruthy();
    openDeveloper();

    fireEvent.press(screen.getByText('Real adapter (Bluetooth)'));

    await waitFor(() => expect(useSessionStore.getState().status).toBe('disconnected'));
    expect(useSettingsStore.getState().adapterSource).toBe('ble');
    expect(screen.queryByText('Disconnect')).toBeNull();
  });

  it('the theme segment updates the store', () => {
    renderWithProviders(<SettingsScreen resetAppData={resetAllAppData} />);
    expect(useSettingsStore.getState().theme).toBe('dark');

    fireEvent.press(screen.getByText('light'));
    expect(useSettingsStore.getState().theme).toBe('light');
  });

  it('segments are radio groups announcing the selected option; on / off settings are switches (plan 20)', () => {
    renderWithProviders(<SettingsScreen resetAppData={resetAllAppData} />);
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeSelected();
    expect(screen.getByRole('radio', { name: 'Light' })).not.toBeSelected();
    expect(screen.getByRole('radio', { name: '1000 milliseconds' })).toBeChecked();
    fireEvent.press(screen.getByRole('radio', { name: '500 milliseconds' }));
    expect(useSettingsStore.getState().pollIntervalMs).toBe(500);
    expect(screen.getByRole('radio', { name: '500 milliseconds' })).toBeSelected();

    const reconnect = screen.getByRole('switch', { name: 'Auto-reconnect' });
    expect(reconnect).toBeChecked();
    fireEvent.press(reconnect);
    expect(useSettingsStore.getState().autoReconnect).toBe(false);
    expect(screen.getByRole('switch', { name: 'Auto-reconnect' })).not.toBeChecked();
    expect(screen.getByRole('switch', { name: 'Recognise my cars by VIN' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'AI assistant enabled' })).toBeTruthy();
    expect(screen.getByLabelText('AI server URL')).toBeTruthy();
    expect(screen.getByLabelText('AI model')).toBeTruthy();
  });

  it('a simulator fault preset sets the injected codes', () => {
    useSettingsStore.setState({ adapterSource: 'mock' });
    renderWithProviders(<SettingsScreen resetAppData={resetAllAppData} />);
    openDeveloper();

    fireEvent.press(screen.getByText('P0299+P0401'));
    expect(useSettingsStore.getState().injectedDtcs).toEqual(['P0299', 'P0401']);
  });

  it('the Data section opens Backup & restore', () => {
    renderWithProviders(<SettingsScreen resetAppData={resetAllAppData} />);
    expect(screen.getByText('Data')).toBeTruthy();
    fireEvent.press(screen.getByText('Backup & restore'));
    expect(mockPush).toHaveBeenCalledWith('/backup');
    fireEvent.press(screen.getByText('Export data…'));
    expect(mockPush).toHaveBeenLastCalledWith('/backup');
  });

  it('Notifications opens the notification settings screen', () => {
    renderWithProviders(<SettingsScreen resetAppData={resetAllAppData} />);
    fireEvent.press(screen.getByRole('button', { name: /^Notification settings\./ }));
    expect(mockPush).toHaveBeenCalledWith('/notifications');
  });

  it('the app is metric only: General says so and offers no unit choice', () => {
    renderWithProviders(<SettingsScreen resetAppData={resetAllAppData} />);
    expect(screen.getByText(/Units are metric: km\/h, °C, km, kPa and L\/100 km/)).toBeTruthy();
    expect(screen.queryByText(/mph|°F|miles/i)).toBeNull();
  });

  it('Preview feedback bundle opens Report a problem in preview mode (plan 32)', () => {
    renderWithProviders(<SettingsScreen />);
    openDeveloper();
    fireEvent.press(screen.getByText('Preview feedback bundle'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/feedback', params: { preview: '1' } });
  });

  it('Show hints again brings back the dismissed first-run card', () => {
    useOnboardingStore.getState().dismiss(FIRST_RUN_HINT_ID);
    useOnboardingStore.getState().dismiss('charts-tip');
    renderWithProviders(<SettingsScreen resetAppData={resetAllAppData} />);
    openDeveloper();

    fireEvent.press(screen.getByText('Show hints again'));

    expect(useOnboardingStore.getState().dismissed).toEqual([]);
    expect(screen.getByText(/Hints are back/)).toBeTruthy();
  });

  it('Show hints again brings the first-run card back even when its steps are all done', () => {
    // The Connect tab's card and Settings, mounted together as the tabs are.
    renderWithProviders(
      <>
        <FirstRunCard />
        <SettingsScreen resetAppData={resetAllAppData} />
      </>,
    );
    expect(screen.getByText('Getting started')).toBeTruthy();

    // Pick a car, connect, read faults: the third step auto-dismisses the card.
    act(() => {
      useVehicleStore.setState({ selectedProfileId: 'golf-plus-2009-20tdi' });
      useSessionStore.setState({ status: 'connected' });
      useDtcStore.setState({ lastReadAt: 1 });
    });
    expect(screen.queryByText('Getting started')).toBeNull();
    expect(useOnboardingStore.getState().dismissed).toContain(FIRST_RUN_HINT_ID);

    openDeveloper();
    fireEvent.press(screen.getByText('Show hints again'));

    // Every step is still done this session, yet the card is back (all ticked) and stays.
    expect(screen.getByText('Getting started')).toBeTruthy();
    expect(screen.getByLabelText('Step 3: Read fault codes, done')).toBeTruthy();
    expect(useOnboardingStore.getState().dismissed).toEqual([]);
  });

  it('Reset all app data asks twice, then returns the app to a fresh state', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await connectSimulator();
    useSettingsStore.setState({ theme: 'light' });
    useGarageStore.setState({
      vehicles: [
        {
          id: 'user:a',
          name: 'Dacia',
          fuel: 'petrol',
          baseProfileId: 'generic',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
    useVehicleStore.setState({ selectedProfileId: 'user:a' });
    useHistoryStore.getState().addDtcCheck({ profileId: 'generic', codes: [] } as never);
    useOnboardingStore.getState().dismiss(FIRST_RUN_HINT_ID);
    renderWithProviders(<SettingsScreen resetAppData={resetAllAppData} />);
    openDeveloper();

    fireEvent.press(screen.getByText('Reset all app data'));
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls[0][0]).toBe('Reset all app data?');
    // Nothing changes before the second confirmation.
    expect(useGarageStore.getState().vehicles).toHaveLength(1);
    pressAlertButton(alert, 0, 'Continue');
    expect(alert).toHaveBeenCalledTimes(2);
    expect(alert.mock.calls[1][0]).toBe('Delete all app data?');
    expect(useGarageStore.getState().vehicles).toHaveLength(1);
    await act(async () => pressAlertButton(alert, 1, 'Reset everything'));

    await waitFor(() => expect(screen.getByText(/All app data was reset/)).toBeTruthy());
    expect(useSessionStore.getState().status).toBe('disconnected');
    const settings = useSettingsStore.getState();
    expect(settings.adapterSource).toBe('ble');
    expect(settings.theme).toBe('dark');
    expect(useGarageStore.getState().vehicles).toEqual([]);
    expect(useVehicleStore.getState().selectedProfileId).toBe('generic');
    expect(useHistoryStore.getState().entries).toEqual([]);
    expect(useOnboardingStore.getState().dismissed).toEqual([]);
    // Back on the real adapter, so the simulator controls are gone.
    expect(screen.queryByText('Simulated vehicle')).toBeNull();
    alert.mockRestore();
  });

  it('Reset all app data invalidates a connect still in flight (no stale session is published)', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    useSettingsStore.setState({ adapterSource: 'mock' });
    renderWithProviders(<SettingsScreen resetAppData={resetAllAppData} />);
    openDeveloper();
    // A simulator connect is mid-handshake when the owner confirms the reset.
    const inFlight = connect().catch(() => undefined);

    fireEvent.press(screen.getByText('Reset all app data'));
    pressAlertButton(alert, 0, 'Continue');
    await act(async () => pressAlertButton(alert, 1, 'Reset everything'));
    await waitFor(() => expect(screen.getByText(/All app data was reset/)).toBeTruthy());
    await act(async () => {
      await inFlight;
    });

    // The superseded connect tore itself down instead of publishing a simulator session under the
    // real-adapter setting the reset restored.
    expect(useSettingsStore.getState().adapterSource).toBe('ble');
    expect(useSessionStore.getState().session).toBeNull();
    expect(useSessionStore.getState().status).not.toBe('connected');
    expect(adapterLogSnapshot()).toEqual([]);
    alert.mockRestore();
  });

  it('About shows the app version and opens the privacy policy', () => {
    renderWithProviders(<SettingsScreen resetAppData={resetAllAppData} />);
    expect(screen.getByText(`Bolid Tester ${APP_VERSION}`)).toBeTruthy();
    expect(screen.queryByText('When the app uses the internet')).toBeNull();

    fireEvent.press(screen.getByLabelText('Show the privacy policy'));

    expect(screen.getByText('What stays on your phone')).toBeTruthy();
    expect(screen.getByText('When the app uses the internet')).toBeTruthy();
    expect(screen.getByText('Deleting your data')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Hide the privacy policy'));
    expect(screen.queryByText('What stays on your phone')).toBeNull();
  });

  it('About links to the documentation', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    renderWithProviders(<SettingsScreen resetAppData={resetAllAppData} />);
    fireEvent.press(screen.getByLabelText('Open the documentation on GitHub'));
    expect(open).toHaveBeenCalledWith(DOCS_URL);
    open.mockRestore();
  });

  it('About offers Rate this app, the privacy policy, Report a problem and Licences (plan 30)', () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    renderWithProviders(<SettingsScreen resetAppData={resetAllAppData} />);

    expect(screen.getByText('Privacy policy')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Rate this app in the store'));
    expect(open).toHaveBeenCalledWith('market://details?id=com.bolidtester.app');

    fireEvent.press(
      screen.getByLabelText('Report a problem: build a redacted log bundle to share'),
    );
    expect(mockPush).toHaveBeenCalledWith('/feedback');

    fireEvent.press(screen.getByLabelText('Open the third-party licences'));
    expect(mockPush).toHaveBeenCalledWith('/licenses');
    jest.restoreAllMocks(); // also puts Platform.OS back
  });

  it('Rate this app falls back to the Play web page when the store app is missing', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const open = jest
      .spyOn(Linking, 'openURL')
      .mockRejectedValueOnce(new Error('No Activity found to handle Intent'))
      .mockResolvedValue(true);
    renderWithProviders(<SettingsScreen resetAppData={resetAllAppData} />);
    fireEvent.press(screen.getByLabelText('Rate this app in the store'));
    await waitFor(() =>
      expect(open).toHaveBeenLastCalledWith(
        'https://play.google.com/store/apps/details?id=com.bolidtester.app',
      ),
    );
    jest.restoreAllMocks(); // also puts Platform.OS back
  });

  it('hides Rate this app on iOS until the App Store id exists, and on the web', () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    const { unmount } = renderWithProviders(<SettingsScreen resetAppData={resetAllAppData} />);
    expect(screen.queryByText('Rate this app')).toBeNull();
    expect(screen.getByText('Licences')).toBeTruthy();
    unmount();
    jest.replaceProperty(Platform, 'OS', 'web');
    renderWithProviders(<SettingsScreen resetAppData={resetAllAppData} />);
    expect(screen.queryByText('Rate this app')).toBeNull();
    jest.restoreAllMocks();
  });

  it('exports the adapter log as a replay fixture named after the vehicle and the flow', async () => {
    clearAdapterLog(); // the log is module-level: start from this test's own session
    await connectSimulator({ injectedDtcs: ['P0299'] });
    // The UI reads a throttled (~4 Hz) snapshot; wait until it holds the whole connect.
    await waitFor(() =>
      expect(useAdapterLogStore.getState().entries.some((e) => e.text === '0904')).toBe(true),
    );
    renderWithProviders(<SettingsScreen resetAppData={resetAllAppData} />);
    openDeveloper();

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

  it('labels the export by how the log was recorded, not by the settings at export time (plan W2)', async () => {
    clearAdapterLog();
    await connectSimulator({ vehicleId: 'golf-plus-2009-20tdi' });
    await waitFor(() =>
      expect(useAdapterLogStore.getState().entries.some((e) => e.text === '0904')).toBe(true),
    );
    // Disconnect (the session info is gone), then the settings change behind the log's back: another
    // simulated car and the real adapter (e.g. a restored settings file). The log still holds the
    // simulated Golf's session.
    await act(async () => {
      await disconnect();
    });
    useSettingsStore.setState({ adapterSource: 'ble', simulatedVehicleId: 'fiat-punto-2008-12' });
    useVehicleStore.setState({ selectedProfileId: 'passat-b55-19tdi' });
    renderWithProviders(<SettingsScreen resetAppData={resetAllAppData} />);
    openDeveloper();

    fireEvent.changeText(screen.getByLabelText('Flow name'), 'connect');
    fireEvent.press(screen.getByText('Export as replay fixture'));

    await waitFor(() => expect(mockExportFixture).toHaveBeenCalledTimes(1));
    const { fixture } = buildReplayExport(mockExportFixture.mock.calls[0][0]);
    expect(fixture.meta).toMatchObject({
      source: 'simulator',
      vehicleId: 'golf-plus-2009-20tdi',
      flow: 'connect',
      adapter: 'ELM327 v2.2',
      protocol: 'ISO_15765_4_CAN_11_500',
    });
  });

  it('Clear during a session keeps the label of the session for the next flow (plan W2)', async () => {
    clearAdapterLog();
    await connectSimulator({ vehicleId: 'golf-plus-2009-20tdi' });
    await waitFor(() =>
      expect(useAdapterLogStore.getState().entries.some((e) => e.text === '0904')).toBe(true),
    );
    renderWithProviders(<SettingsScreen resetAppData={resetAllAppData} />);
    openDeveloper();
    // The documented workflow: Clear, run the next flow on the same session, export it. Meanwhile
    // another simulated car is picked (a plain setting: the Golf session keeps running).
    fireEvent.press(screen.getByText('Clear'));
    await waitFor(() => expect(useAdapterLogStore.getState().entries).toEqual([]));
    await act(async () => {
      await useSessionStore.getState().session?.readDtcs('03');
    });
    useSettingsStore.setState({ simulatedVehicleId: 'fiat-punto-2008-12' });
    // The read is done; wait for the throttled publish to carry all of it (the `03` reply too).
    await waitFor(() => {
      const { entries } = useAdapterLogStore.getState();
      expect(entries.some((e) => e.text === '03')).toBe(true);
      expect(entries).toEqual(adapterLogSnapshot());
    });

    fireEvent.changeText(screen.getByLabelText('Flow name'), 'faults');
    fireEvent.press(screen.getByText('Export as replay fixture'));

    await waitFor(() => expect(mockExportFixture).toHaveBeenCalledTimes(1));
    const { fixture } = buildReplayExport(mockExportFixture.mock.calls[0][0]);
    expect(fixture.meta).toMatchObject({
      source: 'simulator',
      vehicleId: 'golf-plus-2009-20tdi',
      flow: 'faults',
      adapter: 'ELM327 v2.2',
      protocol: 'ISO_15765_4_CAN_11_500',
    });
    expect(fixture.pairs['0904']).toBeUndefined(); // the Clear dropped the connect
    expect(fixture.pairs['03']).toBeDefined();
  });

  it('a real-adapter log exports as a car fixture for the selected vehicle', async () => {
    clearAdapterLog();
    useSettingsStore.setState({ adapterSource: 'ble', simulatedVehicleId: 'generic' });
    useVehicleStore.setState({ selectedProfileId: 'passat-b55-19tdi' });
    appendAdapterLog({ dir: 'tx', text: '03', ts: 1 });
    appendAdapterLog({ dir: 'rx', text: '4300\r', ts: 2 });
    await waitFor(() => expect(useAdapterLogStore.getState().entries).toHaveLength(2));
    renderWithProviders(<SettingsScreen resetAppData={resetAllAppData} />);
    openDeveloper();

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
    renderWithProviders(<SettingsScreen resetAppData={resetAllAppData} />);
    openDeveloper();
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
    renderWithProviders(<SettingsScreen resetAppData={resetAllAppData} />);
    openDeveloper();

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

describe('SettingsScreen AI provider (plan 19)', () => {
  afterEach(() => setAiFetch(null));

  it('Anthropic fills the URL and model, hides Structured output and shows the key field', async () => {
    renderWithProviders(<SettingsScreen resetAppData={resetAllAppData} />);
    expect(screen.getByTestId('ai-structured-output')).toBeTruthy();
    expect(screen.queryByLabelText('Anthropic API key')).toBeNull();

    fireEvent.press(screen.getByText('Anthropic'));

    await waitFor(() => expect(useSettingsStore.getState().ai.provider).toBe('anthropic'));
    const { ai } = useSettingsStore.getState();
    expect(ai.baseUrl).toBe('https://api.anthropic.com');
    expect(ai.model).toBe('claude-sonnet-5-5');
    expect(ai.jsonMode).toBe('off');
    expect(screen.getByTestId('ai-fixed-url')).toHaveTextContent('https://api.anthropic.com');
    expect(screen.queryByTestId('ai-structured-output')).toBeNull();
    expect(screen.getByLabelText('Anthropic API key')).toBeTruthy();
    expect(screen.getByText(/secure keystore, never in backups/)).toBeTruthy();
    expect(screen.getByText(/console\.anthropic\.com/)).toBeTruthy();
  });

  it('Edit on a cloud URL flips to Custom and keeps the address', async () => {
    renderWithProviders(<SettingsScreen resetAppData={resetAllAppData} />);
    fireEvent.press(screen.getByText('OpenAI'));
    await waitFor(() => expect(useSettingsStore.getState().ai.provider).toBe('openai'));

    fireEvent.press(screen.getByLabelText('Edit the server address (switches to Custom)'));

    const { ai } = useSettingsStore.getState();
    expect(ai.provider).toBe('custom');
    expect(ai.baseUrl).toBe('https://api.openai.com');
    expect(screen.queryByTestId('ai-fixed-url')).toBeNull();
    expect(screen.getByLabelText('Custom API key')).toBeTruthy();
  });

  it('Test connection on Anthropic calls the Messages API models list with the key', async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    setAiFetch(async (url, init) => {
      calls.push({ url, headers: init.headers as Record<string, string> });
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ data: [{ id: 'claude-sonnet-5-5' }, { id: 'claude-opus-5-5' }] }),
        text: async () => '',
      } as Response;
    });
    renderWithProviders(<SettingsScreen resetAppData={resetAllAppData} />);
    fireEvent.press(screen.getByText('Anthropic'));
    fireEvent.changeText(screen.getByLabelText('Anthropic API key'), 'sk-ant-test');

    fireEvent.press(screen.getByText('Test connection'));

    expect(await screen.findByText(/Connected ✓ — 2 models/)).toBeTruthy();
    expect(calls[0].url).toMatch(/^https:\/\/api\.anthropic\.com\/v1\/models/);
    expect(calls[0].headers['x-api-key']).toBe('sk-ant-test');
    expect(useSettingsStore.getState().ai.apiKey).toBe('sk-ant-test');
  });

  it('a Detect that finishes after a provider switch does not touch the new provider', async () => {
    let respond: () => void = () => {};
    setAiFetch(
      () =>
        new Promise<Response>((resolve) => {
          respond = () =>
            resolve({
              ok: true,
              status: 200,
              statusText: 'OK',
              json: async () => ({ data: [{ id: 'lmstudio-local-model' }] }),
              text: async () => '',
            } as Response);
        }),
    );
    useSettingsStore.setState((s) => ({
      ai: { ...s.ai, provider: 'local', baseUrl: 'http://192.168.1.50:1234' },
    }));
    renderWithProviders(<SettingsScreen resetAppData={resetAllAppData} />);
    fireEvent.press(screen.getByText('Detect model'));
    expect(await screen.findByText('Connecting…')).toBeTruthy();

    fireEvent.press(screen.getByText('Anthropic'));
    await waitFor(() => expect(useSettingsStore.getState().ai.provider).toBe('anthropic'));
    await act(async () => respond());

    await waitFor(() => expect(screen.getByText('Detect model')).toBeEnabled());
    expect(useSettingsStore.getState().ai.model).toBe('claude-sonnet-5-5');
    expect(screen.queryByText(/Connected ✓/)).toBeNull();
    expect(screen.queryByText('Connecting…')).toBeNull();
  });
});

describe('Settings → Wi-Fi adapter (plan 26)', () => {
  it('the Wi-Fi segment selects the Wi-Fi source and shows the address fields', async () => {
    useSettingsStore.setState({ adapterSource: 'ble' });
    renderWithProviders(<SettingsScreen resetAppData={resetAllAppData} />);
    openDeveloper();
    expect(screen.queryByTestId('settings-wifi')).toBeNull();

    fireEvent.press(screen.getByText('Wi-Fi adapter'));

    await waitFor(() => expect(useSettingsStore.getState().adapterSource).toBe('wifi'));
    expect(screen.getByTestId('settings-wifi')).toBeTruthy();
    expect(screen.getByLabelText('Wi-Fi adapter host').props.value).toBe('192.168.0.10');
    expect(screen.getByLabelText('Wi-Fi adapter port').props.value).toBe('35000');
    expect(screen.queryByText('Simulated vehicle')).toBeNull();
  });

  it('saves a valid address and explains an invalid one without saving it', () => {
    useSettingsStore.setState({
      adapterSource: 'wifi',
      wifi: { host: '192.168.0.10', port: 35000 },
    });
    renderWithProviders(<SettingsScreen resetAppData={resetAllAppData} />);
    openDeveloper();

    fireEvent.changeText(screen.getByLabelText('Wi-Fi adapter host'), '192.168.4.1');
    fireEvent.changeText(screen.getByLabelText('Wi-Fi adapter port'), '23');
    expect(useSettingsStore.getState().wifi).toEqual({ host: '192.168.4.1', port: 23 });
    expect(screen.queryByTestId('settings-wifi-error')).toBeNull();

    fireEvent.changeText(screen.getByLabelText('Wi-Fi adapter port'), '70000');
    expect(screen.getByTestId('settings-wifi-error')).toHaveTextContent(
      /port from 1 to 65535.*keeps using 192\.168\.4\.1:23/,
    );
    fireEvent.changeText(screen.getByLabelText('Wi-Fi adapter host'), '192.168.0.300');
    expect(screen.getByTestId('settings-wifi-error')).toHaveTextContent(/IP address/);
    expect(useSettingsStore.getState().wifi).toEqual({ host: '192.168.4.1', port: 23 });

    fireEvent.press(screen.getByText('Use the default address'));
    expect(useSettingsStore.getState().wifi).toEqual({ host: '192.168.0.10', port: 35000 });
    expect(screen.queryByTestId('settings-wifi-error')).toBeNull();
  });

  it('follows a stored address that changes elsewhere, without overwriting it on the next edit', () => {
    useSettingsStore.setState({
      adapterSource: 'wifi',
      wifi: { host: '192.168.0.10', port: 35000 },
    });
    renderWithProviders(<SettingsScreen resetAppData={resetAllAppData} />);
    openDeveloper();

    // e.g. a data restore from the Backup screen pushed on top of Settings
    act(() => {
      useSettingsStore.setState({ wifi: { host: '10.0.0.5', port: 23 } });
    });
    expect(screen.getByLabelText('Wi-Fi adapter host').props.value).toBe('10.0.0.5');
    expect(screen.getByLabelText('Wi-Fi adapter port').props.value).toBe('23');

    fireEvent.changeText(screen.getByLabelText('Wi-Fi adapter host'), '10.0.0.6');
    expect(useSettingsStore.getState().wifi).toEqual({ host: '10.0.0.6', port: 23 });
  });
});

describe('Settings → Classic Bluetooth (plan 27)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('on Android, the Classic Bluetooth segment selects the SPP source and explains pairing', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    useSettingsStore.setState({ adapterSource: 'ble' });
    renderWithProviders(<SettingsScreen resetAppData={resetAllAppData} />);
    openDeveloper();
    expect(screen.queryByTestId('settings-spp')).toBeNull();

    fireEvent.press(screen.getByText('Classic Bluetooth'));

    await waitFor(() => expect(useSettingsStore.getState().adapterSource).toBe('spp'));
    expect(screen.getByTestId('settings-spp')).toHaveTextContent(/PIN 1234 or 0000/);
    expect(screen.getByTestId('settings-spp')).toHaveTextContent(/bus sniffer is not available/);
    expect(screen.queryByTestId('settings-wifi')).toBeNull();
  });

  it('on iOS, there is no Classic Bluetooth segment', () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    useSettingsStore.setState({ adapterSource: 'ble' });
    renderWithProviders(<SettingsScreen resetAppData={resetAllAppData} />);
    openDeveloper();
    expect(screen.getByText('Wi-Fi adapter')).toBeTruthy();
    expect(screen.queryByText('Classic Bluetooth')).toBeNull();
  });
});

describe('Settings in the browser (plan 28)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('offers no Wi-Fi or Classic Bluetooth source, and says the AI key is memory-only', () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    useSettingsStore.setState({ adapterSource: 'ble' });
    renderWithProviders(<SettingsScreen resetAppData={resetAllAppData} />);
    fireEvent.press(screen.getByText('Anthropic'));
    expect(screen.getByTestId('settings-ai-key-web')).toHaveTextContent(/never saved/);
    expect(screen.queryByText(/secure keystore, never in backups/)).toBeNull();
    openDeveloper();
    expect(screen.getByText('Real adapter (Bluetooth)')).toBeTruthy();
    expect(screen.getByText('Simulator (no car)')).toBeTruthy();
    expect(screen.queryByText('Wi-Fi adapter')).toBeNull();
    expect(screen.queryByText('Classic Bluetooth')).toBeNull();
  });
});

describe('Settings → Privacy: crash reports (plan 31)', () => {
  afterEach(() => jest.restoreAllMocks());

  const sdkDouble = () => ({
    init: jest.fn(),
    captureException: jest.fn(),
    addBreadcrumb: jest.fn(),
    close: jest.fn(),
  });

  it('a build without a crash-service address: off, disabled, "Unavailable in this build"', () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    renderWithProviders(<SettingsScreen />);
    expect(screen.getByText('Send anonymous crash reports')).toBeTruthy();
    expect(screen.getByTestId('crash-reports-unavailable')).toHaveTextContent(
      'Unavailable in this build.',
    );
    fireEvent.press(screen.getByLabelText('Send anonymous crash reports'));
    expect(alert).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().crashReports).toBe(false);
  });

  it('says what a report holds and never holds, and links the privacy policy', () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    renderWithProviders(<SettingsScreen />);
    expect(screen.getByTestId('settings-privacy')).toHaveTextContent(
      /the app removes your VIN, adapter name and address, and AI server address and key/,
    );
    // Native crashes skip the scrubber: the text says so, as the privacy policy does.
    expect(screen.getByTestId('settings-privacy')).toHaveTextContent(
      /system code is sent without that clean-up and could, rarely, include a Bluetooth adapter's address/,
    );
    expect(screen.getByTestId('settings-privacy')).toHaveTextContent(
      /Reports never contain trip data or location/,
    );
    fireEvent.press(screen.getByText('Read the privacy policy'));
    expect(open).toHaveBeenCalledWith(PRIVACY_POLICY_URL);
  });

  it('switching on asks first: Cancel keeps it off, Turn on switches it on; Off switches it off', () => {
    setCrashReportingDsn('https://key@o1.ingest.de.sentry.io/2');
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    renderWithProviders(<SettingsScreen />);
    expect(screen.queryByTestId('crash-reports-unavailable')).toBeNull();

    fireEvent.press(screen.getByLabelText('Send anonymous crash reports'));
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls[0][0]).toBe('Send anonymous crash reports?');
    expect(alert.mock.calls[0][1]).toMatch(/the app removes your VIN/);
    // Cancel only closes the dialog: still off.
    const buttons = alert.mock.calls[0][2] as AlertButtons;
    expect(buttons.map((b) => b.text)).toEqual(['Cancel', 'Turn on']);
    expect(buttons[0].onPress).toBeUndefined();
    expect(useSettingsStore.getState().crashReports).toBe(false);

    fireEvent.press(screen.getByLabelText('Send anonymous crash reports'));
    act(() => pressAlertButton(alert, 1, 'Turn on'));
    expect(useSettingsStore.getState().crashReports).toBe(true);

    fireEvent.press(screen.getByLabelText('Send anonymous crash reports'));
    expect(useSettingsStore.getState().crashReports).toBe(false);
  });

  it('Send test crash report is disabled while off and sends one scrubbable event while on', async () => {
    setCrashReportingDsn('https://key@o1.ingest.de.sentry.io/2');
    const sdk = sdkDouble();
    setCrashReportingModuleLoader(async () => sdk);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

    renderWithProviders(<SettingsScreen />);
    openDeveloper();
    fireEvent.press(screen.getByText('Send test crash report'));
    expect(sdk.captureException).not.toHaveBeenCalled();

    useSettingsStore.setState({ crashReports: true });
    await act(async () => {
      await startCrashReporting(true);
    });
    expect(getCrashReportingStatus()).toBe('on');
    await act(async () => {
      fireEvent.press(screen.getByText('Send test crash report'));
      await crashReportingReady();
    });
    await waitFor(() => expect(sdk.captureException).toHaveBeenCalledTimes(1));
    expect((sdk.captureException.mock.calls[0][0] as Error).message).toBe(TEST_REPORT_MESSAGE);
    expect(alert).toHaveBeenCalledWith('Test crash report', expect.stringMatching(/^Sent\./));
  });
});

describe('SettingsScreen language (plan 11)', () => {
  it('renders in Romanian: the Theme label reads Temă', async () => {
    await act(async () => {
      await i18n.changeLanguage('ro');
    });
    renderWithProviders(<SettingsScreen />);
    expect(screen.getAllByText('Temă').length).toBeGreaterThan(0);
    expect(screen.getByText('Setări')).toBeTruthy();
    expect(screen.queryByText('Theme')).toBeNull();
  });

  it('offers System / English / Română and switches the language live, without a restart', async () => {
    renderWithProviders(<SettingsScreen />);
    expect(screen.getAllByText('Theme').length).toBeGreaterThan(0);
    expect(useSettingsStore.getState().language).toBe('system');
    expect(screen.getByText('Phone language')).toBeTruthy();

    fireEvent.press(screen.getByText('Română'));
    expect(useSettingsStore.getState().language).toBe('ro');
    await waitFor(() => expect(screen.getAllByText('Temă').length).toBeGreaterThan(0));
    expect(i18n.language).toBe('ro');

    fireEvent.press(screen.getByText('English'));
    await waitFor(() => expect(screen.getAllByText('Theme').length).toBeGreaterThan(0));
    expect(useSettingsStore.getState().language).toBe('en');
  });
});
