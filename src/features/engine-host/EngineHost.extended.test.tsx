/** EngineHost's split sweep (plan 14): an extended `22:<DID>` registration is polled alongside the
 *  Mode 01 PIDs on the CAN Golf, and generates no Mode 22 traffic on a car whose profile declares
 *  no DIDs (a stale chart panel on the Punto) or on the K-line Passat. A throwing extended read
 *  never costs the sweep its Mode 01 values, and the engine part number is read when the active
 *  profile gains DIDs after connect. */
import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import { connectSimulator } from '@test/simulator';
import { adapterLogSnapshot } from '@/shared/state/adapterLog';
import { useSettingsStore } from '@/shared/state/settingsStore';
import { useVehicleStore } from '@/shared/state/vehicleStore';
import { useSessionStore } from '@/shared/state/sessionStore';
import { useErrorLogStore } from '@/shared/state/errorLogStore';
import { useLiveDataStore } from '@/shared/state/liveDataStore';
import { EngineHost } from './EngineHost';

const modeTwentyTwoTx = () =>
  adapterLogSnapshot().filter((e) => e.dir === 'tx' && /^22/i.test(e.text.trim()));

async function connectAs(profileId: string) {
  useVehicleStore.setState({ selectedProfileId: profileId });
  render(<EngineHost />);
  await connectSimulator({ vehicleId: profileId });
}

describe('EngineHost extended keys', () => {
  it('polls 22:1701 with 010C on the Golf, without the Extended PIDs screen', async () => {
    await connectAs('golf-plus-2009-20tdi');
    act(() => {
      useLiveDataStore.getState().acquire('test-chart', ['22:1701', '010C']);
    });
    await waitFor(
      () => {
        const v = useLiveDataStore.getState().values;
        expect(v['22:1701']?.value).toBe(12);
        expect(v['22:1701']?.unit).toBe('g');
        expect(v['010C']?.value).toBeGreaterThan(0);
      },
      { timeout: 4000 },
    );
    expect(modeTwentyTwoTx().some((e) => /^221701/i.test(e.text.trim()))).toBe(true);
  });

  it.each([['fiat-punto-2008-12'], ['passat-b55-19tdi']])(
    'sends no 22 request on %s even with a stale 22: panel',
    async (profileId) => {
      await connectAs(profileId);
      act(() => {
        useLiveDataStore.getState().acquire('stale-chart', ['22:1701', '010C']);
      });
      await waitFor(() => expect(useLiveDataStore.getState().values['010C']).toBeTruthy(), {
        timeout: 4000,
      });
      expect(useLiveDataStore.getState().values['22:1701']).toBeUndefined();
      expect(modeTwentyTwoTx()).toEqual([]);
    },
  );

  it('still publishes the Mode 01 values when the extended read throws', async () => {
    await connectAs('golf-plus-2009-20tdi');
    const session = useSessionStore.getState().session;
    if (!session) throw new Error('no session');
    jest.spyOn(session, 'pollExtendedOnce').mockRejectedValue(new Error('TIMEOUT 221701'));
    act(() => {
      useLiveDataStore.getState().acquire('test-chart', ['22:1701', '010C']);
    });
    await waitFor(
      () => {
        expect(useLiveDataStore.getState().values['010C']?.value).toBeGreaterThan(0);
        expect(
          useErrorLogStore.getState().errors.some((e) => e.source === 'live-data/extended'),
        ).toBe(true);
      },
      { timeout: 4000 },
    );
    expect(useLiveDataStore.getState().values['22:1701']).toBeUndefined();
  });

  it('reads the part number when the profile gains DIDs after connect', async () => {
    // Connected under the Generic profile (no DIDs) → no F187 at connect.
    useVehicleStore.setState({ selectedProfileId: 'generic' });
    render(<EngineHost />);
    useSettingsStore.setState({ autoSelectByVin: false });
    await connectSimulator({ vehicleId: 'golf-plus-2009-20tdi' });
    expect(useSessionStore.getState().info?.partNumber).toBeUndefined();
    // Switching to the Golf while connected reads it now.
    act(() => {
      useVehicleStore.setState({ selectedProfileId: 'golf-plus-2009-20tdi' });
    });
    await waitFor(() => expect(useSessionStore.getState().info?.partNumber).toBe('03L906022LM'), {
      timeout: 4000,
    });
  });
});
