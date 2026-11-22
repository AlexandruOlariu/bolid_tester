import React from 'react';
import { fireEvent, screen } from '@testing-library/react-native';
import { renderWithProviders } from '@test/renderWithProviders';
import { mockPush } from '@test/mocks/router';
import { connectSimulator } from '@test/simulator';
import { useSessionStore } from '@/shared/state/sessionStore';
import { PROTOCOL_LABELS } from '@/shared/obd-core/obd/protocols';
import { VehicleInfoScreen } from './VehicleInfoScreen';

describe('VehicleInfoScreen', () => {
  it('says "Not connected." without a session', () => {
    renderWithProviders(<VehicleInfoScreen />);
    expect(screen.getByText('Not connected.')).toBeTruthy();
  });

  it("shows the simulated Golf's protocol, VIN and supported-PID count", async () => {
    await connectSimulator({ vehicleId: 'golf-plus-2009-20tdi' });
    const info = useSessionStore.getState().info;
    if (!info) throw new Error('no session info');
    renderWithProviders(<VehicleInfoScreen />);

    expect(screen.getByText('WVWZZZ1KZ9W903398')).toBeTruthy();
    expect(screen.getByText(PROTOCOL_LABELS[info.protocol])).toBeTruthy();
    expect(screen.getByText('Supported PIDs')).toBeTruthy();
    expect(info.supportedPids.length).toBeGreaterThan(0);
    expect(screen.getByText(String(info.supportedPids.length))).toBeTruthy();
    expect(screen.getByText('Simulator · golf-plus-2009-20tdi')).toBeTruthy();

    fireEvent.press(screen.getByText('Decode VIN'));
    expect(mockPush).toHaveBeenCalledWith('/vin-decode');

    fireEvent.press(screen.getByText('Full vehicle report'));
    expect(mockPush).toHaveBeenCalledWith('/report');
  });

  it('offers the vehicle report offline too (it builds from stored data)', () => {
    renderWithProviders(<VehicleInfoScreen />);
    fireEvent.press(screen.getByText('Full vehicle report'));
    expect(mockPush).toHaveBeenCalledWith('/report');
  });
});
