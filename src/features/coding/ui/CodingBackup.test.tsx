/** Coding → Backup adaptation restore (plan 24) on the simulated Golf: create a backup, change
 *  channel 3001 to 900 rpm the way the Adaptations screen does, then **Compare with car** shows
 *  `3001: 850 → 900 · restore` and `3002 · equal`; Restore is disabled while adaptations are locked,
 *  and once unlocked it writes 850 back (verified on a re-read). An out-of-bounds snapshot value is
 *  listed as skipped with the bounds message and offers no Restore button. Review follow-ups: a
 *  failing Restore all stops at the first failure and names what was not restored; a non-CAN link
 *  offers no compare; a snapshot from another car (VIN / profile) cannot be restored; the shared
 *  backup work gate refuses overlapping actions; a throwing compare reports instead of escaping. */
import React from 'react';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { renderWithProviders } from '@test/renderWithProviders';
import { connectSimulator } from '@test/simulator';
import { useSessionStore } from '@/shared/state/sessionStore';
import { useVehicleStore } from '@/shared/state/vehicleStore';
import { getVehicleProfile } from '@/shared/vehicles';
import * as adaptationService from '@/features/adaptations/api/adaptationService';
import { readChannel, writeChannel } from '@/features/adaptations/api/adaptationService';
import * as planner from '../api/adaptationRestore';
import { useBackupWorkStore } from '../model/backupWorkStore';
import { useAdaptationsStore } from '@/features/adaptations/model/adaptationsStore';
import { useCarBackupStore } from '../model/carBackupStore';
import { CodingBackup } from './CodingBackup';

const golf = getVehicleProfile('golf-plus-2009-20tdi');
const ch3001 = golf.adaptations!.find((c) => c.did === '3001')!;
const ch3002 = golf.adaptations!.find((c) => c.did === '3002')!;

async function backupThenChange(opts: { also3002?: boolean; beforeExpand?: () => void } = {}) {
  useVehicleStore.setState({ selectedProfileId: 'golf-plus-2009-20tdi' });
  await connectSimulator({ vehicleId: 'golf-plus-2009-20tdi' });
  renderWithProviders(<CodingBackup />);
  fireEvent.press(screen.getByText('Create backup'));
  await waitFor(() => expect(useCarBackupStore.getState().backups).toHaveLength(1), {
    timeout: 4000,
  });
  // Change 3001 to 900 rpm through the same gated write the Adaptations screen uses.
  const session = useSessionStore.getState().session!;
  await act(async () => {
    expect((await writeChannel(session, ch3001, [0x03, 0x84])).ok).toBe(true);
    if (opts.also3002) expect((await writeChannel(session, ch3002, [0x66])).ok).toBe(true);
  });
  opts.beforeExpand?.();
  // Expand the snapshot.
  fireEvent.press(screen.getByText(/2 adaptations/));
}

/** True when the pressable a label sits in is disabled (walks up from the label text). */
type Node = ReturnType<typeof screen.getByText>;

const isDisabled = (label: Node) => {
  let n: Node | null = label;
  while (n) {
    const props = n.props as { disabled?: boolean; accessibilityState?: { disabled?: boolean } };
    if (props.disabled || props.accessibilityState?.disabled) return true;
    n = n.parent;
  }
  return false;
};

async function compare() {
  const panel = screen.getByTestId('adaptation-restore-7E0');
  fireEvent.press(within(panel).getByText('Compare with car'));
  await waitFor(() => expect(within(panel).getByTestId('restore-row-3001')).toBeTruthy(), {
    timeout: 4000,
  });
  return panel;
}

describe('CodingBackup — adaptation restore', () => {
  it('compares a backup with the car and lists restore / equal per channel', async () => {
    await backupThenChange();
    const panel = await compare();
    const row3001 = within(panel).getByTestId('restore-row-3001');
    const row3002 = within(panel).getByTestId('restore-row-3002');
    expect(within(row3001).getByText('850 rpm → 900 rpm')).toBeTruthy();
    expect(within(row3001).getByText('restore')).toBeTruthy();
    expect(within(row3002).getByText('equal')).toBeTruthy();
    expect(within(row3002).queryByText('Restore')).toBeNull();
    expect(within(panel).getByText('1 adaptation differs')).toBeTruthy();
    expect(within(panel).getByText('Restore all (1)')).toBeTruthy();
  });

  it('keeps Restore disabled with an explanation while adaptations are locked', async () => {
    await backupThenChange();
    const panel = await compare();
    expect(
      within(panel).getByText(/Locked — unlock adaptations on the Adaptations screen/),
    ).toBeTruthy();
    expect(isDisabled(within(panel).getByText('Restore'))).toBe(true);
    expect(isDisabled(within(panel).getByText('Restore all (1)'))).toBe(true);
    // Pressing does nothing: no confirmation appears.
    fireEvent.press(within(panel).getByText('Restore'));
    expect(within(panel).queryByText('Confirm restore')).toBeNull();
  });

  it('restores the backed-up value through the gated write once unlocked', async () => {
    await backupThenChange();
    act(() => useAdaptationsStore.getState().setUnlocked(true));
    const panel = await compare();
    fireEvent.press(within(within(panel).getByTestId('restore-row-3001')).getByText('Restore'));
    expect(
      within(panel).getByText(
        'Write 850 rpm to Idle speed offset (DID 3001)? A backup of the current value is taken first.',
      ),
    ).toBeTruthy();
    fireEvent.press(within(panel).getByText('Confirm restore'));
    await waitFor(
      () =>
        expect(screen.getByTestId('adaptation-restore-message')).toHaveTextContent(
          'Write verified.',
        ),
      { timeout: 4000 },
    );
    // The panel re-compares: both channels now equal.
    await waitFor(() => expect(within(panel).getAllByText('equal')).toHaveLength(2), {
      timeout: 4000,
    });
    // The current value was backed up into the adaptations store, and the car reads 850 again.
    expect(useAdaptationsStore.getState().backups[0]).toMatchObject({
      did: '3001',
      raw: [0x03, 0x84],
    });
    const session = useSessionStore.getState().session!;
    let raw: number[] | null = null;
    await act(async () => {
      raw = await readChannel(session, ch3001);
    });
    expect(raw).toEqual([0x03, 0x52]);
  });

  it('restores all differing channels in one go', async () => {
    await backupThenChange();
    act(() => useAdaptationsStore.getState().setUnlocked(true));
    const panel = await compare();
    fireEvent.press(within(panel).getByText('Restore all (1)'));
    expect(within(panel).getByText(/Idle speed offset \(3001\): set to 850 rpm/)).toBeTruthy();
    fireEvent.press(within(panel).getByText('Confirm restore all'));
    await waitFor(
      () =>
        expect(screen.getByTestId('adaptation-restore-message')).toHaveTextContent(
          'Restored 1 channel.',
        ),
      { timeout: 4000 },
    );
    await waitFor(() => expect(within(panel).getAllByText('equal')).toHaveLength(2), {
      timeout: 4000,
    });
  });

  it('shows an out-of-bounds snapshot value as skipped with the bounds message', async () => {
    await backupThenChange();
    act(() => {
      useAdaptationsStore.getState().setUnlocked(true);
      const [b] = useCarBackupStore.getState().backups;
      const engine = b.modules.find((m) => m.reqHeader === '7E0')!;
      engine.adaptations[0] = { ...engine.adaptations[0], raw: [0x04, 0x00], value: 1024 };
      useCarBackupStore.setState({ backups: [{ ...b, modules: [...b.modules] }] });
    });
    const panel = await compare();
    const row = within(panel).getByTestId('restore-row-3001');
    expect(within(row).getByText('out of bounds')).toBeTruthy();
    expect(
      within(row).getByText('Value 1024 rpm is above the channel maximum (950).'),
    ).toBeTruthy();
    expect(within(row).queryByText('Restore')).toBeNull();
    expect(within(panel).queryByText(/Restore all/)).toBeNull();
  });

  it('stops Restore all at the first failure and names the channels not restored', async () => {
    await backupThenChange({ also3002: true });
    act(() => useAdaptationsStore.getState().setUnlocked(true));
    const panel = await compare();
    expect(within(panel).getByText('2 adaptations differ')).toBeTruthy();
    const spy = jest
      .spyOn(adaptationService, 'writeChannel')
      .mockResolvedValueOnce({ ok: false, message: 'Verify mismatch.' });
    try {
      fireEvent.press(within(panel).getByText('Restore all (2)'));
      fireEvent.press(within(panel).getByText('Confirm restore all'));
      await waitFor(
        () =>
          expect(screen.getByTestId('adaptation-restore-message')).toHaveTextContent(
            'Stopped at 3001: Verify mismatch. Not restored: Idle speed offset (3001), EGR base duty (3002).',
          ),
        { timeout: 4000 },
      );
      // The first failure stopped the run: 3002 was never written.
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
    // The panel re-compares (holding the shared gate) and still offers both channels.
    await waitFor(() => expect(useBackupWorkStore.getState().busy).toBe(false), { timeout: 4000 });
    expect(within(panel).getByText('Restore all (2)')).toBeTruthy();
    expect(within(panel).getByText('2 adaptations differ')).toBeTruthy();
  });

  it('offers no compare or restore on a non-CAN link', async () => {
    let spy: jest.SpyInstance | undefined;
    await backupThenChange({
      beforeExpand: () => {
        const session = useSessionStore.getState().session!;
        spy = jest.spyOn(session, 'currentProtocol', 'get').mockReturnValue('ISO_9141_2');
      },
    });
    try {
      const panel = screen.getByTestId('adaptation-restore-7E0');
      expect(within(panel).getByText(/Connect to the car over CAN/)).toBeTruthy();
      expect(isDisabled(within(panel).getByText('Compare with car'))).toBe(true);
      fireEvent.press(within(panel).getByText('Compare with car'));
      expect(within(panel).queryByTestId('restore-row-3001')).toBeNull();
    } finally {
      spy?.mockRestore();
    }
  });

  it('blocks restoring a snapshot taken from another car (VIN mismatch)', async () => {
    await backupThenChange({
      beforeExpand: () => {
        const [b] = useCarBackupStore.getState().backups;
        act(() =>
          useCarBackupStore.setState({
            backups: [{ ...b, vehicle: { ...b.vehicle, vin: 'WVWZZZ1KZAW000001' } }],
          }),
        );
      },
    });
    act(() => useAdaptationsStore.getState().setUnlocked(true));
    expect(screen.getByTestId('backup-vehicle-mismatch')).toHaveTextContent(
      /VIN …00001, but the connected car reports VIN …03398 — restore is blocked/,
    );
    const panel = await compare();
    expect(isDisabled(within(panel).getByText('Restore'))).toBe(true);
    expect(isDisabled(within(panel).getByText('Restore all (1)'))).toBe(true);
    fireEvent.press(within(panel).getByText('Restore'));
    expect(within(panel).queryByText('Confirm restore')).toBeNull();
  });

  it('refuses to start while another backup action holds the shared work gate', async () => {
    await backupThenChange();
    act(() => {
      useBackupWorkStore.setState({ busy: true });
    });
    const panel = screen.getByTestId('adaptation-restore-7E0');
    expect(isDisabled(within(panel).getByText('Busy…'))).toBe(true);
    expect(isDisabled(screen.getByText('Create backup'))).toBe(true);
    act(() => {
      useBackupWorkStore.setState({ busy: false });
    });
    expect(isDisabled(within(panel).getByText('Compare with car'))).toBe(false);
  });

  it('reports a compare that throws instead of letting it escape', async () => {
    await backupThenChange();
    const spy = jest.spyOn(planner, 'planAdaptationRestore').mockImplementationOnce(() => {
      throw new Error('link lost');
    });
    try {
      const panel = screen.getByTestId('adaptation-restore-7E0');
      fireEvent.press(within(panel).getByText('Compare with car'));
      await waitFor(
        () =>
          expect(screen.getByTestId('adaptation-restore-message')).toHaveTextContent(
            'Failed: link lost',
          ),
        { timeout: 4000 },
      );
      expect(within(panel).queryByTestId('restore-row-3001')).toBeNull();
      expect(useBackupWorkStore.getState().busy).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });
});
