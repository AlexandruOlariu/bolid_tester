/** The Settings route (`src/app/settings.tsx`) composes the Settings screen with the backup slice's
 *  **Reset all app data** (plan 07 review): features never import the backup slice, so the app
 *  layer hands the action in. Lives under test/ because expo-router would treat a `*.test.tsx`
 *  inside src/app as a route. */
import React from 'react';
import { fireEvent, screen } from '@testing-library/react-native';
import { renderWithProviders } from '@test/renderWithProviders';
import SettingsRoute from '@/app/settings';

describe('Settings route', () => {
  it('offers Reset all app data (the backup slice action is wired in)', () => {
    renderWithProviders(<SettingsRoute />);
    fireEvent.press(screen.getByText('Developer & simulator'));
    expect(screen.getByText('Reset all app data')).toBeTruthy();
    expect(screen.getByText('Show hints again')).toBeTruthy();
  });
});
