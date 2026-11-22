/** Bus sniffer screen over different links (plan 27): the simulator (and BLE / Wi-Fi) offers Start;
 *  a Classic Bluetooth (SPP) session explains that bus monitoring is unavailable instead of failing. */
import React from 'react';
import { act, screen } from '@testing-library/react-native';
import { renderWithProviders } from '@test/renderWithProviders';
import { connectSimulator } from '@test/simulator';
import { useSettingsStore } from '@/shared/state/settingsStore';
import { useSessionStore } from '@/shared/state/sessionStore';
import { connect, setSppModuleLoader } from '@/features/connection/api/connectionService';
import { bridgeToMock } from '@/shared/obd-core/transport/testing/bridge';
import { buildScenario } from '@/shared/obd-core/transport/scenarios';
import { FakeSppModule, sppDeviceOverBridge } from '@/shared/transports/spp/testing/fakeSppModule';
import { SnifferScreen } from './SnifferScreen';

describe('SnifferScreen', () => {
  afterEach(() => setSppModuleLoader(undefined));

  it('offers Start monitoring over a link that can stream the monitor', async () => {
    await connectSimulator();
    renderWithProviders(<SnifferScreen />);
    expect(screen.getByText('Start monitoring')).toBeTruthy();
    expect(screen.queryByTestId('sniffer-unavailable')).toBeNull();
  });

  it('over Classic Bluetooth explains that bus monitoring is unavailable', async () => {
    const mod = new FakeSppModule(() =>
      sppDeviceOverBridge(bridgeToMock(buildScenario('golf-plus-2009-20tdi'))),
    );
    setSppModuleLoader(async () => mod);
    useSettingsStore.setState({ adapterSource: 'spp', injectedDtcs: [] });
    await act(async () => {
      await connect({ deviceId: '00:1D:A5:68:98:8B', deviceName: 'OBDII' });
    });
    expect(useSessionStore.getState().status).toBe('connected');

    renderWithProviders(<SnifferScreen />);
    expect(screen.getByTestId('sniffer-unavailable')).toHaveTextContent(
      /Bus monitoring is not available over this adapter link/,
    );
    expect(screen.getByText(/Use a Bluetooth LE or Wi-Fi adapter to sniff the bus/)).toBeTruthy();
    expect(screen.queryByText('Start monitoring')).toBeNull();
  });
});
