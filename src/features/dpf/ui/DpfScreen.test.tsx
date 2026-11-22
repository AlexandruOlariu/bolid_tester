/** DPF screen subtitle (plan 25): the experimental warning while any DPF / diesel DID is still
 *  illustrative, "All DIDs confirmed on this car" once every one carries confirmation evidence. */
import React from 'react';
import { act, screen, waitFor } from '@testing-library/react-native';
import { renderWithProviders } from '@test/renderWithProviders';
import { connectSimulator } from '@test/simulator';
import { confirmItems } from '@test/confirmation';
import { useVehicleStore } from '@/shared/state/vehicleStore';
import { useErrorLogStore } from '@/shared/state/errorLogStore';
import { disconnect } from '@/features/connection/api/connectionService';
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
  // The screen refreshes on mount (Mode 22 reads). Let that finish before the test asserts, so the
  // subtitle is checked on a settled screen; the afterEach's disconnect would otherwise cut the reads
  // short (they reject at once — see the plan W2 test below — instead of timing out after the test).
  await waitFor(
    () => {
      expect(useDpfStore.getState().running).toBe(false);
      expect(useDpfStore.getState().values).toHaveLength(dieselPids().length);
    },
    { timeout: 4000 },
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

describe('DpfScreen — a refresh cut off by a disconnect (plan W2)', () => {
  it('fails at once instead of timing out after the session is gone', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      useVehicleStore.setState({ selectedProfileId: 'golf-plus-2009-20tdi' });
      await connectSimulator({ vehicleId: 'golf-plus-2009-20tdi' });
      renderWithProviders(<DpfScreen />);
      // The mount refresh is reading Mode 22 DIDs; close the session under it.
      expect(useDpfStore.getState().running).toBe(true);
      await act(async () => {
        await disconnect();
      });
      // Well inside the 5 s command timeout: the queued reads were rejected, not left to expire.
      await waitFor(() => expect(useDpfStore.getState().running).toBe(false), { timeout: 1000 });
      expect(useDpfStore.getState().values).toEqual([]);
      const logged = useErrorLogStore.getState().errors.filter((e) => e.source === 'dpf');
      expect(logged.map((e) => e.message)).toEqual(['ELM327 link closed']);
    } finally {
      warn.mockRestore();
    }
  });
});
