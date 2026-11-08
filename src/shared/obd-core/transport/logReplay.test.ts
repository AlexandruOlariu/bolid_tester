import { fixtureFromLog, LoggedIo, ReplayFixture, ReplayTransport } from './logReplay';
import { Elm327Client } from '../elm327/Elm327Client';

const tx = (text: string): LoggedIo => ({ dir: 'tx', text });
const rx = (text: string): LoggedIo => ({ dir: 'rx', text });

describe('log -> replay fixture', () => {
  const log = [
    tx('ATZ'),
    rx('ELM327 v1.5'),
    tx('0100'),
    rx('SEARCHING...\r'),
    rx('41 00 BE 3E B8 11'),
    tx('010C'),
    rx('41 0C 0C D0'),
    tx('010C'), // second read — first one must win in `pairs`
    rx('41 0C 1F 40'),
  ];

  it('pairs commands with the responses that followed (first wins)', () => {
    const f = fixtureFromLog(log, 'passat run');
    expect(f.pairs['ATZ']).toBe('ELM327 v1.5');
    expect(f.pairs['0100']).toBe('SEARCHING...\r41 00 BE 3E B8 11');
    expect(f.pairs['010C']).toBe('41 0C 0C D0');
  });

  it('replays through a real Elm327Client', async () => {
    const t = new ReplayTransport(fixtureFromLog(log));
    await t.connect();
    const client = new Elm327Client(t);
    const r = await client.command('010C');
    expect(r.bytes).toEqual([0x41, 0x0c, 0x0c, 0xd0]);
    const unknown = await client.command('0105');
    expect(unknown.notice).toBe('NO DATA');
    expect((await client.raw('ATE0')).trim()).toBe('OK');
  });

  it('keeps every changed answer in `sequences`, and leaves out commands that never changed', () => {
    const f = fixtureFromLog([...log, tx('ATZ'), rx('ELM327 v1.5')]);
    expect(f.sequences).toEqual({ '010C': ['41 0C 0C D0', '41 0C 1F 40'] });
    expect(fixtureFromLog(log, 'x', { keepSequences: false }).sequences).toBeUndefined();
  });

  it('joins BLE chunks split mid-line and keeps line breaks between ECUs / ISO-TP segments', () => {
    const f = fixtureFromLog([
      tx('03'),
      rx('43 01 01 13\r43 0'), // two ECUs' lines, the second split across notifications
      rx('0\r\r'),
      tx('0902'),
      rx('014\r0: 49 02 01 57 56 57\r1: 5A 5A 5A 31 4B 5A 39\r'),
      rx('2: 57 39 30 33 33 39 38\r\r'),
      tx(''), // a bare-CR wake-up is not a command
      rx('\r'),
      tx('0105'), // no reply at all (timeout) → not recorded
    ]);
    expect(f.pairs['03']).toBe('43 01 01 13\r43 00');
    expect(f.pairs['0902']).toBe(
      '014\r0: 49 02 01 57 56 57\r1: 5A 5A 5A 31 4B 5A 39\r2: 57 39 30 33 33 39 38',
    );
    expect(Object.keys(f.pairs)).toEqual(['03', '0902']);
  });

  it('a replayed multi-ECU answer still parses as one frame per ECU', async () => {
    const t = new ReplayTransport(fixtureFromLog([tx('03'), rx('43 01 01 13\r43 00\r\r')]));
    await t.connect();
    const r = await new Elm327Client(t).command('03');
    expect(r.frames).toEqual([
      [0x43, 0x01, 0x01, 0x13],
      [0x43, 0x00],
    ]);
  });

  it('replays `sequences` in order, then repeats the last answer; `pairs` serve the rest', async () => {
    const fixture: ReplayFixture = {
      pairs: { '03': '43 01 01 13', '0100': '41 00 BE 3E B8 11' },
      sequences: { '03': ['43 01 01 13', '44', '43 00'] },
    };
    const t = new ReplayTransport(fixture);
    await t.connect();
    const client = new Elm327Client(t);
    const answers: string[] = [];
    for (let i = 0; i < 5; i++) answers.push((await client.raw('03')).trim());
    expect(answers).toEqual(['43 01 01 13', '44', '43 00', '43 00', '43 00']);
    expect((await client.command('0100')).bytes).toEqual([0x41, 0x00, 0xbe, 0x3e, 0xb8, 0x11]);
    expect((await client.command('0100')).bytes).toEqual([0x41, 0x00, 0xbe, 0x3e, 0xb8, 0x11]);
  });

  it('meta and expect survive a JSON round trip', () => {
    const f = fixtureFromLog(log, 'faults', {
      meta: {
        source: 'car',
        vehicleId: 'golf-plus-2009-20tdi',
        flow: 'faults',
        adapter: 'ELM327 v2.2',
        protocol: 'ISO_15765_4_CAN_11_500',
        appVersion: '0.1.0',
      },
    });
    f.expect = { storedDtcs: ['P2183'], milOn: true, vin: null, storedDtcsAfterClear: [] };
    const back = JSON.parse(JSON.stringify(f)) as ReplayFixture;
    expect(back).toEqual(f);
    expect(back.meta?.source).toBe('car');
    expect(back.expect?.vin).toBeNull();
  });
});
