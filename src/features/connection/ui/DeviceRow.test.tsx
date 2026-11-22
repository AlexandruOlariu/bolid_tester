/** The known-adapter chip (plan 29): a scanned device whose advertised name matches the bundled
 *  community list shows "known <grade>". The committed list is empty until real reports arrive, so
 *  this test seeds it. */
import React from 'react';
import { screen } from '@testing-library/react-native';
import { renderWithProviders } from '@test/renderWithProviders';
import { DeviceRow } from './DeviceRow';

jest.mock('@/shared/adapters/knownAdapters.json', () => [
  {
    slug: 'ios-vlink__elm327-v2-2',
    nameHints: ['ios-vlink'],
    firmware: 'ELM327 v2.2',
    link: 'ble',
    reports: 3,
    typicalGrade: 'good',
    medianMs: 28,
    cloneSuspectedRatio: 0,
  },
]);

const device = (name: string | null) => ({ id: 'AA:BB', name, rssi: -60, isLikelyAdapter: true });

describe('DeviceRow', () => {
  it('shows a "known good" chip for a device in the community list', () => {
    renderWithProviders(<DeviceRow device={device('IOS-Vlink')} onConnect={() => undefined} />);
    expect(screen.getByText('known good')).toBeTruthy();
    expect(
      screen.getByLabelText('Known adapter: 3 community reports · typically GOOD · ~28 ms'),
    ).toBeTruthy();
  });

  it('shows no chip for an unknown or unnamed device', () => {
    renderWithProviders(<DeviceRow device={device('OBDII')} onConnect={() => undefined} />);
    expect(screen.queryByTestId('known-adapter-chip')).toBeNull();
    screen.unmount();
    renderWithProviders(<DeviceRow device={device(null)} onConnect={() => undefined} />);
    expect(screen.queryByTestId('known-adapter-chip')).toBeNull();
  });
});
