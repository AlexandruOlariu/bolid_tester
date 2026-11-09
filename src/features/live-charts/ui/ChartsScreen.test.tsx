/** Charts (plan 14): the panel picker offers the Golf's extended DIDs next to the Mode 01 PIDs, a
 *  picked DID plots live with its label, and a car without DIDs offers none. */
import React from 'react';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { renderWithProviders } from '@test/renderWithProviders';
import { setMockWindow, TABLET_WINDOW } from '@test/mocks/window';
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

  describe('layout (plan 21)', () => {
    /** The plot's SVG size: the host element under the plot view that carries width + height. */
    function plotSize(panelId: string): { width: number; height: number } {
      const svg = screen
        .getByTestId(`chart-plot-${panelId}`)
        .findAll(
          (n: ReturnType<typeof screen.getByTestId>) =>
            typeof n.type === 'string' && typeof n.props.width === 'number' && !!n.props.height,
        )[0];
      return { width: svg.props.width, height: svg.props.height };
    }

    function layout(panelId: string, width: number) {
      fireEvent(screen.getByTestId(`chart-plot-${panelId}`), 'layout', {
        nativeEvent: { layout: { x: 0, y: 0, width, height: 100 } },
      });
    }

    it('plots at 320 × 120 until measured, then fills the measured width', async () => {
      await open('golf-plus-2009-20tdi');
      expect(plotSize('p1')).toEqual({ width: 320, height: 120 });
      layout('p1', 400);
      expect(plotSize('p1')).toEqual({ width: 400, height: 150 });
      layout('p1', 600);
      // 3:8 of 600 is 225, capped at 220.
      expect(plotSize('p1')).toEqual({ width: 600, height: 220 });
    });

    it('a tablet lays the panels out side by side', async () => {
      setMockWindow(TABLET_WINDOW);
      await open('golf-plus-2009-20tdi');
      const grid = screen.getByTestId('chart-panels-grid');
      expect(within(grid).getByTestId('chart-plot-p1')).toBeTruthy();
      expect(within(grid).getByTestId('chart-plot-p2')).toBeTruthy();
    });

    it('rotating keeps every panel mounted (its local chart state survives)', async () => {
      await open('golf-plus-2009-20tdi');
      layout('p1', 400);
      expect(plotSize('p1')).toEqual({ width: 400, height: 150 });
      // Portrait phone → landscape (medium): the grid switches on without remounting the panel, so
      // its measured width (like its zoom / pan / inspect state) is kept, not reset to 320. A new
      // panels array re-renders the screen, which then reads the rotated window.
      expect(screen.queryByTestId('chart-panels-grid')).toBeNull();
      setMockWindow({ width: 844, height: 390 });
      act(() => useChartsStore.setState({ panels: [...useChartsStore.getState().panels] }));
      expect(screen.getByTestId('chart-panels-grid')).toBeTruthy();
      expect(plotSize('p1')).toEqual({ width: 400, height: 150 });
    });

    it('a phone in portrait stacks the panels', async () => {
      await open('golf-plus-2009-20tdi');
      expect(screen.queryByTestId('chart-panels-grid')).toBeNull();
      expect(screen.getByTestId('chart-plot-p2')).toBeTruthy();
    });
  });
});
