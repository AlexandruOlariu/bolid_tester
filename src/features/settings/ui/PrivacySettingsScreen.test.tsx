/** Settings → Privacy (plan 31, `/settings-privacy`): the opt-in crash-report switch, its text and
 *  the privacy-policy link. */
import React from 'react';
import { Alert, Linking } from 'react-native';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { renderWithProviders } from '@test/renderWithProviders';
import { useSettingsStore } from '@/shared/state/settingsStore';
import { setCrashReportingDsn } from '@/shared/telemetry/crashReporting';
import { PRIVACY_POLICY_URL } from '@/shared/lib/appInfo';
import { PrivacySettingsScreen } from './PrivacySettingsScreen';

type AlertButtons = { text?: string; onPress?: () => void }[];

/** Press `text` in the buttons of the `index`-th `Alert.alert` call. */
function pressAlertButton(alert: jest.SpyInstance, index: number, text: string) {
  const buttons = alert.mock.calls[index][2] as AlertButtons;
  const button = buttons.find((b) => b.text === text);
  if (!button?.onPress) throw new Error(`no "${text}" button in alert ${index}`);
  button.onPress();
}

describe('Settings → Privacy: crash reports (plan 31)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('a build without a crash-service address: off, disabled, "Unavailable in this build"', () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    renderWithProviders(<PrivacySettingsScreen />);
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
    renderWithProviders(<PrivacySettingsScreen />);
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
    renderWithProviders(<PrivacySettingsScreen />);
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
});
