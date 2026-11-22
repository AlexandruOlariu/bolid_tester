/** The driver gate (plan 34a): the agent run asks, the screen answers; Stop cancels a pending ask
 *  as "Can't" so a run never waits on a prompt that is gone. */
import { createDriverGate } from './driverGate';

describe('createDriverGate', () => {
  it('answer resolves the pending ask; cancel resolves it as cant', async () => {
    const g = createDriverGate();
    const p = g.ask('hold_2500_rpm');
    expect(g.pending()).toBe('hold_2500_rpm');
    g.answer({ kind: 'done' });
    await expect(p).resolves.toEqual({ kind: 'done' });
    const q = g.ask('restart_engine');
    g.cancel();
    await expect(q).resolves.toEqual({ kind: 'cant' });
  });

  it('nothing is pending after an answer, and an answer with nothing pending is ignored', async () => {
    const g = createDriverGate();
    expect(g.pending()).toBeNull();
    g.answer({ kind: 'done' });
    g.cancel();
    const p = g.ask('start_engine_idle');
    g.answer({ kind: 'choice', value: 'yes' });
    await expect(p).resolves.toEqual({ kind: 'choice', value: 'yes' });
    expect(g.pending()).toBeNull();
  });

  it('a new ask settles a superseded one as cant', async () => {
    const g = createDriverGate();
    const first = g.ask('restart_engine');
    const second = g.ask('electrical_load_on');
    await expect(first).resolves.toEqual({ kind: 'cant' });
    expect(g.pending()).toBe('electrical_load_on');
    g.answer({ kind: 'done' });
    await expect(second).resolves.toEqual({ kind: 'done' });
  });
});
