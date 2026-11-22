/** Coding tweaks verification badge (plan 25): every preset row carries the badge, amber while its
 *  bit positions are illustrative and blue once the preset carries confirmation evidence. */
import React from 'react';
import { screen, within } from '@testing-library/react-native';
import { renderWithProviders } from '@test/renderWithProviders';
import { connectSimulator } from '@test/simulator';
import { CONFIRMED_TEXT, ILLUSTRATIVE_TEXT, confirmItems } from '@test/confirmation';
import { useVehicleStore } from '@/shared/state/vehicleStore';
import { getVehicleProfile } from '@/shared/vehicles';
import { CodingTweaks } from './CodingTweaks';

const presets = () => getVehicleProfile('golf-plus-2009-20tdi').codingPresets!;

async function golf() {
  useVehicleStore.setState({ selectedProfileId: 'golf-plus-2009-20tdi' });
  await connectSimulator({ vehicleId: 'golf-plus-2009-20tdi' });
  renderWithProviders(<CodingTweaks />);
}

describe('CodingTweaks — verification badge', () => {
  it('badges every illustrative preset and drops the old blanket warning', async () => {
    await golf();
    for (const p of presets()) {
      expect(
        within(screen.getByTestId(`verify-tweak-${p.id}`)).getByText(ILLUSTRATIVE_TEXT),
      ).toBeTruthy();
    }
    expect(screen.queryByText(/Experimental — confirm on the real car\./)).toBeNull();
  });

  it('badges a confirmed preset as confirmed', async () => {
    const [first, second] = presets();
    const undo = confirmItems([first]);
    try {
      await golf();
      expect(
        within(screen.getByTestId(`verify-tweak-${first.id}`)).getByText(CONFIRMED_TEXT),
      ).toBeTruthy();
      expect(
        within(screen.getByTestId(`verify-tweak-${second.id}`)).getByText(ILLUSTRATIVE_TEXT),
      ).toBeTruthy();
    } finally {
      undo();
    }
  });
});
