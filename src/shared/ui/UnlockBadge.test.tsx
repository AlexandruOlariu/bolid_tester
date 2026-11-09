/** The security-access badge (plan 23): the three states through the real `useUnlockStatus`
 *  hook, which re-renders when a plugin is installed or deleted and honours pinning. */
import React from 'react';
import { act, screen } from '@testing-library/react-native';
import { renderWithProviders } from '@test/renderWithProviders';
import { useSeedKeyStore, type SeedKeyIndexEntry } from '@/shared/state/seedKeyStore';
import { useUnlockStatus } from '@/shared/security/useUnlockStatus';
import { UnlockBadge } from './UnlockBadge';

function Harness({ security }: { security?: { level: number } }) {
  const status = useUnlockStatus(security, { reqHeader: '70E' });
  return <UnlockBadge status={status} testID="badge" />;
}

const entry = (extra: Partial<SeedKeyIndexEntry> = {}): SeedKeyIndexEntry => ({
  id: 'mine',
  name: 'My BCM',
  applies: { reqHeader: '70E', level: 3 },
  seedBytes: 2,
  keyBytes: 2,
  fileUri: 'file:///test/seedkeys/mine.json',
  importedAt: 1,
  ...extra,
});

describe('UnlockBadge', () => {
  it('says no unlock is needed for a module without security', () => {
    renderWithProviders(<Harness />);
    expect(screen.getByText('No unlock needed')).toBeTruthy();
  });

  it('goes from Locked to Unlockable when a matching plugin is installed, and back', () => {
    renderWithProviders(<Harness security={{ level: 3 }} />);
    expect(screen.getByText('Locked · needs security access')).toBeTruthy();
    act(() => {
      useSeedKeyStore.setState({ plugins: [entry()] });
    });
    expect(screen.getByText('Unlockable · My BCM')).toBeTruthy();
    expect(screen.getByLabelText('Security access: Unlockable · My BCM')).toBeTruthy();
    act(() => {
      useSeedKeyStore.setState({ plugins: [] });
    });
    expect(screen.getByText('Locked · needs security access')).toBeTruthy();
  });

  it('stays locked for another level or a plugin pinned to another car', () => {
    useSeedKeyStore.setState({
      plugins: [
        entry({ id: 'a', applies: { reqHeader: '70E', level: 1 } }),
        entry({ id: 'b', vehicleKey: 'vin:OTHERCAR' }),
      ],
    });
    renderWithProviders(<Harness security={{ level: 3 }} />);
    expect(screen.getByText('Locked · needs security access')).toBeTruthy();
  });
});
