import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderWithProviders } from '@test/renderWithProviders';
import { connectSimulator } from '@test/simulator';
import { useSettingsStore } from '@/shared/state/settingsStore';
import { useSessionStore } from '@/shared/state/sessionStore';
import { SettingsScreen } from './SettingsScreen';

describe('SettingsScreen', () => {
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
});
