import { DRAIN_GRACE_MS, Elm327Client, Elm327ClosedError, isRepeatSafe } from './Elm327Client';
import { MockTransport } from '../transport/MockTransport';
import { buildScenario } from '../transport/scenarios';
import { decodePid } from '../obd/pids';
import { Transport } from '../transport/Transport';
import { bytesToString } from '../../lib/bytes';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Record every command the client writes (CR stripped, so a bare wake-up `\r` shows as ''). */
function recordTx(t: Transport): string[] {
  const tx: string[] = [];
  const write = t.write.bind(t);
  t.write = (bytes) => {
    tx.push(bytesToString(bytes).replace(/\r$/, ''));
    return write(bytes);
  };
  return tx;
}

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
      onStatusChange: () => () => undefined,
    };
    const c = new Elm327Client(dead, { commandTimeoutMs: 30 });
    c.attach();
    await expect(c.raw('ATZ', 30)).rejects.toThrow(/timeout/i);
  });

  it('withCommandTimeout shortens the timeout for its commands only, then restores it', async () => {
    const dead: Transport = {
      status: 'connected',
      connect: async () => undefined,
      disconnect: async () => undefined,
      write: async () => undefined,
      onData: () => () => undefined,
      onStatusChange: () => () => undefined,
    };
    const c = new Elm327Client(dead, { commandTimeoutMs: 600, wakeAfterIdleMs: 0 });
    c.attach();
    await expect(c.withCommandTimeout(40, () => c.raw('ATI'))).rejects.toThrow(
      /timeout after 40ms/,
    );
    // Restored: the next command waits for the configured 600 ms again.
    await expect(c.raw('ATI')).rejects.toThrow(/timeout after 600ms/);
  });

  it('withCommandTimeout leaves no override behind when two calls overlap without nesting', async () => {
    const dead: Transport = {
      status: 'connected',
      connect: async () => undefined,
      disconnect: async () => undefined,
      write: async () => undefined,
      onData: () => () => undefined,
      onStatusChange: () => () => undefined,
    };
    const c = new Elm327Client(dead, { commandTimeoutMs: 300, wakeAfterIdleMs: 0 });
    c.attach();
    let releaseA!: () => void;
    let releaseB!: () => void;
    const a = c.withCommandTimeout(20, () => new Promise<void>((resolve) => (releaseA = resolve)));
    const b = c.withCommandTimeout(30, () => new Promise<void>((resolve) => (releaseB = resolve)));
    // A finishes first, then B: a saved-and-restored field would end up stuck at A's 20 ms.
    releaseA();
    await a;
    releaseB();
    await b;
    await expect(c.raw('ATI')).rejects.toThrow(/timeout after 300ms/);
  });

  describe('drain-until-prompt after a timeout (plan 12)', () => {
    it('never hands a late reply to the next command', async () => {
      // The simulator answers 200 ms late; the first command gives up after 50 ms. Without the
      // drain, 010C's late "41 0C …" lands in 0105's window and resolves it.
      const t = new MockTransport({ ...buildScenario('golf-plus-2009-20tdi'), latencyMs: 200 });
      await t.connect();
      const c = new Elm327Client(t, {
        commandTimeoutMs: 1000,
        firstCommandTimeoutMs: 1000,
        wakeAfterIdleMs: 0,
      });
      c.attach();
      await expect(c.raw('010C', 50)).rejects.toThrow(/timeout/i);
      const r = await c.command('0105');
      expect(r.bytes.slice(0, 2)).toEqual([0x41, 0x05]);
      expect(r.bytes.slice(0, 2)).not.toEqual([0x41, 0x0c]);
    });

    it('waits at most DRAIN_GRACE_MS for a reply that never comes', async () => {
      const t = new MockTransport(buildScenario('golf-plus-2009-20tdi'));
      await t.connect();
      const c = new Elm327Client(t, {
        commandTimeoutMs: 1000,
        firstCommandTimeoutMs: 1000,
        wakeAfterIdleMs: 0,
      });
      c.attach();
      t.dropResponses(1);
      const timeout = 50;
      const started = Date.now();
      await expect(c.raw('010C', timeout)).rejects.toThrow(/timeout/i);
      const r = await c.command('0105');
      const elapsed = Date.now() - started;
      expect(r.bytes.slice(0, 2)).toEqual([0x41, 0x05]);
      // The next command waited out the grace period, and no longer.
      expect(elapsed).toBeGreaterThanOrEqual(timeout + DRAIN_GRACE_MS - 20);
      expect(elapsed).toBeLessThan(timeout + DRAIN_GRACE_MS + 250);
    });
  });

  describe('sleep / wake (plan 12)', () => {
    // Timings are scaled up from the plan's 10/5/20 ms: Windows timers tick at ~15 ms, so a 10 ms
    // simulated sleep would put the adapter to sleep between two init commands.
    async function sleepyClient(wakeAfterIdleMs: number, sleepAfterIdleMs = 120) {
      const t = new MockTransport({
        ...buildScenario('golf-plus-2009-20tdi'),
        sleepAfterIdleMs,
      });
      await t.connect();
      const tx = recordTx(t);
      const c = new Elm327Client(t, {
        commandTimeoutMs: 300,
        firstCommandTimeoutMs: 300,
        wakeAfterIdleMs,
      });
      c.attach();
      await c.init();
      await c.command('0100'); // a read: repeating it on a bare CR is harmless
      return { t, c, tx };
    }

    it('sends a bare CR wake-up after the idle gap, then the command succeeds', async () => {
      const { c, tx } = await sleepyClient(60);
      await sleep(200);
      const r = await c.command('010C');
      expect(r.bytes.slice(0, 2)).toEqual([0x41, 0x0c]);
      const i = tx.lastIndexOf('010C');
      expect(tx[i - 1]).toBe(''); // the bare `\r` wake-up went out right before 010C
    });

    it('without the wake the simulator swallows the command and it times out', async () => {
      const { c, tx } = await sleepyClient(0);
      await sleep(200);
      await expect(c.command('010C')).rejects.toThrow(/timeout/i);
      expect(tx).not.toContain('');
    });

    it('wakes with ATI (never a bare CR) when repeating the last command is unsafe', async () => {
      // The ATI wake-up is itself swallowed by the sleeping adapter, so the client waits out
      // WAKE_TIMEOUT_MS (600 ms) plus the DRAIN_GRACE_MS (300 ms) drain for a late reply; the
      // simulated sleep must be longer than that, as on a real chip.
      const { c, tx } = await sleepyClient(300, 1200);
      await c.raw('04'); // clear codes — a bare CR would make a real ELM327 run it again
      await sleep(1300);
      const r = await c.command('010C');
      expect(r.bytes.slice(0, 2)).toEqual([0x41, 0x0c]);
      const i = tx.lastIndexOf('010C');
      expect(tx[i - 1]).toBe('ATI');
      expect(tx.slice(tx.lastIndexOf('04'))).not.toContain('');
    });

    it('wakes with ATI after a timed-out command (the adapter may still remember an unsafe one)', async () => {
      // `04` runs; the adapter then sleeps sooner than the client's wake threshold, so the next
      // `03` is swallowed and times out. The adapter's remembered command is still `04`: a bare-CR
      // wake would clear the codes again, so the client must fall back to ATI.
      // Sleep 1200 ms > the swallowed ATI wake's 600 + 300 ms, as in the ATI test above.
      const { c, tx } = await sleepyClient(2000, 1200);
      await c.raw('04');
      await sleep(1300); // asleep, but below the client's 2000 ms wake threshold
      await expect(c.raw('03')).rejects.toThrow(/timeout/i);
      await sleep(2000);
      const r = await c.command('010C');
      expect(r.bytes.slice(0, 2)).toEqual([0x41, 0x0c]);
      expect(tx.slice(tx.lastIndexOf('04'))).not.toContain('');
      expect(tx[tx.lastIndexOf('010C') - 1]).toBe('ATI');
    }, 15_000);

    it('treats a failed write as unknown: next wake is ATI, and any late reply is drained', async () => {
      const t = new MockTransport({
        ...buildScenario('golf-plus-2009-20tdi'),
        sleepAfterIdleMs: 1_000_000,
      });
      await t.connect();
      const tx = recordTx(t);
      const c = new Elm327Client(t, {
        commandTimeoutMs: 300,
        firstCommandTimeoutMs: 300,
        wakeAfterIdleMs: 60,
      });
      c.attach();
      await c.raw('0100');
      const write = t.write.bind(t);
      t.write = async () => {
        throw new Error('GATT busy');
      };
      await expect(c.raw('0105')).rejects.toThrow('GATT busy');
      t.write = write;
      await sleep(150);
      const r = await c.command('010C');
      expect(r.bytes.slice(0, 2)).toEqual([0x41, 0x0c]);
      expect(tx[tx.lastIndexOf('010C') - 1]).toBe('ATI');
    });

    it('drains a late wake-up reply so it never resolves the real command', async () => {
      // Replies arrive 700 ms late — after WAKE_TIMEOUT_MS (600 ms), within the drain grace. A
      // never-sleeping low-power mock answers the bare CR with a prompt (like a real ELM327
      // repeating the last command). Without the drain, the wake's late `>` resolves 010C with an
      // empty reply and every later command gets its predecessor's answer.
      const t = new MockTransport({
        ...buildScenario('golf-plus-2009-20tdi'),
        sleepAfterIdleMs: 1_000_000,
        latencyMs: 700,
      });
      await t.connect();
      const tx = recordTx(t);
      const c = new Elm327Client(t, {
        commandTimeoutMs: 2000,
        firstCommandTimeoutMs: 2000,
        wakeAfterIdleMs: 100,
      });
      c.attach();
      await c.raw('0105');
      await sleep(150);
      const r1 = await c.command('010C');
      expect(tx[tx.lastIndexOf('010C') - 1]).toBe(''); // the bare-CR wake went out (and was late)
      expect(r1.bytes.slice(0, 2)).toEqual([0x41, 0x0c]);
      const r2 = await c.command('0105');
      expect(r2.bytes.slice(0, 2)).toEqual([0x41, 0x05]);
    }, 10_000);

    it('wakes with ATI while CAN auto-formatting is off (raw TP2.0 frames are never repeated)', async () => {
      const t = new MockTransport({
        ...buildScenario('golf-plus-2009-20tdi'),
        sleepAfterIdleMs: 1_000_000,
      });
      await t.connect();
      const tx = recordTx(t);
      const c = new Elm327Client(t, {
        commandTimeoutMs: 300,
        firstCommandTimeoutMs: 300,
        wakeAfterIdleMs: 60,
      });
      c.attach();
      await c.raw('ATCAF0');
      await c.raw('22F190').catch(() => undefined); // looks like a UDS read, but is a raw frame here
      await sleep(150);
      await c.raw('ATRV');
      expect(tx[tx.lastIndexOf('ATRV') - 1]).toBe('ATI');
      await c.raw('ATCAF1');
      await c.raw('22F190').catch(() => undefined);
      await sleep(150);
      await c.raw('ATRV');
      expect(tx[tx.lastIndexOf('ATRV') - 1]).toBe(''); // auto-formatting back on: bare CR again
    });

    it('does not wake while the link is busy', async () => {
      const { c, tx } = await sleepyClient(1000);
      await c.command('010C');
      await c.command('0105');
      expect(tx.filter((x) => x === '' || x === 'ATI')).toEqual(['ATI']); // only before ATZ
      expect(tx.indexOf('ATI')).toBeLessThan(tx.indexOf('ATZ'));
    });
  });

  describe('close() — no command outlives the session (plan W2)', () => {
    /** A link that never answers, so a command only ends by its (long) timeout — or by close(). */
    const silent = (): Transport => ({
      status: 'connected',
      connect: async () => undefined,
      disconnect: async () => undefined,
      write: async () => undefined,
      onData: () => () => undefined,
      onStatusChange: () => () => undefined,
    });
    afterEach(() => jest.useRealTimers());

    it('rejects the command in flight and every queued one at once, leaving no timer', async () => {
      jest.useFakeTimers();
      const t = silent();
      const tx = recordTx(t);
      const c = new Elm327Client(t, { commandTimeoutMs: 60_000, wakeAfterIdleMs: 0 });
      c.attach();
      const first = c.raw('0100');
      const second = c.raw('0105');
      const firstErr = first.catch((e: unknown) => e);
      const secondErr = second.catch((e: unknown) => e);
      // Let the first command reach the link (it now waits on its 60 s timer).
      for (let i = 0; i < 5; i++) await Promise.resolve();
      expect(tx).toEqual(['0100']);
      expect(jest.getTimerCount()).toBe(1);

      c.close();
      expect(await firstErr).toBeInstanceOf(Elm327ClosedError);
      expect(await secondErr).toBeInstanceOf(Elm327ClosedError);
      expect((await firstErr) as Error).toHaveProperty('message', 'ELM327 link closed');
      // The queued command never went out, and the timeout timer is gone.
      expect(tx).toEqual(['0100']);
      expect(jest.getTimerCount()).toBe(0);
      expect(c.isClosed).toBe(true);
    });

    it('refuses later commands and monitor mode until reopen()', async () => {
      const t = new MockTransport(buildScenario('golf-plus-2009-20tdi'));
      await t.connect();
      const tx = recordTx(t);
      const c = new Elm327Client(t, { commandTimeoutMs: 1000, wakeAfterIdleMs: 0 });
      c.attach();
      expect(await c.raw('ATE0')).toContain('OK');
      c.close();
      await expect(c.raw('ATI')).rejects.toBeInstanceOf(Elm327ClosedError);
      await expect(c.startMonitor(() => undefined)).rejects.toBeInstanceOf(Elm327ClosedError);
      expect(tx).toEqual(['ATE0']);

      c.reopen();
      c.attach();
      expect(await c.raw('ATI')).toContain('ELM327');
      expect(tx).toEqual(['ATE0', 'ATI']);
    });

    it('ends monitor mode, so the held queue rejects instead of hanging', async () => {
      const t = new MockTransport(buildScenario('golf-plus-2009-20tdi'));
      await t.connect();
      const c = new Elm327Client(t, { commandTimeoutMs: 1000, wakeAfterIdleMs: 0 });
      c.attach();
      await c.startMonitor(() => undefined);
      const queued = c.raw('0100');
      c.close();
      await expect(queued).rejects.toBeInstanceOf(Elm327ClosedError);
      expect(c.monitoring).toBe(false);
      await t.disconnect();
    });
  });

  describe('isRepeatSafe', () => {
    it('allows reads and idempotent AT commands', () => {
      for (const cmd of ['010C', '0100', '03', '07', '0A', '0902', '22F190', '190208', '3E00']) {
        expect(isRepeatSafe(cmd)).toBe(true);
      }
      for (const cmd of ['ATI', 'ATRV', 'ATDPN', 'ATE0', 'ATH1', 'ATSH7E0', 'ATCRA7E8', 'ATST64']) {
        expect(isRepeatSafe(cmd)).toBe(true);
      }
    });

    it('rejects writes, clears, routines, resets and the unknown', () => {
      for (const cmd of ['04', '14FFFFFF', '2E06000102', '2F0950030001', '3101FF00', '1003']) {
        expect(isRepeatSafe(cmd)).toBe(false);
      }
      for (const cmd of ['2701', 'ATZ', 'ATWS', 'ATD', 'ATSP0', 'ATMA', '3B01']) {
        expect(isRepeatSafe(cmd)).toBe(false);
      }
      expect(isRepeatSafe(null)).toBe(false);
    });

    it('in raw-CAN mode (ATCAF0) only AT commands are repeat-safe', () => {
      for (const cmd of ['0105', '22F190', '190208', '3E00', '10A0', '0A']) {
        expect(isRepeatSafe(cmd, true)).toBe(false);
      }
      for (const cmd of ['ATRV', 'ATH1', 'ATSH740']) expect(isRepeatSafe(cmd, true)).toBe(true);
    });
  });
});
