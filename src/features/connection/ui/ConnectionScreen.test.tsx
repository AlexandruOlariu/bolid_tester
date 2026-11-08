import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderWithProviders } from '@test/renderWithProviders';
import { mockPush } from '@test/mocks/router';
import { useSettingsStore } from '@/shared/state/settingsStore';
import { useSessionStore } from '@/shared/state/sessionStore';
import { ConnectionScreen } from './ConnectionScreen';

describe('ConnectionScreen', () => {
  it('in simulator mode offers "Connect to simulator" and the first-run guide', () => {
    useSettingsStore.setState({ adapterSource: 'mock' });
    renderWithProviders(<ConnectionScreen />);

    expect(screen.getByText('Connect to simulator')).toBeTruthy();
    expect(screen.getByText('Getting started')).toBeTruthy();
    expect(screen.getByText('Disconnected')).toBeTruthy();
    expect(screen.queryByText('Scan for adapters')).toBeNull();
  });

  it('with the real adapter offers "Scan for adapters"', () => {
    useSettingsStore.setState({ adapterSource: 'ble' });
    renderWithProviders(<ConnectionScreen />);

    expect(screen.getByText('Scan for adapters')).toBeTruthy();
    expect(screen.queryByText('Connect to simulator')).toBeNull();
  });

  it('shows the session error in the error panel', () => {
    useSettingsStore.setState({ adapterSource: 'mock' });
    useSessionStore.setState({ status: 'error', error: 'No response from the adapter (ATZ)' });
    renderWithProviders(<ConnectionScreen />);

    expect(screen.getByText('Error')).toBeTruthy();
    expect(screen.getAllByText('No response from the adapter (ATZ)').length).toBeGreaterThan(0);
  });

  it('connects to the simulator for real and moves on to vehicle selection', async () => {
    useSettingsStore.setState({ adapterSource: 'mock', injectedDtcs: [] });
    renderWithProviders(<ConnectionScreen />);

    fireEvent.press(screen.getByText('Connect to simulator'));

    await waitFor(() => expect(useSessionStore.getState().status).toBe('connected'), {
      timeout: 10000,
    });
    expect(await screen.findByText('Connected')).toBeTruthy();
    expect(useSessionStore.getState().info?.vin).toBeTruthy();
    expect(mockPush).toHaveBeenCalledWith('/vehicle');
  });
});
