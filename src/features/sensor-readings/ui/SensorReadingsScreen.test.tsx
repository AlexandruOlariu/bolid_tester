import React from 'react';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { renderWithProviders } from '@test/renderWithProviders';
import { connectSimulator } from '@test/simulator';
import type { LiveValue } from '@/shared/obd-core/session/DiagnosticSession';
import { useSessionStore } from '@/shared/state/sessionStore';
import { useVehicleStore } from '@/features/vehicle-select/model/vehicleStore';
import { useLiveDataStore } from '@/features/live-data/model/liveDataStore';
import { SensorReadingsScreen } from './SensorReadingsScreen';

async function golfSession() {
  await connectSimulator();
  useVehicleStore.setState({ selectedProfileId: 'golf-plus-2009-20tdi' });
  const session = useSessionStore.getState().session;
  if (!session) throw new Error('no session');
  return session;
}

/** Makes the next `readExtended` call hang until the returned `release` is called. */
function holdNextRead(spy: jest.SpyInstance<Promise<number[] | null>, [string]>) {
  let release: (raw: number[] | null) => void = () => {};
  spy.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  return (raw: number[] | null) => release(raw);
}

function live(pid: string, name: string, unit: string, value: number): LiveValue {
  return { pid, name, unit, value, ts: 0 };
}

describe('SensorReadingsScreen', () => {
  it('reads the injection DIDs once on mount, not again on every live-data update', async () => {
    await connectSimulator();
    useVehicleStore.setState({ selectedProfileId: 'golf-plus-2009-20tdi' });
    const session = useSessionStore.getState().session;
    if (!session) throw new Error('no session');
    const readExtended = jest.spyOn(session, 'readExtended');

    renderWithProviders(<SensorReadingsScreen />);
    expect(await screen.findByText('Injection quantity')).toBeTruthy();
    expect(readExtended).toHaveBeenCalledTimes(5);

    // A poll update re-renders the screen; that must not start another round of Mode 22 reads.
    for (const rpm of [820, 830, 840]) {
      await act(async () => {
        useLiveDataStore.setState({ values: { '010C': live('010C', 'Engine RPM', 'rpm', rpm) } });
      });
    }
    expect(screen.getByText('Engine')).toBeTruthy();
    expect(readExtended).toHaveBeenCalledTimes(5);
  });

  it('a read superseded by Refresh stops and never overwrites the newer values', async () => {
    const session = await golfSession();
    const readExtended = jest.spyOn(session, 'readExtended');
    const release = holdNextRead(readExtended);

    renderWithProviders(<SensorReadingsScreen />);
    expect(readExtended).toHaveBeenCalledTimes(1); // first run is stuck on its first DID
    fireEvent.press(screen.getByText('Refresh'));
    expect(await screen.findByText('Injection quantity')).toBeTruthy();
    expect(readExtended).toHaveBeenCalledTimes(6);

    // The stale run wakes up: it must not send its remaining four DIDs or replace the values.
    await act(async () => release(null));
    expect(readExtended).toHaveBeenCalledTimes(6);
    expect(screen.getByText('Injection quantity')).toBeTruthy();
  });

  it('stops reading DIDs once the screen unmounts', async () => {
    const session = await golfSession();
    const readExtended = jest.spyOn(session, 'readExtended');
    const release = holdNextRead(readExtended);

    const { unmount } = renderWithProviders(<SensorReadingsScreen />);
    expect(readExtended).toHaveBeenCalledTimes(1);
    unmount();
    await act(async () => release(null));
    expect(readExtended).toHaveBeenCalledTimes(1);
  });
});
