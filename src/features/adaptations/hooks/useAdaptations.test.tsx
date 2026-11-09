/** `useAdaptations` (plan 22): the KWP session cache lives once per screen session — every hook
 *  under the screen's `KwpSessionCacheContext` provider shares it, so two channels on one KWP
 *  header send a single `10 85`; a hook outside the provider keeps its own. Runs against the
 *  simulated Passat (K-line). */
import React from 'react';
import { act, renderHook } from '@testing-library/react-native';
import { connectSimulator } from '@test/simulator';
import { useSessionStore } from '@/shared/state/sessionStore';
import { useVehicleStore } from '@/shared/state/vehicleStore';
import { getVehicleProfile, type AdaptationChannel } from '@/shared/vehicles';
import { KwpSessionCacheContext, newKwpSessionCache, useAdaptations } from './useAdaptations';

const idle = (getVehicleProfile('passat-b55-19tdi').adaptations ?? []).find(
  (c) => c.did === '2A',
) as AdaptationChannel;

async function sessionStarts(wrapper?: React.ComponentType<{ children: React.ReactNode }>) {
  useVehicleStore.setState({ selectedProfileId: 'passat-b55-19tdi' });
  await connectSimulator({ vehicleId: 'passat-b55-19tdi' });
  const session = useSessionStore.getState().session!;
  const send = jest.spyOn(session, 'send');
  // Two hook instances, like two ChannelRows.
  const { result } = renderHook(() => [useAdaptations(), useAdaptations()] as const, { wrapper });
  await act(async () => {
    await result.current[0].read(idle);
  });
  await act(async () => {
    await result.current[1].read(idle);
  });
  return send.mock.calls.filter(([cmd]) => cmd === '1085').length;
}

describe('useAdaptations — KWP session cache', () => {
  it('is shared by every hook under the screen provider: one 10 85 for the header', async () => {
    const cache = newKwpSessionCache();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <KwpSessionCacheContext.Provider value={cache}>{children}</KwpSessionCacheContext.Provider>
    );
    expect(await sessionStarts(wrapper)).toBe(1);
    expect([...cache.headers]).toEqual([idle.reqHeader]);
  });

  it('is per hook without a provider', async () => {
    expect(await sessionStarts()).toBe(2);
  });
});
