/** The Settings → Developer & simulator route (`src/app/settings-developer.tsx`) composes the page
 *  with the backup slice's **Reset all app data** (plan 07 review): features never import the backup
 *  slice, so the app layer hands the action in. Lives under test/ because expo-router would treat a
 *  `*.test.tsx` inside src/app as a route. */
import React from 'react';
import { screen } from '@testing-library/react-native';
import { renderWithProviders } from '@test/renderWithProviders';
import SettingsDeveloperRoute from '@/app/settings-developer';

describe('Settings → Developer & simulator route', () => {
  it('offers Reset all app data (the backup slice action is wired in)', () => {
    renderWithProviders(<SettingsDeveloperRoute />);
    expect(screen.getByText('Reset all app data')).toBeTruthy();
    expect(screen.getByText('Show hints again')).toBeTruthy();
  });
});
