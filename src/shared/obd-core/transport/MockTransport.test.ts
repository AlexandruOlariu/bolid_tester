import { MockTransport } from './MockTransport';
import type { TransportStatus } from './Transport';
import type { SimScenario } from './MockTransport';
import { buildScenario, kwpLoginSeeds } from './scenarios';
import { getVehicleProfile } from '../../vehicles';
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

  it('answers nothing once disconnected: a write rejects like a closed BLE link (plan W2)', async () => {
    const t = new MockTransport(scenario);
    await expect(t.write(stringToBytes('ATI\r'))).rejects.toThrow(/not connected/);
    await t.connect();
    expect(await ask(t, 'ATE0')).toContain('OK');
    await t.disconnect();
    const heard: string[] = [];
    t.onData((b) => heard.push(bytesToString(b)));
    await expect(t.write(stringToBytes('ATI\r'))).rejects.toThrow(/not connected/);
    await new Promise((r) => setTimeout(r, 5));
    expect(heard).toEqual([]);
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

describe('MockTransport KWP2000 login and local identifiers (plan 22)', () => {
  const HEADER = '8101F1';
  const kwp = (): MockTransport =>
    new MockTransport({
      protocol: 'ISO_9141_2',
      supportedPids: ['010C'],
      kwpLocals: { [HEADER]: { '2A': [0x55], '2B': [0x01] } },
      kwpLogins: { [HEADER]: { code: 12345 } },
      kwpLoginRequired: ['2A'],
    });
  const one = async (t: MockTransport, cmd: string) => dataLines(await ask(t, cmd))[0];

  async function addressed(): Promise<MockTransport> {
    const t = kwp();
    await t.connect();
    expect(await one(t, 'ATSH' + HEADER)).toBe('OK');
    return t;
  }

  it('21 returns the seeded bytes, NO DATA for an unknown lid', async () => {
    const t = await addressed();
    expect(await one(t, '212A')).toBe('612A55');
    expect(await one(t, '2199')).toBe('NODATA');
  });

  it('refuses 3B with 7F3B33 before login, accepts it after 2B with the right code', async () => {
    const t = await addressed();
    expect(await one(t, '1085')).toBe('5085');
    expect(await one(t, '3B2A5A')).toBe('7F3B33');
    expect(await one(t, '212A')).toBe('612A55'); // untouched
    expect(await one(t, '2B3039000000')).toBe('6B');
    expect(await one(t, '3B2A5A')).toBe('7B2A');
    expect(await one(t, '212A')).toBe('612A5A');
  });

  it('drops the login on a session restart (10 85)', async () => {
    const t = await addressed();
    expect(await one(t, '2B3039000000')).toBe('6B');
    expect(await one(t, '1085')).toBe('5085');
    expect(await one(t, '3B2A5A')).toBe('7F3B33');
  });

  it('answers a wrong code with 7F2B35 and stays logged out', async () => {
    const t = await addressed();
    expect(await one(t, '2B0001000000')).toBe('7F2B35');
    expect(await one(t, '3B2A5A')).toBe('7F3B33');
  });

  it('writes a lid that needs no login, and refuses an unknown lid with 7F3B31', async () => {
    const t = await addressed();
    expect(await one(t, '3B2B02')).toBe('7B2B');
    expect(await one(t, '3B9901')).toBe('7F3B31');
  });

  it('a module without a login service answers 7F2B11', async () => {
    const t = new MockTransport({
      protocol: 'ISO_9141_2',
      supportedPids: [],
      kwpLocals: { '*': { '2A': [0x55] } },
    });
    await t.connect();
    expect(await one(t, '2B3039000000')).toBe('7F2B11');
    // The '*' store answers with default (functional) addressing.
    expect(await one(t, '212A')).toBe('612A55');
  });
});

describe('buildScenario KWP seeding (plan 22)', () => {
  it("seeds the Passat's KWP channel, its login gate and the simulator-only placeholder", () => {
    const s = buildScenario('passat-b55-19tdi');
    expect(s.kwpLocals).toEqual({ '8101F1': { '2A': [0x55] } });
    expect(s.kwpLoginRequired).toEqual(['2A']);
    expect(s.kwpLogins).toEqual({ '8101F1': { code: 12345 } });
    // KWP channels are not UDS coding stores.
    expect(s.coding?.['8101F1']).toBeUndefined();
  });

  it('lets a test pin its own login code, and leaves CAN cars without KWP fields', () => {
    expect(
      buildScenario('passat-b55-19tdi', { kwpLogins: { '8101F1': { code: 4242 } } }).kwpLogins,
    ).toEqual({ '8101F1': { code: 4242 } });
    const golf = buildScenario('golf-plus-2009-20tdi');
    expect(golf.kwpLocals).toBeUndefined();
    expect(golf.kwpLogins).toBeUndefined();
    expect(golf.kwpLoginRequired).toBeUndefined();
  });

  it("a profile's documented login code replaces the placeholder (address matched like the code book)", () => {
    const passat = getVehicleProfile('passat-b55-19tdi');
    // buildScenario seeds through kwpLoginSeeds.
    expect(buildScenario('passat-b55-19tdi').kwpLogins).toEqual(
      kwpLoginSeeds('passat-b55-19tdi', passat),
    );
    const documented = {
      ...passat,
      loginCodes: [
        { address: ' 01 ', code: 4711, wsc: 42, purpose: 'Idle', source: 'documented' as const },
      ],
    };
    expect(kwpLoginSeeds('passat-b55-19tdi', documented)).toEqual({
      '8101F1': { code: 4711, wsc: 42 },
    });
    // Lower-case module addresses on either side still match.
    const lower = {
      adaptations: (passat.adaptations ?? []).map((a) => ({ ...a, address: '0a' })),
      loginCodes: [{ address: '0A', code: 777, purpose: '', source: 'user-entered' as const }],
    };
    expect(kwpLoginSeeds('passat-b55-19tdi', lower)).toEqual({ '8101F1': { code: 777 } });
    // A code for another module leaves the placeholder; a profile without KWP channels seeds none.
    const other = {
      ...passat,
      loginCodes: [{ address: '17', code: 1, purpose: '', source: 'documented' as const }],
    };
    expect(kwpLoginSeeds('passat-b55-19tdi', other)).toEqual({ '8101F1': { code: 12345 } });
    expect(
      kwpLoginSeeds('golf-plus-2009-20tdi', getVehicleProfile('golf-plus-2009-20tdi')),
    ).toEqual({});
  });
});

describe('MockTransport extended DIDs belong to the engine (plan 25)', () => {
  /** The whole payload as one hex string (the ELM multi-frame printout de-framed). */
  const payload = async (t: MockTransport, cmd: string) =>
    dataLines(await ask(t, cmd))
      .filter((l, i, all) => !(i === 0 && all.length > 1 && /^[0-9A-F]{3}$/.test(l)))
      .map((l) => l.replace(/^[0-9A-F]:/, ''))
      .join('');

  it('answers 22 F187 / 22 1701 with default addressing and on 7E0 only', async () => {
    const t = new MockTransport(buildScenario('golf-plus-2009-20tdi'));
    await t.connect();
    expect(await payload(t, '22F187')).toMatch(/^62F187/);
    expect(await payload(t, '221701')).toMatch(/^621701/);
    await ask(t, 'ATSH7E0');
    expect(await payload(t, '221701')).toMatch(/^621701/);
    // Another module's header: no engine DIDs (module discovery would otherwise "find" the engine
    // on every candidate). The BCM still answers its own coding DID.
    await ask(t, 'ATSH70E');
    expect(await payload(t, '22F187')).toBe('NODATA');
    expect(await payload(t, '221701')).toBe('NODATA');
    expect(await payload(t, '22F1A0')).toMatch(/^62F1A0/);
    // A module with its own ident answers it, not the engine's.
    await ask(t, 'ATSH760');
    expect(await payload(t, '22F187')).toBe(
      '62F187' + Buffer.from('1K0907379AC').toString('hex').toUpperCase(),
    );
  });
});

describe('MockTransport SecurityAccess model (plan 23)', () => {
  // A test vector, not a routine: seed 12 34 is answered by key ED CB.
  const secured = (): MockTransport =>
    new MockTransport({
      protocol: 'ISO_15765_4_CAN_11_500',
      supportedPids: ['010C'],
      coding: { '70E': { F1A0: [0x01, 0x00, 0x10, 0x00] } },
      security: {
        '70E': { level: 0x03, seed: [0x12, 0x34], key: [0xed, 0xcb], protects: ['2E', '31'] },
      },
    });
  const one = async (t: MockTransport, cmd: string) => dataLines(await ask(t, cmd))[0];

  async function addressed(): Promise<MockTransport> {
    const t = secured();
    await t.connect();
    expect(await one(t, 'ATSH70E')).toBe('OK');
    expect(await one(t, '1003')).toBe('5003');
    return t;
  }

  it('refuses a protected 2E with 7F2E33 while locked; reads stay open', async () => {
    const t = await addressed();
    expect(await one(t, '2EF1A001001000')).toBe('7F2E33');
    expect(await one(t, '3101F00D')).toBe('7F3133');
    expect(await one(t, '22F1A0')).toBe('62F1A001001000');
  });

  it('answers the seed, rejects a wrong key with 7F2735, and accepts the right one', async () => {
    const t = await addressed();
    expect(await one(t, '2703')).toBe('67031234');
    expect(await one(t, '27040000')).toBe('7F2735');
    expect(await one(t, '2703')).toBe('67031234');
    expect(await one(t, '2704EDCB')).toBe('6704');
    expect(await one(t, '2EF1A001011000')).toBe('6EF1A0');
    expect(await one(t, '22F1A0')).toBe('62F1A001011000');
    // Already unlocked: the seed is all zeros.
    expect(await one(t, '2703')).toBe('67030000');
  });

  it('locks out on the third wrong key (7F2736), even for the right key after', async () => {
    const t = await addressed();
    for (const expected of ['7F2735', '7F2735', '7F2736']) {
      expect(await one(t, '2703')).toBe('67031234');
      expect(await one(t, '27041111')).toBe(expected);
    }
    expect(await one(t, '2703')).toBe('7F2736');
    expect(await one(t, '2704EDCB')).toBe('7F2736');
    expect(await one(t, '2EF1A001011000')).toBe('7F2E33');
  });

  it('a key without a seed request is out of sequence; an unknown level is not supported', async () => {
    const t = await addressed();
    expect(await one(t, '2704EDCB')).toBe('7F2724');
    expect(await one(t, '2701')).toBe('7F2712');
  });

  it('10 03 re-locks the module', async () => {
    const t = await addressed();
    expect(await one(t, '2703')).toBe('67031234');
    expect(await one(t, '2704EDCB')).toBe('6704');
    expect(await one(t, '1003')).toBe('5003');
    expect(await one(t, '2EF1A001011000')).toBe('7F2E33');
  });

  it('leaves other headers and scenarios without security on the classic 27 stub', async () => {
    const t = secured();
    await t.connect();
    expect(await one(t, 'ATSH7E0')).toBe('OK');
    expect(await one(t, '2701')).toBe('67010000');
    const plain = new MockTransport(buildScenario('golf-plus-2009-20tdi'));
    await plain.connect();
    expect(await one(plain, 'ATSH70E')).toBe('OK');
    expect(await one(plain, '2703')).toBe('6702');
    expect(await one(plain, '2EF1A001001000')).toBe('6EF1A0');
  });

  it('no default scenario declares security', () => {
    for (const id of [
      'golf-plus-2009-20tdi',
      'passat-b55-19tdi',
      'fiat-punto-2008-12',
      'generic',
    ]) {
      expect(buildScenario(id).security).toBeUndefined();
    }
  });
});
