import { DiagnosticSession } from '../session/DiagnosticSession';
import { MockTransport } from '../transport/MockTransport';
import { buildScenario } from '../transport/scenarios';
import { MONITOR_UNAVAILABLE_MESSAGE, type Transport } from '../transport/Transport';
import { bytesToString } from '../../lib/bytes';
import {
  BUS_LISTEN_MAX_MS,
  AGENT_EXCLUDED_MODULE_ADDRESSES,
  ModuleNotAllowedError,
  ReadOnlySession,
  WriteBlockedError,
  createReadOnlySession,
  isReadOnlyRequest,
} from './readOnlySession';

describe('isReadOnlyRequest', () => {
  it.each([
    ['0100', true],
    ['03', true],
    ['19 02 FF', true],
    ['22F187', true],
    ['1003', true],
    ['1089', true],
    ['1085', false],
    ['04', false],
    ['14FFFFFF', false],
    ['2E 06 00', false],
    ['2F', false],
    ['31 01', false],
    ['3B 2A', false],
    ['2701', false],
    ['1002', false],
    ['', false],
  ])('isReadOnlyRequest(%s) = %s', (c, ok) => expect(isReadOnlyRequest(c)).toBe(ok));

  it('accepts every allowlisted service and the read-safe session sub-functions only', () => {
    for (const sid of ['01', '02', '03', '06', '07', '09', '0A', '19', '1A', '21', '22', '3E'])
      expect(isReadOnlyRequest(sid + '00')).toBe(true);
    for (const sub of ['01', '03', '81', '89']) expect(isReadOnlyRequest('10' + sub)).toBe(true);
    expect(isReadOnlyRequest('10')).toBe(false);
    expect(isReadOnlyRequest('1083')).toBe(false);
  });

  it('refuses adapter commands and malformed hex', () => {
    for (const c of ['ATSH7E0', 'ATCRA', 'ATZ', 'STDI', '0x03', '010', '22 F1 8', '  '])
      expect(isReadOnlyRequest(c)).toBe(false);
    expect(isReadOnlyRequest('0a 00')).toBe(true);
  });
});

describe('createReadOnlySession', () => {
  let session: DiagnosticSession;
  let ro: ReadOnlySession;
  /** Every command written to the Golf simulator, in order. */
  let sent: string[];

  beforeEach(async () => {
    const mock = new MockTransport(buildScenario('golf-plus-2009-20tdi'));
    sent = [];
    const write = mock.write.bind(mock);
    mock.write = (b: Uint8Array) => {
      sent.push(bytesToString(b).trim());
      return write(b);
    };
    session = new DiagnosticSession(mock, { commandTimeoutMs: 1000, firstCommandTimeoutMs: 1000 });
    await session.connect();
    ro = createReadOnlySession(session);
  });

  it('excludes the airbag and immobilizer addresses', () => {
    expect([...AGENT_EXCLUDED_MODULE_ADDRESSES]).toEqual(['15', '25']);
  });

  it('exposes no write or raw members', () => {
    for (const k of ['clearDtcs', 'send', 'setHeader', 'setRxFilter', 'client', 'startSniffer'])
      expect(k in ro).toBe(false);
  });

  it('mirrors the session state and reads through it', async () => {
    expect(ro.currentProtocol).toBe(session.currentProtocol);
    expect(ro.supportedPids).toEqual(session.supportedPids);
    expect(ro.canMonitor).toBe(session.canMonitor);
    expect(ro.effectivePids()).toEqual(session.effectivePids());
    expect((await ro.readValue('010C'))?.value).toBeCloseTo(820, 0);
    expect(Object.keys(await ro.pollOnce(['010C', '0105']))).toEqual(
      expect.arrayContaining(['010C', '0105']),
    );
    expect((await ro.readDtcs('03')).map((d) => d.code)).toEqual(
      expect.arrayContaining(['P2183', 'P2015']),
    );
    expect(await ro.readReadiness()).not.toBeNull();
    expect(await ro.readVin()).toHaveLength(17);
    expect(await ro.protocolNumber()).toBe(session.currentProtocol);
    expect(typeof (await ro.adapterVersion())).toBe('string');
  });

  it('request() sends a read and returns the response bytes', async () => {
    const bytes = await ro.request('0100');
    expect(bytes?.[0]).toBe(0x41);
  });

  it('request() blocks a clear before any traffic', async () => {
    const before = sent.length;
    await expect(ro.request('04')).rejects.toBeInstanceOf(WriteBlockedError);
    await expect(ro.request('04')).rejects.toThrow('Blocked: 04 is not a read request.');
    expect(sent.length).toBe(before);
  });

  it('the typed reads refuse an argument that is not a read, before any traffic', async () => {
    const before = sent.length;
    const blocked = (p: Promise<unknown>) => expect(p).rejects.toBeInstanceOf(WriteBlockedError);
    await blocked(ro.readValue('04'));
    await blocked(ro.readValue('14FFFFFF'));
    await blocked(ro.pollOnce(['010C', '04']));
    await blocked(ro.readDtcs('04' as '03'));
    await blocked(ro.readExtended('F190 04'));
    await blocked(ro.readExtended('2E0600'));
    await blocked(ro.pollExtendedOnce(['F190', '0600 01']));
    await blocked(ro.readMode06('A2;04'));
    await blocked(ro.readMode05('0104'));
    await blocked(ro.readMode05('01', '04 '));
    await blocked(ro.readFreezeFrame(['04']));
    await blocked(ro.readFreezeFrames(['010C', '14']));
    expect(sent.length).toBe(before);
  });

  it('the typed reads still accept well-formed arguments', async () => {
    expect(await ro.readDtcs('07')).toEqual(expect.any(Array));
    expect(await ro.readDtcs('0A')).toEqual(expect.any(Array));
    expect(await ro.pollExtendedOnce(['F190'])).toHaveProperty('F190');
    expect(await ro.readMode06('A2')).toEqual(expect.any(Array));
    expect(await ro.readFreezeFrame(['010C'])).toBeDefined();
  });

  it('a write through withModule is blocked before any traffic', async () => {
    const before = sent.length;
    await expect(
      ro.withModule({ reqHeader: '7E0' }, (send) => send('14FFFFFF')),
    ).rejects.toBeInstanceOf(WriteBlockedError);
    expect(sent.slice(before).some((c) => c.startsWith('14'))).toBe(false);
  });

  it('withModule reads the addressed module through the filtered send', async () => {
    const bytes = await ro.withModule({ reqHeader: '7E0', rxFilter: '7E8' }, (send) =>
      send('22F187'),
    );
    expect(bytes?.[0]).toBe(0x62);
    const read = sent.lastIndexOf('22F187');
    expect(read).toBeGreaterThan(sent.lastIndexOf('ATSH7E0'));
    expect(read).toBeGreaterThan(sent.lastIndexOf('ATCRA7E8'));
    expect(sent.slice(-2)).toEqual(['ATSH7DF', 'ATCRA']);
  });

  it('restores addressing even when fn throws', async () => {
    await expect(
      ro.withModule({ reqHeader: '7E0', rxFilter: '7E8' }, async () => {
        throw new Error('x');
      }),
    ).rejects.toThrow('x');
    expect((await ro.readDtcs('03')).length).toBeGreaterThanOrEqual(0); // a stale ATCRA would answer NO DATA → throw
  });

  it('withModule holds the session: a concurrent poll waits until addressing is restored', async () => {
    let release!: () => void;
    const inside = ro.withModule(
      { reqHeader: '7E0', rxFilter: '7E8' },
      () => new Promise<void>((r) => (release = r)),
    );
    const poll = session.exclusive(() => session.pollOnce(['010C']));
    await Promise.resolve();
    expect(sent.some((c) => c.startsWith('010C'))).toBe(false);
    release();
    await Promise.all([inside, poll]);
    expect(sent.findIndex((c) => c.startsWith('010C'))).toBeGreaterThan(sent.lastIndexOf('ATCRA'));
  });

  it('refuses the airbag and immobilizer addresses without traffic', async () => {
    const before = sent.length;
    await expect(
      ro.withModule({ address: '15', reqHeader: '715' }, async () => 1),
    ).rejects.toBeInstanceOf(ModuleNotAllowedError);
    await expect(
      ro.withModule({ address: '25', reqHeader: '725' }, async () => 1),
    ).rejects.toBeInstanceOf(ModuleNotAllowedError);
    await expect(ro.withModule({ address: '15', reqHeader: '715' }, async () => 1)).rejects.toThrow(
      "Module 15 is outside the agent's scope.",
    );
    expect(sent.length).toBe(before);
  });

  it('refuses the known airbag and immobilizer headers even without an address', async () => {
    const before = sent.length;
    await expect(ro.withModule({ reqHeader: '715' }, async () => 1)).rejects.toBeInstanceOf(
      ModuleNotAllowedError,
    );
    await expect(ro.withModule({ reqHeader: '711' }, async () => 1)).rejects.toBeInstanceOf(
      ModuleNotAllowedError,
    );
    expect(sent.length).toBe(before);
  });

  it('refuses a header or filter that is not a plain CAN id, without traffic', async () => {
    const before = sent.length;
    await expect(ro.withModule({ reqHeader: '7E0\r04' }, async () => 1)).rejects.toBeInstanceOf(
      ModuleNotAllowedError,
    );
    await expect(
      ro.withModule({ reqHeader: '7E0', rxFilter: '7E8 04' }, async () => 1),
    ).rejects.toBeInstanceOf(ModuleNotAllowedError);
    await expect(ro.withModule({ reqHeader: '' }, async () => 1)).rejects.toBeInstanceOf(
      ModuleNotAllowedError,
    );
    expect(sent.length).toBe(before);
  });
});

describe('ReadOnlySession.listenBus', () => {
  /** A connected simulator session; `sent` records every command written to it. */
  async function connected(
    scenario: string,
    capabilities?: Transport['capabilities'],
  ): Promise<{ session: DiagnosticSession; sent: string[] }> {
    const mock = new MockTransport(buildScenario(scenario));
    const sent: string[] = [];
    const transport: Transport = {
      get status() {
        return mock.status;
      },
      ...(capabilities ? { capabilities } : {}),
      connect: () => mock.connect(),
      disconnect: () => mock.disconnect(),
      write: (b) => {
        sent.push(bytesToString(b).trim());
        return mock.write(b);
      },
      onData: (l) => mock.onData(l),
      onStatusChange: (l) => mock.onStatusChange(l),
    };
    const session = new DiagnosticSession(transport, {
      commandTimeoutMs: 1000,
      firstCommandTimeoutMs: 1000,
    });
    await session.connect();
    return { session, sent };
  }

  it('listenBus returns the Golf monitor frames and stops the monitor', async () => {
    const { session: golfSession } = await connected('golf-plus-2009-20tdi');
    const lines = await createReadOnlySession(golfSession).listenBus(200);
    expect(lines.length).toBeGreaterThan(0);
    expect(golfSession.sniffing).toBe(false);
  });

  it('only monitors (ATH1, ATMA, the interrupt, ATH0) and leaves the link usable', async () => {
    const { session, sent } = await connected('golf-plus-2009-20tdi');
    const before = sent.length;
    const lines = await createReadOnlySession(session).listenBus(200);
    expect(lines.every((l) => l.trim().length > 0)).toBe(true);
    expect(sent.slice(before)).toEqual(['ATH1', 'ATMA', '', 'ATH0']);
    expect((await session.readValue('010C'))?.value).toBeCloseTo(820, 0);
  });

  it('clamps the window to 10 s', async () => {
    const { session } = await connected('golf-plus-2009-20tdi');
    expect(BUS_LISTEN_MAX_MS).toBe(10_000);
    jest.useFakeTimers();
    try {
      let done = false;
      const listening = createReadOnlySession(session)
        .listenBus(60_000)
        .then((l) => {
          done = true;
          return l;
        });
      await jest.advanceTimersByTimeAsync(9_900);
      expect(done).toBe(false);
      expect(session.sniffing).toBe(true);
      await jest.advanceTimersByTimeAsync(1_000);
      expect(done).toBe(true);
      expect((await listening).length).toBeGreaterThan(0);
      expect(session.sniffing).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it('refuses a link that cannot stream the monitor before sending anything', async () => {
    const { session, sent } = await connected('golf-plus-2009-20tdi', { monitor: false });
    const before = sent.length;
    await expect(createReadOnlySession(session).listenBus(200)).rejects.toThrow(
      MONITOR_UNAVAILABLE_MESSAGE,
    );
    expect(sent).toHaveLength(before);
  });

  it('refuses a K-line car before sending anything', async () => {
    const { session, sent } = await connected('passat-b55-19tdi');
    const before = sent.length;
    await expect(createReadOnlySession(session).listenBus(200)).rejects.toThrow(
      'Bus listening needs a CAN car.',
    );
    expect(sent).toHaveLength(before);
    expect(session.sniffing).toBe(false);
  });

  it('never joins or stops a monitor run someone else started', async () => {
    const { session, sent } = await connected('golf-plus-2009-20tdi');
    await session.startSniffer(() => undefined);
    const before = sent.length;
    await expect(createReadOnlySession(session).listenBus(200)).rejects.toThrow(
      'The bus monitor is already running.',
    );
    expect(sent).toHaveLength(before);
    expect(session.sniffing).toBe(true);
    await session.stopSniffer();
  });
});
