/** Settings → About (plans 07, 08, 30, `/settings-about`): the version, then rows for Rate this app,
 *  the privacy policy (expands in place), Report a problem, Licences and the documentation. */
import React from 'react';
import { Linking, Platform } from 'react-native';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderWithProviders } from '@test/renderWithProviders';
import { mockPush } from '@test/mocks/router';
import { APP_VERSION, DOCS_URL } from '@/shared/lib/appInfo';
import { AboutSettingsScreen } from './AboutSettingsScreen';

describe('AboutSettingsScreen', () => {
  it('About shows the app version and opens the privacy policy', () => {
    renderWithProviders(<AboutSettingsScreen />);
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
    renderWithProviders(<AboutSettingsScreen />);
    fireEvent.press(screen.getByLabelText('Open the documentation on GitHub'));
    expect(open).toHaveBeenCalledWith(DOCS_URL);
    open.mockRestore();
  });

  it('About offers Rate this app, the privacy policy, Report a problem and Licences (plan 30)', () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    renderWithProviders(<AboutSettingsScreen />);

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
    renderWithProviders(<AboutSettingsScreen />);
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
    const { unmount } = renderWithProviders(<AboutSettingsScreen />);
    expect(screen.queryByText('Rate this app')).toBeNull();
    expect(screen.getByText('Licences')).toBeTruthy();
    unmount();
    jest.replaceProperty(Platform, 'OS', 'web');
    renderWithProviders(<AboutSettingsScreen />);
    expect(screen.queryByText('Rate this app')).toBeNull();
    jest.restoreAllMocks();
  });
});
