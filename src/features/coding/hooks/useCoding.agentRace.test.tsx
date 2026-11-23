/** Final review (finding 9): a coding write and an AI agent run's module read on the same session.
 *  The agent's `withModule` holds `DiagnosticSession.exclusive`; the coding write runs its whole
 *  header → backup → write → verify sequence inside `exclusive` too, so the agent's header changes
 *  (its `ATSH` / `ATCRA` and the `resetAddressing` in its `finally`) can never land between the
 *  coding module's `ATSH` and its `2E` / verify read — which used to put the write on another
 *  module, or on the functional header. Simulated Golf, the BCM (70E) long coding. */
import { act, renderHook } from '@testing-library/react-native';
import { createReadOnlySession } from '@/shared/obd-core';
import { getVehicleProfile } from '@/shared/vehicles';
import { adapterLogSnapshot, clearAdapterLog } from '@/shared/state/adapterLog';
import { useSessionStore } from '@/shared/state/sessionStore';
import { connectSimulator } from '@test/simulator';
import { useCodingStore } from '../model/codingStore';
import { useCoding } from './useCoding';

const bcm = getVehicleProfile('golf-plus-2009-20tdi').codingModules!.find(
  (m) => m.reqHeader === '70E',
)!;

const sentCommands = () =>
  adapterLogSnapshot()
    .filter((e) => e.dir === 'tx')
    .map((e) => e.text.trim().toUpperCase().replace(/\s+/g, ''));

const isAddressing = (c: string) => c.startsWith('ATSH') || c.startsWith('ATCRA');

describe('useCoding.write while an AI agent run reads another module', () => {
  it('no foreign ATSH / ATCRA between the coding module header and its write and verify', async () => {
    await connectSimulator();
    useCodingStore.setState({ unlocked: true });
    const { result } = renderHook(() => useCoding());
    const session = useSessionStore.getState().session!;
    const ro = createReadOnlySession(session);
    const next = [0x01, 0x01, 0x10, 0x00];

    clearAdapterLog();
    let ok = false;
    await act(async () => {
      // The agent addresses the engine (7E0 / 7E8) and is mid-block, waiting between two reads,
      // when the user taps Write on the Coding screen.
      const agent = ro.withModule(
        { address: '01', reqHeader: '7E0', rxFilter: '7E8' },
        async (send) => {
          await send('22F187');
          await new Promise((r) => setTimeout(r, 60));
          await send('22F189');
        },
      );
      const write = result.current.write(bcm, next).then((v) => {
        ok = v;
      });
      await Promise.all([agent, write]);
    });

    expect(ok).toBe(true);
    const cmds = sentCommands();
    const start = cmds.indexOf('ATSH70E');
    const writeAt = cmds.findIndex((c, i) => i > start && c.startsWith(`2E${bcm.codingDid}`));
    const verifyAt = cmds.findIndex((c, i) => i > writeAt && c === `22${bcm.codingDid}`);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(writeAt).toBeGreaterThan(start);
    expect(verifyAt).toBeGreaterThan(writeAt);
    const between = cmds.slice(start + 1, verifyAt + 1).filter(isAddressing);
    expect(between).toEqual([`ATCRA${bcm.rxFilter}`]);
    // The agent's reads ran as a block of their own, before the coding write.
    expect(cmds.indexOf('ATSH7E0')).toBeLessThan(start);
    expect(cmds.indexOf('22F189')).toBeLessThan(start);
  });
});
