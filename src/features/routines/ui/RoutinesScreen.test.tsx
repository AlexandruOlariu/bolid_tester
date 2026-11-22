/** Routines screen verification badge (plan 25): each routine row carries the badge instead of the
 *  old "⚠ experimental" suffix, amber while illustrative and blue once confirmed. */
import React from 'react';
import { screen, within } from '@testing-library/react-native';
import { renderWithProviders } from '@test/renderWithProviders';
import { connectSimulator } from '@test/simulator';
import { CONFIRMED_TEXT, ILLUSTRATIVE_TEXT, confirmItems } from '@test/confirmation';
import { useVehicleStore } from '@/shared/state/vehicleStore';
import { getVehicleProfile } from '@/shared/vehicles';
import { RoutinesScreen } from './RoutinesScreen';

const routine = () => getVehicleProfile('golf-plus-2009-20tdi').routines![0];

async function golf() {
  useVehicleStore.setState({ selectedProfileId: 'golf-plus-2009-20tdi' });
  await connectSimulator({ vehicleId: 'golf-plus-2009-20tdi' });
  renderWithProviders(<RoutinesScreen />);
}

describe('RoutinesScreen — verification badge', () => {
  it('shows the illustrative badge, not the old experimental suffix', async () => {
    await golf();
    const r = routine();
    expect(
      within(screen.getByTestId(`verify-routine-${r.id}`)).getByText(ILLUSTRATIVE_TEXT),
    ).toBeTruthy();
    expect(screen.queryByText(/⚠ experimental$/)).toBeNull();
  });

  it('turns to the confirmed badge once the routine carries evidence', async () => {
    const r = routine();
    const undo = confirmItems([r]);
    try {
      await golf();
      expect(
        within(screen.getByTestId(`verify-routine-${r.id}`)).getByText(CONFIRMED_TEXT),
      ).toBeTruthy();
    } finally {
      undo();
    }
  });
});
