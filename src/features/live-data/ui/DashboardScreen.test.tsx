import React from 'react';
import { fireEvent, screen } from '@testing-library/react-native';
import { renderWithProviders } from '@test/renderWithProviders';
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
});
