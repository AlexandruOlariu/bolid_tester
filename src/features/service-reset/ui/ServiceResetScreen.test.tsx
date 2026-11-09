/** Service reset verification badge (plan 25): the Golf's illustrative cluster routine shows the
 *  amber badge, and the blue one once the descriptor carries confirmation evidence. */
import React from 'react';
import { screen, within } from '@testing-library/react-native';
import { renderWithProviders } from '@test/renderWithProviders';
import { connectSimulator } from '@test/simulator';
import { CONFIRMED_TEXT, ILLUSTRATIVE_TEXT, confirmItems } from '@test/confirmation';
import { useVehicleStore } from '@/shared/state/vehicleStore';
import { getVehicleProfile } from '@/shared/vehicles';
import { ServiceResetScreen } from './ServiceResetScreen';

async function golf() {
  useVehicleStore.setState({ selectedProfileId: 'golf-plus-2009-20tdi' });
  await connectSimulator({ vehicleId: 'golf-plus-2009-20tdi' });
  renderWithProviders(<ServiceResetScreen />);
}

describe('ServiceResetScreen — verification badge', () => {
  it('shows the illustrative badge for the Golf routine', async () => {
    await golf();
    expect(
      within(screen.getByTestId('verify-service-reset')).getByText(ILLUSTRATIVE_TEXT),
    ).toBeTruthy();
  });

  it('shows the confirmed badge once the descriptor carries evidence', async () => {
    const undo = confirmItems([getVehicleProfile('golf-plus-2009-20tdi').serviceReset!]);
    try {
      await golf();
      expect(
        within(screen.getByTestId('verify-service-reset')).getByText(CONFIRMED_TEXT),
      ).toBeTruthy();
    } finally {
      undo();
    }
  });
});
