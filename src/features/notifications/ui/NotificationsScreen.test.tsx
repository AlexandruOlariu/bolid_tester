/** The notification permission flow (plan 09). iOS shows the system prompt exactly once; after a
 *  denial `requestPermissionsAsync` does nothing, so the screen reads the live state on open and,
 *  when the OS will not ask again, offers "Open settings" instead of a dead "Enable" button. */
import React from 'react';
import { Linking, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderWithProviders } from '@test/renderWithProviders';
import { setNotificationsModuleLoader } from '@/shared/notify';
import { useNotificationsStore } from '../model/notificationsStore';
import { NotificationsScreen } from './NotificationsScreen';

const getPerms = Notifications.getPermissionsAsync as unknown as jest.Mock;
const requestPerms = Notifications.requestPermissionsAsync as unknown as jest.Mock;

const UNDETERMINED = { granted: false, status: 'undetermined', canAskAgain: true };
const DENIED = { granted: false, status: 'denied', canAskAgain: false };
const GRANTED = { granted: true, status: 'granted', canAskAgain: true };

// Jest cannot run the service's dynamic import, so hand it the setup's expo-notifications mock.
beforeEach(() => setNotificationsModuleLoader(async () => Notifications));
afterEach(() => {
  setNotificationsModuleLoader(undefined);
  jest.restoreAllMocks();
});

describe('NotificationsScreen permission', () => {
  it('reads an existing grant on open without prompting', async () => {
    getPerms.mockResolvedValue(GRANTED);
    renderWithProviders(<NotificationsScreen />);

    expect(await screen.findByText('Notifications enabled.')).toBeTruthy();
    expect(requestPerms).not.toHaveBeenCalled();
  });

  it('prompts once; after the denial it offers Open settings and never prompts again', async () => {
    getPerms.mockResolvedValue(UNDETERMINED);
    requestPerms.mockImplementation(async () => {
      getPerms.mockResolvedValue(DENIED);
      return DENIED;
    });
    const open = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    renderWithProviders(<NotificationsScreen />);

    fireEvent.press(await screen.findByText('Enable notifications'));
    expect(await screen.findByTestId('notifications-denied')).toBeTruthy();
    expect(requestPerms).toHaveBeenCalledTimes(1);
    expect(requestPerms).toHaveBeenCalledWith({
      ios: { allowAlert: true, allowSound: true, allowBadge: false },
    });
    expect(screen.queryByText('Enable notifications')).toBeNull();
    expect(useNotificationsStore.getState().permission).toBe('denied');

    fireEvent.press(screen.getByText('Open settings'));
    expect(open).toHaveBeenCalledTimes(1);
    expect(requestPerms).toHaveBeenCalledTimes(1);
  });

  it('a denial already on record shows Open settings straight away', async () => {
    getPerms.mockResolvedValue(DENIED);
    renderWithProviders(<NotificationsScreen />);

    expect(await screen.findByTestId('notifications-denied')).toBeTruthy();
    expect(screen.queryByText('Enable notifications')).toBeNull();
    expect(requestPerms).not.toHaveBeenCalled();
  });

  it('on web a denial shows browser wording and no Open settings button', async () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    getPerms.mockResolvedValue(DENIED);
    renderWithProviders(<NotificationsScreen />);

    expect(await screen.findByTestId('notifications-denied-web')).toBeTruthy();
    expect(screen.queryByTestId('notifications-denied')).toBeNull();
    expect(screen.queryByText('Open settings')).toBeNull();
    expect(screen.queryByText('Enable notifications')).toBeNull();
  });

  it('a grant from the prompt shows the enabled state', async () => {
    getPerms.mockResolvedValue(UNDETERMINED);
    requestPerms.mockResolvedValue(GRANTED);
    renderWithProviders(<NotificationsScreen />);

    fireEvent.press(await screen.findByText('Enable notifications'));
    await waitFor(() => expect(screen.getByText('Notifications enabled.')).toBeTruthy());
    expect(useNotificationsStore.getState().permission).toBe('granted');
  });
});
