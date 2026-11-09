/** Extended PIDs screen (plan 14): live values without a manual read, the Golf label pack's three
 *  measuring groups (resolved from the simulated engine part number), "Chart group" / "Chart this"
 *  adding chart panels, "Log group" recording only that group's DIDs, cards going back to live
 *  values once a log stops, and no DID registration while the screen is not focused. */
import React from 'react';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { renderWithProviders } from '@test/renderWithProviders';
import { connectSimulator, settleFirstPollSweep } from '@test/simulator';
import { CONFIRMED_TEXT, ILLUSTRATIVE_TEXT, confirmItems } from '@test/confirmation';
import { getVehicleProfile } from '@/shared/vehicles';
import { mockPush, setMockFocused } from '@test/mocks/router';
import { useSessionStore } from '@/shared/state/sessionStore';
import { useVehicleStore } from '@/shared/state/vehicleStore';
import { useChartsStore } from '@/shared/state/chartsStore';
import { useLiveDataStore } from '@/shared/state/liveDataStore';
import { EngineHost } from '@/features/engine-host';
import { getMeasuringLog } from '../api/measuringLog';
import { ExtendedPidsScreen } from './ExtendedPidsScreen';

async function golf() {
  useVehicleStore.setState({ selectedProfileId: 'golf-plus-2009-20tdi' });
  await connectSimulator({ vehicleId: 'golf-plus-2009-20tdi' });
  renderWithProviders(
    <>
      <EngineHost />
      <ExtendedPidsScreen />
    </>,
  );
  // The focused screen registers its DIDs, so the poll loop sweeps at once: settle it in act().
  await settleFirstPollSweep();
}

describe('ExtendedPidsScreen', () => {
  it('reads the engine part number once at connect (F187)', async () => {
    useVehicleStore.setState({ selectedProfileId: 'golf-plus-2009-20tdi' });
    await connectSimulator({ vehicleId: 'golf-plus-2009-20tdi' });
    expect(useSessionStore.getState().info?.partNumber).toBe('03L906022LM');
  });

  it('shows live values and the three measuring groups', async () => {
    await golf();
    expect(screen.getByTestId('group-075')).toBeTruthy();
    expect(screen.getByTestId('group-099')).toBeTruthy();
    expect(screen.getByTestId('group-120')).toBeTruthy();
    expect(screen.getByText('Group 075 · Diesel particulate filter')).toBeTruthy();
    // Live: the soot mass shows up from the poll loop without pressing "Read extended PIDs".
    await waitFor(() => expect(screen.getByText('12 g')).toBeTruthy(), { timeout: 4000 });
  });

  it('Chart group opens Charts with a 4-series panel of that group', async () => {
    await golf();
    const before = useChartsStore.getState().panels.length;
    fireEvent.press(within(screen.getByTestId('group-075')).getByText('Chart group'));
    const panels = useChartsStore.getState().panels;
    expect(panels).toHaveLength(before + 1);
    expect(panels[panels.length - 1].pids).toEqual(['22:1701', '22:1702', '22:1704', '22:1705']);
    expect(mockPush).toHaveBeenCalledWith('/charts');
  });

  it('Chart this adds a one-series panel', async () => {
    await golf();
    fireEvent.press(screen.getAllByText('Chart this')[0]);
    const panels = useChartsStore.getState().panels;
    expect(panels[panels.length - 1]).toEqual({ id: 'p3', pids: ['22:1701'], windowMs: 60_000 });
  });

  it('Log group records only that group', async () => {
    await golf();
    fireEvent.press(within(screen.getByTestId('group-099')).getByText('Log group'));
    // One full sweep (both DIDs) — then every row belongs to the group.
    await waitFor(() => expect(getMeasuringLog().length).toBeGreaterThanOrEqual(2), {
      timeout: 4000,
    });
    const dids = new Set(getMeasuringLog().map((r) => r.did));
    expect([...dids].sort()).toEqual(['1706', '1707']);
  });

  it('shows no groups for a part number with no label pack', async () => {
    useVehicleStore.setState({ selectedProfileId: 'golf-plus-2009-20tdi' });
    await connectSimulator({ vehicleId: 'golf-plus-2009-20tdi' });
    act(() => {
      const s = useSessionStore.getState();
      if (s.info) useSessionStore.setState({ info: { ...s.info, partNumber: '1K0907379AC' } });
    });
    renderWithProviders(<ExtendedPidsScreen />);
    expect(screen.queryByText('Measuring groups')).toBeNull();
    expect(screen.getAllByText('Chart this').length).toBeGreaterThan(0);
  });

  it('cards show live values again once a log has stopped', async () => {
    useVehicleStore.setState({ selectedProfileId: 'golf-plus-2009-20tdi' });
    await connectSimulator({ vehicleId: 'golf-plus-2009-20tdi' });
    renderWithProviders(<ExtendedPidsScreen />);
    fireEvent.press(within(screen.getByTestId('group-099')).getByText('Log group'));
    await waitFor(() => expect(getMeasuringLog().length).toBeGreaterThanOrEqual(2), {
      timeout: 4000,
    });
    await act(async () => {
      fireEvent.press(screen.getByText('Stop & share CSV'));
    });
    await waitFor(() => expect(screen.getByText('Start log')).toBeTruthy());
    // A later poll sweep: the per-DID card follows it instead of the frozen logged value.
    act(() => {
      useLiveDataStore.setState({
        values: {
          '22:1706': {
            pid: '22:1706',
            name: 'Exhaust gas temp (DPF)',
            unit: '°C',
            value: 777,
            ts: 1,
          },
        },
      });
    });
    expect(screen.getAllByText('777 °C').length).toBeGreaterThan(0);
  });

  it('registers no DID with the poll loop while not focused', async () => {
    setMockFocused(false);
    useVehicleStore.setState({ selectedProfileId: 'golf-plus-2009-20tdi' });
    await connectSimulator({ vehicleId: 'golf-plus-2009-20tdi' });
    renderWithProviders(<ExtendedPidsScreen />);
    const keys = Object.values(useLiveDataStore.getState().registrations).flat();
    expect(keys.filter((k) => k.startsWith('22:'))).toEqual([]);
  });

  it('registers every declared DID while focused', async () => {
    useVehicleStore.setState({ selectedProfileId: 'golf-plus-2009-20tdi' });
    await connectSimulator({ vehicleId: 'golf-plus-2009-20tdi' });
    renderWithProviders(<ExtendedPidsScreen />);
    const keys = Object.values(useLiveDataStore.getState().registrations).flat();
    expect(keys).toContain('22:1701');
  });

  it('badges each DID: illustrative, or confirmed once it carries evidence (plan 25)', async () => {
    const pids = getVehicleProfile('golf-plus-2009-20tdi').extendedPids!;
    const soot = pids.find((p) => p.did === '1701')!;
    const load = pids.find((p) => p.did === '1702')!;
    const undo = confirmItems([soot]);
    try {
      await golf();
      expect(within(screen.getByTestId('verify-1701')).getByText(CONFIRMED_TEXT)).toBeTruthy();
      expect(
        within(screen.getByTestId(`verify-${load.did}`)).getByText(ILLUSTRATIVE_TEXT),
      ).toBeTruthy();
      expect(screen.queryByText('EXPERIMENTAL')).toBeNull();
    } finally {
      undo();
    }
  });
});
