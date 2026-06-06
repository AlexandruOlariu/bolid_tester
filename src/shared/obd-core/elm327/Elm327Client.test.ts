import { Elm327Client } from './Elm327Client';
import { MockTransport } from '../transport/MockTransport';
import { buildScenario } from '../transport/scenarios';
import { decodePid } from '../obd/pids';
import { Transport } from '../transport/Transport';

describe('Elm327Client', () => {
  it('initializes and reads a PID through the simulator', async () => {
    const t = new MockTransport(buildScenario('golf-plus-2009-20tdi'));
    await t.connect();
    const c = new Elm327Client(t, { commandTimeoutMs: 1000, firstCommandTimeoutMs: 1000 });
    c.attach();
    await c.init();
    const r = await c.command('010C');
    expect(r.notice).toBeNull();
    expect(r.bytes.slice(0, 2)).toEqual([0x41, 0x0c]);
    expect(decodePid('010C', r.bytes.slice(2))).toBeCloseTo(820, 0);
  });

  it('returns NO DATA for an unsupported PID', async () => {
    const t = new MockTransport(buildScenario('golf-plus-2009-20tdi'));
    await t.connect();
    const c = new Elm327Client(t, { commandTimeoutMs: 1000 });
    c.attach();
    await c.init();
    expect((await c.command('01A6')).notice).toBe('NO DATA');
  });

  it('rejects on timeout when nothing responds', async () => {
    const dead: Transport = {
      status: 'connected',
      connect: async () => undefined,
      disconnect: async () => undefined,
      write: async () => undefined,
      onData: () => () => undefined,
    };
    const c = new Elm327Client(dead, { commandTimeoutMs: 30 });
    c.attach();
    await expect(c.raw('ATZ', 30)).rejects.toThrow(/timeout/i);
  });
});
