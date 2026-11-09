import React from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderWithProviders } from '@test/renderWithProviders';
import { mockPush } from '@test/mocks/router';
import { useSettingsStore } from '@/shared/state/settingsStore';
import { useSessionStore } from '@/shared/state/sessionStore';
import * as bleManager from '@/shared/transports/ble/manager';
import { FakeSocket } from '@/shared/transports/tcp/testing/fakeSocket';
import { setTcpSocketFactory } from '../api/connectionService';
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

  describe('Wi-Fi adapter (plan 26)', () => {
    afterEach(() => setTcpSocketFactory(undefined));

    it('shows the join-the-network guidance, the endpoint and Connect, with no BLE scan', () => {
      useSettingsStore.setState({
        adapterSource: 'wifi',
        wifi: { host: '192.168.0.10', port: 35000 },
      });
      renderWithProviders(<ConnectionScreen />);

      expect(screen.getByTestId('connect-wifi')).toBeTruthy();
      expect(screen.getByText('Connect over Wi-Fi')).toBeTruthy();
      expect(screen.getByTestId('connect-wifi-endpoint')).toHaveTextContent('192.168.0.10:35000');
      expect(screen.getByText(/Join the adapter’s Wi-Fi network first/)).toBeTruthy();
      expect(screen.queryByText('Scan for adapters')).toBeNull();
      expect(screen.getByText('Connect to your Wi-Fi OBD2 adapter')).toBeTruthy();
    });

    it('never constructs a BleManager unless Bluetooth is selected', () => {
      const spy = jest.spyOn(bleManager, 'getBleManager');
      try {
        useSettingsStore.setState({ adapterSource: 'mock' });
        const first = renderWithProviders(<ConnectionScreen />);
        act(() => {
          useSettingsStore.setState({ adapterSource: 'wifi' });
        });
        expect(screen.getByText('Connect over Wi-Fi')).toBeTruthy();
        // Leaving the screen runs the scan hook's cleanup, which must not reach for Bluetooth either.
        first.unmount();
        expect(spy).not.toHaveBeenCalled();

        renderWithProviders(<ConnectionScreen />);
        expect(screen.getByText('Connect over Wi-Fi')).toBeTruthy();
        expect(spy).not.toHaveBeenCalled();

        act(() => {
          useSettingsStore.setState({ adapterSource: 'ble' });
        });
        expect(screen.getByText('Scan for adapters')).toBeTruthy();
        expect(spy).toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    });

    it('a Wi-Fi connect with no adapter reachable shows the network suggestion', async () => {
      setTcpSocketFactory(async () => {
        const socket = new FakeSocket();
        setTimeout(() => socket.emitError(new Error('connect ECONNREFUSED 192.168.0.10:35000')), 0);
        return socket;
      });
      useSettingsStore.setState({
        adapterSource: 'wifi',
        wifi: { host: '192.168.0.10', port: 35000 },
      });
      renderWithProviders(<ConnectionScreen />);

      fireEvent.press(screen.getByText('Connect over Wi-Fi'));

      expect(await screen.findByText('Can’t reach the Wi-Fi adapter')).toBeTruthy();
      expect(screen.getByText('Wi-Fi link')).toBeTruthy();
      expect(screen.getByText(/most use 192\.168\.0\.10, port 35000/)).toBeTruthy();
      expect(useSessionStore.getState().status).toBe('error');
      expect(mockPush).not.toHaveBeenCalled();
    });

    it('switches between Bluetooth and Wi-Fi from the Connect screen', async () => {
      useSettingsStore.setState({ adapterSource: 'ble' });
      renderWithProviders(<ConnectionScreen />);

      fireEvent.press(screen.getByText('Using a Wi-Fi adapter instead?'));
      await waitFor(() => expect(useSettingsStore.getState().adapterSource).toBe('wifi'));
      fireEvent.press(await screen.findByText('Use a Bluetooth adapter'));
      await waitFor(() => expect(useSettingsStore.getState().adapterSource).toBe('ble'));
    });
  });
});
