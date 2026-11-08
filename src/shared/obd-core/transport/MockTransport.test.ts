import { MockTransport } from './MockTransport';
import type { TransportStatus } from './Transport';
import type { SimScenario } from './MockTransport';
import { bytesToString, stringToBytes } from '../../lib/bytes';

const scenario: SimScenario = { protocol: 'ISO_15765_4_CAN_11_500', supportedPids: ['0105'] };

function record(t: MockTransport): { events: TransportStatus[]; unsub: () => void } {
  const events: TransportStatus[] = [];
  const unsub = t.onStatusChange((s) => events.push(s));
  return { events, unsub };
}

/** Send one command and resolve with the raw response text (the mock emits it in a single chunk). */
function ask(t: MockTransport, cmd: string): Promise<string> {
  return new Promise((resolve) => {
    const unsub = t.onData((b) => {
      unsub();
      resolve(bytesToString(b));
    });
    void t.write(stringToBytes(cmd + '\r'));
  });
}

/** Hex data lines (prompt/whitespace stripped, spaces removed), one per responding ECU. */
function dataLines(raw: string): string[] {
  return raw
    .replace(/>/g, '')
    .split(/[\r\n]+/)
    .map((l) => l.replace(/\s+/g, ''))
    .filter(Boolean);
}

describe('MockTransport status events', () => {
  it('emits connecting then connected on connect()', async () => {
    const t = new MockTransport(scenario);
    const { events } = record(t);
    await t.connect();
    expect(events).toEqual(['connecting', 'connected']);
    expect(t.status).toBe('connected');
  });

  it('emits disconnected on an explicit disconnect()', async () => {
    const t = new MockTransport(scenario);
    await t.connect();
    const { events } = record(t);
    await t.disconnect();
    expect(events).toEqual(['disconnected']);
    expect(t.status).toBe('disconnected');
  });

  it('simulateDisconnect() emits an unsolicited disconnected transition', async () => {
    const t = new MockTransport(scenario);
    await t.connect();
    const { events } = record(t);
    t.simulateDisconnect();
    expect(events).toEqual(['disconnected']);
    expect(t.status).toBe('disconnected');
  });

  it('does not re-emit when already in the target status', async () => {
    const t = new MockTransport(scenario);
    await t.connect();
    const { events } = record(t);
    t.simulateDisconnect();
    t.simulateDisconnect(); // already disconnected — no second event
    await t.disconnect();
    expect(events).toEqual(['disconnected']);
  });

  it('stops notifying after unsubscribe', async () => {
    const t = new MockTransport(scenario);
    const { events, unsub } = record(t);
    await t.connect();
    unsub();
    await t.disconnect();
    expect(events).toEqual(['connecting', 'connected']);
  });
});

describe('MockTransport multi-ECU responses (real ATH0 format)', () => {
  const multi: SimScenario = {
    protocol: 'ISO_15765_4_CAN_11_500',
    supportedPids: ['0104', '010C'],
    storedDtcs: ['P0301'],
    secondaryEcus: [{ supportedPids: ['0104'], storedDtcs: ['U0100'] }],
  };

  it('answers Mode 03 with one line per ECU', async () => {
    const t = new MockTransport(multi);
    await t.connect();
    const lines = dataLines(await ask(t, '03'));
    // Primary: 43 01 <P0301=0301>; secondary: 43 01 <U0100=C100>.
    expect(lines).toEqual(['43010301', '4301C100']);
  });

  it('a no-fault secondary ECU still answers on its own line (43 00)', async () => {
    const t = new MockTransport({ ...multi, secondaryEcus: [{ supportedPids: ['0104'] }] });
    await t.connect();
    const lines = dataLines(await ask(t, '03'));
    expect(lines).toEqual(['43010301', '4300']);
  });

  it('answers 0100 as one bitmap line per ECU', async () => {
    const t = new MockTransport(multi);
    await t.connect();
    const lines = dataLines(await ask(t, '0100'));
    expect(lines).toHaveLength(2);
    for (const l of lines) expect(l.startsWith('4100')).toBe(true);
  });

  it('is single-line when there are no secondary ECUs', async () => {
    const t = new MockTransport({
      protocol: 'ISO_15765_4_CAN_11_500',
      supportedPids: ['0104'],
      storedDtcs: ['P0301'],
    });
    await t.connect();
    expect(dataLines(await ask(t, '03'))).toEqual(['43010301']);
    expect(dataLines(await ask(t, '0100'))).toHaveLength(1);
  });
});

/** Collect everything the mock emits for `ms` after one write (resolves with '' when it is silent). */
function listen(t: MockTransport, cmd: string, ms = 60): Promise<string> {
  return new Promise((resolve) => {
    let got = '';
    const unsub = t.onData((b) => {
      got += bytesToString(b);
    });
    void t.write(stringToBytes(cmd + '\r'));
    setTimeout(() => {
      unsub();
      resolve(got);
    }, ms);
  });
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('MockTransport low-power model (sleepAfterIdleMs, plan 12)', () => {
  it('swallows the first command after the idle gap and answers a bare CR with a prompt', async () => {
    // Wide margins: each listen() takes 60 ms, far below the 400 ms sleep threshold, and the idle
    // waits are well above it, so scheduler/timer jitter under parallel Jest cannot flip the outcome.
    const t = new MockTransport({ ...scenario, sleepAfterIdleMs: 400 });
    await t.connect();
    expect(await listen(t, '0105')).toContain('41057D'); // awake: answered
    await wait(600);
    expect(await listen(t, '0105')).toBe(''); // asleep: the byte only woke the chip
    expect(await listen(t, '0105')).toContain('41057D'); // awake again
    await wait(600);
    expect(await listen(t, '')).toBe('\r>'); // a bare CR wakes it and gets a prompt
    expect(await listen(t, '0105')).toContain('41057D');
  });

  it('never sleeps without the option (classic simulator unchanged)', async () => {
    const t = new MockTransport(scenario);
    await t.connect();
    await wait(120);
    expect(await listen(t, '0105')).toContain('41057D');
    expect(await listen(t, '')).toBe(''); // a bare CR is still ignored
  });
});

describe('MockTransport dropResponses (plan 12)', () => {
  it('gives the next n non-AT commands no reply at all, AT commands still answered', async () => {
    const t = new MockTransport(scenario);
    await t.connect();
    t.dropResponses(2);
    expect(await listen(t, 'ATRV')).toContain('12.3V');
    expect(await listen(t, '0105')).toBe('');
    expect(await listen(t, '0100')).toBe('');
    expect(await listen(t, '0105')).toContain('41057D');
  });

  it('with includeAt drops AT commands too (no reply to ATZ)', async () => {
    const t = new MockTransport(scenario);
    await t.connect();
    t.dropResponses(1, { includeAt: true });
    expect(await listen(t, 'ATZ')).toBe('');
    expect(await listen(t, 'ATZ')).toContain('ELM327');
  });
});
