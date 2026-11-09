/** DPF screen subtitle (plan 25): the experimental warning while any DPF / diesel DID is still
 *  illustrative, "All DIDs confirmed on this car" once every one carries confirmation evidence. */
import React from 'react';
import { screen, waitFor } from '@testing-library/react-native';
import { renderWithProviders } from '@test/renderWithProviders';
import { connectSimulator } from '@test/simulator';
import { confirmItems } from '@test/confirmation';
import { useVehicleStore } from '@/shared/state/vehicleStore';
import { getVehicleProfile } from '@/shared/vehicles';
import { useDpfStore } from '../model/dpfStore';
import { DpfScreen } from './DpfScreen';

const WARNING = '⚠ Experimental Mode 22 reads — confirm values on the car.';
const ALL_CONFIRMED = 'All DIDs confirmed on this car';
const dieselPids = () =>
  (getVehicleProfile('golf-plus-2009-20tdi').extendedPids ?? []).filter(
    (p) => p.category === 'dpf' || p.category === 'diesel',
  );

async function golf() {
  useVehicleStore.setState({ selectedProfileId: 'golf-plus-2009-20tdi' });
  await connectSimulator({ vehicleId: 'golf-plus-2009-20tdi' });
  renderWithProviders(<DpfScreen />);
  // The screen refreshes on mount (Mode 22 reads). Let that finish before the test ends, so no read is
  // still pending when the afterEach closes the session (it would time out and log after the suite).
  await waitFor(
    () => {
      expect(useDpfStore.getState().running).toBe(false);
      expect(useDpfStore.getState().values).toHaveLength(dieselPids().length);
    },
    { timeout: 8000 },
  );
}

describe('DpfScreen — verification subtitle', () => {
  it('warns while the Golf DIDs are illustrative', async () => {
    await golf();
    expect(await screen.findByText(WARNING)).toBeTruthy();
    expect(screen.queryByText(ALL_CONFIRMED)).toBeNull();
  });

  it('keeps the warning while one DPF / diesel DID is still unconfirmed', async () => {
    const pids = dieselPids();
    expect(pids.length).toBeGreaterThan(1);
    const undo = confirmItems(pids.slice(1));
    try {
      await golf();
      expect(await screen.findByText(WARNING)).toBeTruthy();
    } finally {
      undo();
    }
  });

  it('says all DIDs are confirmed once every DPF / diesel DID is', async () => {
    const undo = confirmItems(dieselPids());
    try {
      await golf();
      expect(await screen.findByText(ALL_CONFIRMED)).toBeTruthy();
      expect(screen.queryByText(WARNING)).toBeNull();
    } finally {
      undo();
    }
  });
});
