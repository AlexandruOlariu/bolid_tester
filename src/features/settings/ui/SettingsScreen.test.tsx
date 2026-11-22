/** The Settings hub (plan 07): General and Connection inline, then one row per Settings page with its
 *  current state, then Disconnect while connected. The pages have their own tests
 *  (AiSettingsScreen, PrivacySettingsScreen, DeveloperSettingsScreen, AboutSettingsScreen,
 *  LabelPacksSection, SeedKeysSection). */
import React from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderWithProviders } from '@test/renderWithProviders';
import { mockPush } from '@test/mocks/router';
import { connectSimulator } from '@test/simulator';
import { useSettingsStore } from '@/shared/state/settingsStore';
import { useSessionStore } from '@/shared/state/sessionStore';
import { useSeedKeyStore } from '@/shared/state/seedKeyStore';
import { APP_VERSION } from '@/shared/lib/appInfo';
import { LABEL_PACKS } from '@/shared/labels';
import { setCrashReportingDsn } from '@/shared/telemetry/crashReporting';
import { SettingsScreen } from './SettingsScreen';
import { i18n } from '@/shared/i18n';

/** The hub rows in order: each one button whose name starts with its title. */
const ROWS: [RegExp, string][] = [
  [/^AI assistant\./, '/settings-ai'],
  [/^Notifications\./, '/notifications'],
  [/^Privacy\./, '/settings-privacy'],
  [/^Backup & restore\./, '/backup'],
  [/^Label packs\./, '/settings-label-packs'],
  [/^Security access plugins\./, '/settings-plugins'],
  [/^Developer & simulator\./, '/settings-developer'],
  [/^About\./, '/settings-about'],
];

const rowName = (title: string) =>
  screen.getByRole('button', { name: new RegExp(`^${title}\\.`) }).props.accessibilityLabel;

describe('SettingsScreen (the hub)', () => {
  it('shows General and Connection, then the page rows in order, and nothing of the pages (plan 07)', () => {
    renderWithProviders(<SettingsScreen />);
    const all = screen.UNSAFE_root.findAll(() => true);
    const tops = [
      screen.getByText('General'),
      screen.getByText('Connection'),
      ...ROWS.map(([name]) => screen.getByRole('button', { name })),
    ];
    const positions = tops.map((el) => all.indexOf(el));
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);

    // The pages' controls live on the pages.
    expect(screen.queryByLabelText('AI server URL')).toBeNull();
    expect(screen.queryByText('Simulator (no car)')).toBeNull();
    expect(screen.queryByText('Export as replay fixture')).toBeNull();
    expect(screen.queryByText('Reset all app data')).toBeNull();
    expect(screen.queryByTestId('settings-privacy')).toBeNull();
    expect(screen.queryByTestId('label-packs-section')).toBeNull();
    expect(screen.queryByTestId('seed-keys-section')).toBeNull();
  });

  it('each row opens its page; Backup & restore goes straight to the backup screen', () => {
    renderWithProviders(<SettingsScreen />);
    for (const [name, route] of ROWS) {
      fireEvent.press(screen.getByRole('button', { name }));
      expect(mockPush).toHaveBeenLastCalledWith(route);
    }
  });

  it('the rows show the current state of their page', () => {
    useSettingsStore.setState({ adapterSource: 'mock' });
    renderWithProviders(<SettingsScreen />);
    expect(rowName('AI assistant')).toBe('AI assistant. On · Local server');
    expect(rowName('Notifications')).toBe('Notifications. Alerts, reminders and quiet mode');
    // No crash-service address in the tests.
    expect(rowName('Privacy')).toBe('Privacy. Crash reports unavailable in this build');
    expect(rowName('Label packs')).toBe(`Label packs. ${LABEL_PACKS.length} bundled · 0 imported`);
    expect(rowName('Security access plugins')).toBe('Security access plugins. None installed');
    expect(rowName('Developer & simulator')).toBe('Developer & simulator. Simulator');
    expect(rowName('About')).toBe(`About. v${APP_VERSION}`);

    act(() => {
      useSettingsStore.setState((s) => ({ adapterSource: 'ble', ai: { ...s.ai, enabled: false } }));
      useSeedKeyStore.setState({ plugins: [{}, {}] as never });
    });
    expect(rowName('AI assistant')).toBe('AI assistant. Off');
    expect(rowName('Developer & simulator')).toBe('Developer & simulator. Bluetooth LE');
    expect(rowName('Security access plugins')).toBe('Security access plugins. 2 installed');
  });

  it('the Privacy row says whether crash reports are on', () => {
    setCrashReportingDsn('https://key@o1.ingest.de.sentry.io/2');
    renderWithProviders(<SettingsScreen />);
    expect(rowName('Privacy')).toBe('Privacy. Crash reports off');
    act(() => {
      useSettingsStore.setState({ crashReports: true });
    });
    expect(rowName('Privacy')).toBe('Privacy. Crash reports on');
  });

  it('the theme segment updates the store', () => {
    renderWithProviders(<SettingsScreen />);
    expect(useSettingsStore.getState().theme).toBe('dark');
    expect(screen.getByText('System')).toBeTruthy();
    expect(screen.getByText('Dark')).toBeTruthy();
    fireEvent.press(screen.getByText('Light'));
    expect(useSettingsStore.getState().theme).toBe('light');
  });

  it('segments are radio groups announcing the selected option; on / off settings are switches (plan 20)', () => {
    renderWithProviders(<SettingsScreen />);
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
    const byVin = screen.getByRole('switch', { name: 'Recognise my cars by VIN' });
    expect(byVin).toBeChecked();
    fireEvent.press(byVin);
    expect(useSettingsStore.getState().autoSelectByVin).toBe(false);
  });

  it('each Connection setting has a one-line hint', () => {
    renderWithProviders(<SettingsScreen />);
    expect(screen.getByText('Retry the last adapter after a dropped link.')).toBeTruthy();
    expect(screen.getByText('How often live values are read.')).toBeTruthy();
    expect(screen.getByText('Select a garage car when its VIN connects.')).toBeTruthy();
  });

  it('the app is metric only: General says so and offers no unit choice', () => {
    renderWithProviders(<SettingsScreen />);
    expect(screen.getByText(/Units are metric: km\/h, °C, km, kPa and L\/100 km/)).toBeTruthy();
    expect(screen.queryByText(/mph|°F|miles/i)).toBeNull();
  });

  it('Disconnect shows only while connected and ends the session', async () => {
    const { unmount } = renderWithProviders(<SettingsScreen />);
    expect(screen.queryByText('Disconnect')).toBeNull();
    unmount();

    await connectSimulator();
    renderWithProviders(<SettingsScreen />);
    fireEvent.press(screen.getByText('Disconnect'));
    await waitFor(() => expect(useSessionStore.getState().status).toBe('disconnected'));
    expect(screen.queryByText('Disconnect')).toBeNull();
  });
});

describe('SettingsScreen language (plan 11)', () => {
  it('renders in Romanian: the Theme label reads Temă and the rows are translated', async () => {
    await act(async () => {
      await i18n.changeLanguage('ro');
    });
    renderWithProviders(<SettingsScreen />);
    expect(screen.getAllByText('Temă').length).toBeGreaterThan(0);
    expect(screen.getByText('Setări')).toBeTruthy();
    expect(screen.getByText('Luminoasă')).toBeTruthy();
    expect(screen.queryByText('Theme')).toBeNull();
    expect(rowName('Asistent AI')).toBe('Asistent AI. Activat · Server local');
    expect(rowName('Dezvoltator și simulator')).toBe('Dezvoltator și simulator. Bluetooth LE');
    expect(rowName('Pachete de etichete')).toBe(
      `Pachete de etichete. Incluse: ${LABEL_PACKS.length} · importate: 0`,
    );
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
