import React from 'react';
import { act, fireEvent, screen, within } from '@testing-library/react-native';
import { i18n } from '@/shared/i18n';
import { renderWithProviders } from '@test/renderWithProviders';
import { setMockWindow, TABLET_WINDOW } from '@test/mocks/window';
import { connectSimulator } from '@test/simulator';
import type { LiveValue } from '@/shared/obd-core/session/DiagnosticSession';
import { useGarageStore } from '@/shared/state/garageStore';
import { useVehicleStore } from '@/shared/state/vehicleStore';
import type { UserVehicle } from '@/shared/vehicles/userVehicle';
import { livePidFilter } from '@/shared/vehicles';
import { useSessionStore } from '@/shared/state/sessionStore';
import { getActiveProfile } from '@/shared/state/activeProfile';
import { useLiveDataStore } from '../model/liveDataStore';
import { useDashboardLayoutStore } from '../model/dashboardLayoutStore';
import { DashboardScreen } from './DashboardScreen';

function live(pid: string, name: string, unit: string, value: number): LiveValue {
  return { pid, name, unit, value, ts: 0 };
}

describe('DashboardScreen', () => {
  it('prompts to connect when there is no session', () => {
    renderWithProviders(<DashboardScreen />);

    expect(screen.getByText('Live data')).toBeTruthy();
    expect(
      screen.getByText('Not connected. Connect an adapter or the simulator first.'),
    ).toBeTruthy();
  });

  it('shows seeded live values on the gauges with metric units', async () => {
    await connectSimulator();
    // EngineHost (the poll loop) is not mounted here, so the store holds exactly these values.
    useLiveDataStore.setState({
      values: {
        '010C': live('010C', 'Engine RPM', 'rpm', 2150),
        '010D': live('010D', 'Vehicle speed', 'km/h', 87),
        '0105': live('0105', 'Coolant temperature', '°C', 91),
      },
    });
    renderWithProviders(<DashboardScreen />);

    expect(screen.getByRole('progressbar', { name: 'RPM' })).toHaveAccessibilityValue({
      now: 2150,
      text: '2150 rpm',
    });
    expect(screen.getByRole('progressbar', { name: 'Speed' })).toHaveAccessibilityValue({
      text: '87 km/h',
    });
    expect(screen.getByRole('progressbar', { name: 'Coolant' })).toHaveAccessibilityValue({
      text: '91 °C',
    });
    expect(screen.getByText('2150')).toBeTruthy();
    expect(screen.getByText('km/h')).toBeTruthy();
    expect(screen.getByText('°C')).toBeTruthy();
    expect(screen.getByText('Customize')).toBeTruthy();
  });

  it('the fuel-economy card shows 12.5 in English and 12,5 in Romanian (plan 11)', async () => {
    await connectSimulator();
    // 12.5 L/h at 100 km/h = 12.5 L/100km.
    useLiveDataStore.setState({
      values: {
        '015E': live('015E', 'Engine fuel rate', 'L/h', 12.5),
        '010D': live('010D', 'Vehicle speed', 'km/h', 100),
      },
    });
    renderWithProviders(<DashboardScreen />);
    const card = () => within(screen.getByTestId('fuel-economy'));
    expect(card().getByText('12.5')).toBeTruthy();
    expect(card().getByText('L/100km')).toBeTruthy();
    expect(card().getByText('· 12.5 L/h')).toBeTruthy();

    await act(async () => {
      await i18n.changeLanguage('ro');
    });
    expect(card().getByText('12,5')).toBeTruthy();
    expect(card().getByText('L/100km')).toBeTruthy();
    expect(card().getByText('· 12,5 L/h')).toBeTruthy();
    expect(card().queryByText('12.5')).toBeNull();
  });

  it('the All sensors segment shows the grouped view and registers the whole effective set', async () => {
    await connectSimulator();
    useLiveDataStore.setState({
      values: {
        '010C': live('010C', 'Engine RPM', 'rpm', 820),
        '0105': live('0105', 'Coolant temperature', '°C', 88),
        '0142': live('0142', 'Control module voltage', 'V', 14.1),
      },
    });
    renderWithProviders(<DashboardScreen />);
    const registered = () => Object.values(useLiveDataStore.getState().registrations).flat();
    expect(screen.getByRole('tab', { name: 'Dashboard', selected: true })).toBeTruthy();
    expect(screen.queryByTestId('live-all-sensors')).toBeNull();
    const dashboardPids = new Set(registered());

    fireEvent.press(screen.getByRole('tab', { name: 'All sensors' }));

    expect(screen.getByTestId('live-all-sensors')).toBeTruthy();
    expect(screen.getByText('Engine')).toBeTruthy();
    expect(screen.getByText('Temperatures')).toBeTruthy();
    expect(screen.getByText('Electrical')).toBeTruthy();
    expect(screen.queryByText('Customize')).toBeNull();
    const session = useSessionStore.getState().session!;
    const effective = session.effectivePids(livePidFilter(getActiveProfile()));
    expect(new Set(registered())).toEqual(new Set(effective));
    expect(effective.length).toBeGreaterThanOrEqual(dashboardPids.size);

    fireEvent.press(screen.getByRole('tab', { name: 'Dashboard' }));
    expect(screen.queryByTestId('live-all-sensors')).toBeNull();
    expect(screen.getByText('Customize')).toBeTruthy();
  });

  it('a new petrol garage car with no saved layout leads with the fuel trims (petrol preset)', async () => {
    const car: UserVehicle = {
      id: 'user:dacia',
      name: 'Dacia Logan',
      fuel: 'petrol',
      baseProfileId: 'generic',
      createdAt: 1,
      updatedAt: 1,
    };
    useGarageStore.setState({ vehicles: [car] });
    await connectSimulator({ vehicleId: 'fiat-punto-2008-12' });
    useVehicleStore.setState({ selectedProfileId: car.id });
    useLiveDataStore.setState({
      values: {
        '0104': live('0104', 'Calculated engine load', '%', 22),
        '0106': live('0106', 'Short term fuel trim B1', '%', 1.6),
        '0107': live('0107', 'Long term fuel trim B1', '%', -2.3),
        '010B': live('010B', 'Intake manifold pressure', 'kPa', 34),
      },
    });
    expect(useDashboardLayoutStore.getState().byProfile[car.id]).toBeUndefined();
    renderWithProviders(<DashboardScreen />);

    // Value cards in render order (each is labelled "<name>: <value> <unit>").
    const cards = screen
      .getAllByLabelText(/^(Short term|Long term|Calculated|Intake)/)
      .map((c) => String(c.props.accessibilityLabel).split(':')[0]);
    expect(cards).toEqual([
      'Short term fuel trim B1',
      'Long term fuel trim B1',
      'Intake manifold pressure',
      'Calculated engine load',
    ]);
  });

  describe('tablet layout (plan 21)', () => {
    const seed = () =>
      useLiveDataStore.setState({
        values: {
          '010C': live('010C', 'Engine RPM', 'rpm', 2150),
          '0104': live('0104', 'Calculated engine load', '%', 22),
        },
      });

    it('a tablet shows the gauges in a left column and the value cards in a right one', async () => {
      setMockWindow(TABLET_WINDOW);
      await connectSimulator();
      seed();
      renderWithProviders(<DashboardScreen />);

      const left = screen.getByTestId('live-left');
      const right = screen.getByTestId('live-right');
      expect(within(left).getByRole('progressbar', { name: 'RPM' })).toBeTruthy();
      expect(within(right).queryByRole('progressbar')).toBeNull();
      expect(within(right).getByLabelText(/^Calculated engine load: 22/)).toBeTruthy();
    });

    it('Customize lists the items in the right column and keeps the gauges on the left', async () => {
      setMockWindow(TABLET_WINDOW);
      await connectSimulator();
      seed();
      renderWithProviders(<DashboardScreen />);

      fireEvent.press(screen.getByText('Customize'));
      expect(
        within(screen.getByTestId('live-right')).getByText(/Reorder with the arrows/),
      ).toBeTruthy();
      expect(within(screen.getByTestId('live-left')).getAllByRole('progressbar').length).toBe(3);
    });

    it('a phone in landscape is two-pane too', async () => {
      setMockWindow({ width: 760, height: 360 });
      await connectSimulator();
      seed();
      renderWithProviders(<DashboardScreen />);
      expect(screen.getByTestId('live-left')).toBeTruthy();
    });

    const widthOf = (id: string) => {
      const style = [screen.getByTestId(id).props.style].flat(Infinity) as { width?: number }[];
      return style.reduce<number | undefined>((w, s) => s?.width ?? w, undefined);
    };
    const cardWidthOf = (label: RegExp) => {
      let node = screen.getByLabelText(label);
      while (!node.props.accessibilityLabel) node = node.parent!;
      const style = [node.props.style].flat(Infinity) as { width?: number | string }[];
      return style.reduce<number | string | undefined>((w, s) => s?.width ?? w, undefined);
    };
    const layoutRow = (width: number) =>
      fireEvent(screen.getByTestId('live-row'), 'layout', {
        nativeEvent: { layout: { width, height: 400, x: 0, y: 0 } },
      });

    it('sizes the gauge column from the row, not the window, so the cards keep room', async () => {
      setMockWindow({ width: 640, height: 360 });
      await connectSimulator();
      seed();
      const view = renderWithProviders(<DashboardScreen />);
      // Before the first layout the row is estimated as the window minus the 2 × 24 padding:
      // 45 % of 592 → 266 dp, leaving 592 − 266 − 18 (gap) = 308 dp → two 150 dp cards.
      expect(widthOf('live-left')).toBe(266);
      expect(cardWidthOf(/^Calculated engine load: 22/)).toBe(150);
      view.unmount();

      // An 800 × 600 window with an ~80 dp side rail: the measured row is 672 dp.
      setMockWindow({ width: 800, height: 600 });
      renderWithProviders(<DashboardScreen />);
      layoutRow(672);
      expect(widthOf('live-left')).toBe(302);
      // 672 − 302 − 18 = 352 dp → two cards of (352 − 7) / 2 → 172 dp, filling the row.
      expect(cardWidthOf(/^Calculated engine load: 22/)).toBe(172);
    });

    it('a narrow card column holds one full-width card instead of a 150 dp card and a gap', async () => {
      setMockWindow({ width: 640, height: 360 });
      await connectSimulator();
      seed();
      renderWithProviders(<DashboardScreen />);
      layoutRow(560); // 560 − 252 − 18 = 290 dp: too narrow for two cards
      expect(cardWidthOf(/^Calculated engine load: 22/)).toBe(290);
    });

    it('a tablet with a narrower measured row drops to two cards per row rather than leaving a gap', async () => {
      setMockWindow({ width: 960, height: 600 });
      await connectSimulator();
      seed();
      renderWithProviders(<DashboardScreen />);
      layoutRow(832); // 960 − 80 rail − 48 padding; 832 − 360 − 18 = 454 dp → 2 × 223
      expect(cardWidthOf(/^Calculated engine load: 22/)).toBe(223);
      layoutRow(1232); // 1280 − 48: 1232 − 360 − 18 = 854 dp → 3 × 280
      expect(cardWidthOf(/^Calculated engine load: 22/)).toBe(280);
    });

    it('drops the empty gauge column when every gauge is hidden and there is no fuel economy', async () => {
      setMockWindow(TABLET_WINDOW);
      await connectSimulator();
      seed();
      useDashboardLayoutStore.setState({
        byProfile: {
          [getActiveProfile().id]: {
            order: [],
            hidden: ['gauge:010C', 'gauge:010D', 'gauge:0105'],
          },
        },
      });
      renderWithProviders(<DashboardScreen />);

      expect(screen.queryByTestId('live-left')).toBeNull();
      expect(screen.queryByRole('progressbar')).toBeNull();
      // The cards get the whole 1232 dp row: 3 × (1232 − 14) / 3 → 406 dp.
      expect(cardWidthOf(/^Calculated engine load: 22/)).toBe(406);
    });

    it('a phone in portrait keeps the single column', async () => {
      setMockWindow({ width: 390, height: 844 });
      await connectSimulator();
      seed();
      renderWithProviders(<DashboardScreen />);

      expect(screen.queryByTestId('live-left')).toBeNull();
      expect(screen.queryByTestId('live-right')).toBeNull();
      expect(screen.getByRole('progressbar', { name: 'RPM' })).toBeTruthy();
    });

    // Plan 20: above 1.5× OS font scale two 150 dp tiles cannot hold the number and its unit.
    it('large text on a phone: the value cards go full width, one per row', async () => {
      setMockWindow({ width: 390, height: 844, fontScale: 2 });
      await connectSimulator();
      seed();
      renderWithProviders(<DashboardScreen />);
      expect(cardWidthOf(/^Calculated engine load: 22/)).toBe('100%');
    });

    it('large text on a tablet: one card per row in the card column', async () => {
      setMockWindow({ width: 800, height: 600, fontScale: 2 });
      await connectSimulator();
      seed();
      renderWithProviders(<DashboardScreen />);
      layoutRow(672); // 672 − 302 − 18 = 352 dp, all of it for one card
      expect(cardWidthOf(/^Calculated engine load: 22/)).toBe(352);
    });

    it('normal text on a phone keeps the wrapping 150 dp minimum', async () => {
      setMockWindow({ width: 390, height: 844, fontScale: 1.3 });
      await connectSimulator();
      seed();
      renderWithProviders(<DashboardScreen />);
      expect(cardWidthOf(/^Calculated engine load: 22/)).toBeUndefined();
    });
  });

  it('Customize: the icon-only reorder / hide buttons name their action and car item', async () => {
    await connectSimulator();
    renderWithProviders(<DashboardScreen />);
    fireEvent.press(screen.getByText('Customize'));
    expect(screen.getByRole('button', { name: 'Move RPM up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move RPM down' })).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Hide RPM' }));
    expect(screen.getByRole('button', { name: 'Show RPM' })).toBeTruthy();
  });
});
