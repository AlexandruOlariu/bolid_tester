import React from 'react';
import { screen } from '@testing-library/react-native';
import { renderWithProviders } from '@test/renderWithProviders';
import { connectSimulator } from '@test/simulator';
import type { LiveValue } from '@/shared/obd-core/session/DiagnosticSession';
import { useLiveDataStore } from '../model/liveDataStore';
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
});
