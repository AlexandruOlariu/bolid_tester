/** Charts (plan 14): the panel picker offers the Golf's extended DIDs next to the Mode 01 PIDs, a
 *  picked DID plots live with its label, and a car without DIDs offers none. */
import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderWithProviders } from '@test/renderWithProviders';
import { connectSimulator } from '@test/simulator';
import { useVehicleStore } from '@/shared/state/vehicleStore';
import { useChartsStore } from '@/shared/state/chartsStore';
import { EngineHost } from '@/features/engine-host';
import { ChartsScreen } from './ChartsScreen';

const SOOT = 'DPF soot mass (calc.) (g) · 1701';

async function open(profileId: string) {
  useVehicleStore.setState({ selectedProfileId: profileId });
  await connectSimulator({ vehicleId: profileId });
  renderWithProviders(
    <>
      <EngineHost />
      <ChartsScreen />
    </>,
  );
}

describe('ChartsScreen', () => {
  it('adds a panel for an extended DID that updates from the poll loop', async () => {
    await open('golf-plus-2009-20tdi');
    fireEvent.press(screen.getByText('Add panel'));
    fireEvent.press(screen.getByText(SOOT));
    fireEvent.press(screen.getByText('Add panel'));
    const panels = useChartsStore.getState().panels;
    expect(panels[panels.length - 1].pids).toEqual(['22:1701']);
    // Header + stats line use the label, not the raw key.
    expect(screen.getAllByText(SOOT).length).toBeGreaterThan(0);
    await waitFor(
      () => expect(screen.getByText(`${SOOT}: now 12.0 · min 12.0 · max 12.0`)).toBeTruthy(),
      {
        timeout: 4000,
      },
    );
  });

  it('labels the default Mode 01 panels', async () => {
    await open('golf-plus-2009-20tdi');
    expect(screen.getByText('Engine RPM (rpm)')).toBeTruthy();
  });

  it('offers no extended DIDs on the Punto', async () => {
    await open('fiat-punto-2008-12');
    fireEvent.press(screen.getByText('Add panel'));
    expect(screen.queryByText(/· 1701/)).toBeNull();
    expect(screen.getAllByText('Engine RPM (rpm)').length).toBeGreaterThan(0);
  });

  it('removes a panel', async () => {
    await open('golf-plus-2009-20tdi');
    const before = useChartsStore.getState().panels.length;
    fireEvent.press(screen.getAllByText('Remove')[0]);
    expect(useChartsStore.getState().panels).toHaveLength(before - 1);
  });
});
