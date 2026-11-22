import React from 'react';
import { Linking, Platform } from 'react-native';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderWithProviders } from '@test/renderWithProviders';
import { mockPush } from '@test/mocks/router';
import { useSettingsStore } from '@/shared/state/settingsStore';
import { useSessionStore } from '@/shared/state/sessionStore';
import * as bleManager from '@/shared/transports/ble/manager';
import { FakeSocket } from '@/shared/transports/tcp/testing/fakeSocket';
import { setSppModuleLoader, setTcpSocketFactory, setWebBluetooth } from '../api/connectionService';
import {
  FakeWebBluetooth,
  namedError,
  webDeviceOverBridge,
} from '@/shared/transports/web-ble/testing/fakeWebBluetooth';
import { bridgeToMock } from '@/shared/obd-core/transport/testing/bridge';
import { buildScenario } from '@/shared/obd-core/transport/scenarios';
import { FakeSppModule, sppDeviceOverBridge } from '@/shared/transports/spp/testing/fakeSppModule';
import { SPP_FALLBACK_NOTICE } from '@/shared/state/settingsStore';
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

  describe('iOS (plan 09)', () => {
    afterEach(() => jest.restoreAllMocks());

    it('shows the iOS scan hint and no Android-only connect-by-address panel or copy', () => {
      jest.replaceProperty(Platform, 'OS', 'ios');
      useSettingsStore.setState({ adapterSource: 'ble' });
      renderWithProviders(<ConnectionScreen />);

      expect(screen.getByTestId('ios-scan-hint')).toHaveTextContent(
        /iOS does not pair OBD2 BLE adapters in Settings/,
      );
      expect(screen.queryByText('Connect by address')).toBeNull();
      expect(screen.queryByPlaceholderText('AA:BB:CC:DD:EE:FF')).toBeNull();
      expect(screen.queryByText(/Android/)).toBeNull();
      expect(screen.getByText(/No devices yet/)).toBeTruthy();
    });

    it('Android keeps connect-by-address and shows no iOS hint', () => {
      jest.replaceProperty(Platform, 'OS', 'android');
      useSettingsStore.setState({ adapterSource: 'ble' });
      renderWithProviders(<ConnectionScreen />);

      expect(screen.getByText('Connect by address')).toBeTruthy();
      expect(screen.queryByTestId('ios-scan-hint')).toBeNull();
      expect(screen.getByText(/Android’s Bluetooth settings/)).toBeTruthy();
    });
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

  describe('Classic Bluetooth adapter (plan 27)', () => {
    const ADDR = '00:1D:A5:68:98:8B';
    let mod: FakeSppModule;

    beforeEach(() => {
      jest.replaceProperty(Platform, 'OS', 'android');
      mod = new FakeSppModule(() =>
        sppDeviceOverBridge(bridgeToMock(buildScenario('golf-plus-2009-20tdi'))),
      );
      setSppModuleLoader(async () => mod);
    });
    afterEach(() => {
      setSppModuleLoader(undefined);
      jest.restoreAllMocks();
    });

    it('lists the paired adapters and connects to the picked one', async () => {
      mod.bonded = [
        { address: '11:11:11:11:11:11', name: 'Headphones' },
        { address: ADDR, name: 'OBDII' },
      ];
      const spy = jest.spyOn(bleManager, 'getBleManager');
      useSettingsStore.setState({ adapterSource: 'spp', injectedDtcs: [] });
      renderWithProviders(<ConnectionScreen />);

      expect(screen.getByTestId('connect-spp')).toBeTruthy();
      expect(screen.getByText('Connect to your paired classic Bluetooth adapter')).toBeTruthy();
      expect(await screen.findByLabelText('Connect to OBDII')).toBeTruthy();
      expect(screen.getByText('Headphones')).toBeTruthy();
      expect(screen.queryByText('Scan for adapters')).toBeNull();
      expect(screen.queryByTestId('connect-spp-empty')).toBeNull();

      // Likely adapters first.
      const rows = screen.getAllByLabelText(/^Connect to /);
      expect(rows.map((r) => r.props.accessibilityLabel)).toEqual([
        'Connect to OBDII',
        'Connect to Headphones',
      ]);
      fireEvent.press(screen.getByLabelText('Connect to OBDII'));
      await waitFor(() => expect(useSessionStore.getState().status).toBe('connected'), {
        timeout: 10000,
      });
      expect(useSessionStore.getState().deviceId).toBe(ADDR);
      expect(mod.connects[0].opts).toEqual({ delimiter: '>', charset: 'ascii' });
      expect(mockPush).toHaveBeenCalledWith('/vehicle');
      // Classic Bluetooth never touches the BLE stack.
      expect(spy).not.toHaveBeenCalled();
    });

    it('without a paired adapter shows the pairing guidance and opens Bluetooth settings', async () => {
      useSettingsStore.setState({ adapterSource: 'spp' });
      renderWithProviders(<ConnectionScreen />);

      expect(await screen.findByTestId('connect-spp-empty')).toBeTruthy();
      expect(screen.getByText(/Pair the adapter first: Android Settings → Bluetooth/)).toBeTruthy();
      expect(screen.getByText(/PIN 1234 or 0000/)).toBeTruthy();

      fireEvent.press(screen.getByText('Open Bluetooth settings'));
      expect(Linking.sendIntent).toHaveBeenCalledWith('android.settings.BLUETOOTH_SETTINGS');

      // Paired meanwhile: Refresh lists it.
      mod.bonded = [{ address: ADDR, name: 'OBDII' }];
      fireEvent.press(screen.getByText('Refresh'));
      expect(await screen.findByLabelText('Connect to OBDII')).toBeTruthy();
      expect(screen.queryByTestId('connect-spp-empty')).toBeNull();
    });

    it('explains why the list is empty when Bluetooth is off', async () => {
      mod.enabled = false;
      useSettingsStore.setState({ adapterSource: 'spp' });
      renderWithProviders(<ConnectionScreen />);

      expect(await screen.findByTestId('connect-spp-error')).toHaveTextContent(/Bluetooth is off/);
      expect(screen.queryByTestId('connect-spp-empty')).toBeNull();
    });

    it('an unreachable paired adapter shows the power-cycle / other-app diagnosis', async () => {
      setSppModuleLoader(async () => {
        const failing = new FakeSppModule(() => {
          throw new Error('read failed, socket might closed or timeout, read ret: -1');
        });
        failing.bonded = [{ address: ADDR, name: 'OBDII' }];
        return failing;
      });
      useSettingsStore.setState({ adapterSource: 'spp' });
      renderWithProviders(<ConnectionScreen />);

      fireEvent.press(await screen.findByLabelText('Connect to OBDII'));
      expect(await screen.findByText('Can’t open the Classic Bluetooth adapter')).toBeTruthy();
      expect(screen.getByText('Classic Bluetooth link')).toBeTruthy();
      expect(screen.getByText(/no other app \(e\.g\. Torque\)/)).toBeTruthy();
      expect(mockPush).not.toHaveBeenCalled();
    });

    it('switches between Bluetooth LE and Classic Bluetooth on Android', async () => {
      useSettingsStore.setState({ adapterSource: 'ble' });
      renderWithProviders(<ConnectionScreen />);

      fireEvent.press(screen.getByText('Using a classic Bluetooth (3.0) adapter instead?'));
      await waitFor(() => expect(useSettingsStore.getState().adapterSource).toBe('spp'));
      fireEvent.press(await screen.findByText('Use a Bluetooth LE adapter'));
      await waitFor(() => expect(useSettingsStore.getState().adapterSource).toBe('ble'));
    });

    it('offers no Classic Bluetooth link on iOS', () => {
      jest.replaceProperty(Platform, 'OS', 'ios');
      useSettingsStore.setState({ adapterSource: 'ble' });
      renderWithProviders(<ConnectionScreen />);
      expect(screen.getByText('Using a Wi-Fi adapter instead?')).toBeTruthy();
      expect(screen.queryByText('Using a classic Bluetooth (3.0) adapter instead?')).toBeNull();
    });

    it('shows the one-time fallback notice until dismissed', () => {
      useSettingsStore.setState({ adapterSource: 'ble', adapterSourceNotice: SPP_FALLBACK_NOTICE });
      renderWithProviders(<ConnectionScreen />);
      expect(screen.getByTestId('adapter-source-notice')).toHaveTextContent(/work only on Android/);
      fireEvent.press(screen.getByText('OK'));
      expect(screen.queryByTestId('adapter-source-notice')).toBeNull();
      expect(useSettingsStore.getState().adapterSourceNotice).toBeNull();
    });
  });

  describe('Web Bluetooth in the browser (plan 28)', () => {
    let bt: FakeWebBluetooth;
    beforeEach(() => {
      jest.replaceProperty(Platform, 'OS', 'web');
      bt = new FakeWebBluetooth(
        webDeviceOverBridge(bridgeToMock(buildScenario('golf-plus-2009-20tdi'))),
      );
      setWebBluetooth(bt);
      useSettingsStore.setState({ adapterSource: 'ble' });
    });
    afterEach(() => {
      setWebBluetooth(undefined);
      jest.restoreAllMocks();
    });

    it('offers one Choose adapter & connect button and the browser note — no scan, no address', () => {
      const spy = jest.spyOn(bleManager, 'getBleManager');
      renderWithProviders(<ConnectionScreen />);
      expect(screen.getByText('Choose adapter & connect')).toBeTruthy();
      expect(screen.getByTestId('web-bt-note')).toHaveTextContent(/Chrome and Edge/);
      expect(screen.queryByText('Scan for adapters')).toBeNull();
      expect(screen.queryByText('Connect by address')).toBeNull();
      expect(screen.queryByText('Using a Wi-Fi adapter instead?')).toBeNull();
      // ble-plx is never touched in the browser (its radio state hook stays disabled).
      expect(spy).not.toHaveBeenCalled();
    });

    it('picks the adapter in the browser chooser and connects to it', async () => {
      renderWithProviders(<ConnectionScreen />);
      fireEvent.press(screen.getByText('Choose adapter & connect'));
      await waitFor(() => expect(useSessionStore.getState().status).toBe('connected'), {
        timeout: 10000,
      });
      expect(bt.requests).toHaveLength(1);
      expect(useSessionStore.getState().deviceName).toBe('IOS-Vlink');
      expect(mockPush).toHaveBeenCalledWith('/vehicle');
    });

    it('a cancelled chooser shows a clean message, not a crash or the failure panel', async () => {
      bt.error = namedError('NotFoundError', 'User cancelled the requestDevice() chooser.');
      renderWithProviders(<ConnectionScreen />);
      fireEvent.press(screen.getByText('Choose adapter & connect'));
      expect(await screen.findByText(/No adapter was chosen/)).toBeTruthy();
      expect(useSessionStore.getState().status).toBe('disconnected');
      expect(screen.getByText('Choose adapter & connect')).toBeTruthy();
    });

    it('a browser without Web Bluetooth shows the not-supported panel and keeps the simulator', async () => {
      setWebBluetooth(null);
      renderWithProviders(<ConnectionScreen />);
      expect(screen.getByTestId('web-bt-unsupported')).toHaveTextContent(/Safari, Firefox/);
      expect(screen.queryByText('Choose adapter & connect')).toBeNull();
      fireEvent.press(screen.getByText('Use the simulator'));
      await waitFor(() => expect(useSettingsStore.getState().adapterSource).toBe('mock'));
      expect(await screen.findByText('Connect to simulator')).toBeTruthy();
    });
  });
});
