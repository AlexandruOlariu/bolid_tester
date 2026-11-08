import React from 'react';
import { fireEvent, screen } from '@testing-library/react-native';
import { renderWithProviders } from '@test/renderWithProviders';
import { mockPush } from '@test/mocks/router';
import { connectSimulator } from '@test/simulator';
import { VEHICLE_PROFILES } from '@/shared/vehicles';
import { useVehicleStore } from '../model/vehicleStore';
import { VehicleSelectScreen } from './VehicleSelectScreen';

const GOLF = 'VW Golf Plus 2009 2.0 TDI 81 kW';
const SUGGESTION = /tap to switch to that profile/;

describe('VehicleSelectScreen', () => {
  it('lists the four built-in profiles', () => {
    renderWithProviders(<VehicleSelectScreen />);

    expect(VEHICLE_PROFILES).toHaveLength(4);
    for (const p of VEHICLE_PROFILES) expect(screen.getByText(p.name)).toBeTruthy();
    // No session → no VIN → no suggestion card.
    expect(screen.queryByText(SUGGESTION)).toBeNull();
  });

  it('tapping the Golf selects it and opens the Live tab', () => {
    renderWithProviders(<VehicleSelectScreen />);

    fireEvent.press(screen.getByText(GOLF));

    expect(useVehicleStore.getState().selectedProfileId).toBe('golf-plus-2009-20tdi');
    expect(mockPush).toHaveBeenCalledWith('/dashboard');
  });

  it("suggests the matching profile from the connected car's VIN", async () => {
    // The simulated Golf reports a WVWZZZ1K… VIN while the selected profile is still Auto / Generic.
    await connectSimulator({ vehicleId: 'golf-plus-2009-20tdi' });
    renderWithProviders(<VehicleSelectScreen />);

    const card = screen.getByText(SUGGESTION);
    expect(screen.getByText(/WVWZZZ1KZ9W903398/)).toBeTruthy();
    fireEvent.press(card);

    expect(useVehicleStore.getState().selectedProfileId).toBe('golf-plus-2009-20tdi');
    expect(mockPush).toHaveBeenCalledWith('/dashboard');
    // Once the suggested profile is active the card goes away.
    expect(screen.queryByText(SUGGESTION)).toBeNull();
  });
});
