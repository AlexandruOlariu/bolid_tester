import { fixtureFromLog, ReplayTransport } from './logReplay';
import { Elm327Client } from '../elm327/Elm327Client';

describe('log -> replay fixture', () => {
  const log = [
    { dir: 'tx' as const, text: 'ATZ' },
    { dir: 'rx' as const, text: 'ELM327 v1.5' },
    { dir: 'tx' as const, text: '0100' },
    { dir: 'rx' as const, text: 'SEARCHING...' },
    { dir: 'rx' as const, text: '41 00 BE 3E B8 11' },
    { dir: 'tx' as const, text: '010C' },
    { dir: 'rx' as const, text: '41 0C 0C D0' },
    { dir: 'tx' as const, text: '010C' }, // second read — first one must win
    { dir: 'rx' as const, text: '41 0C 1F 40' },
  ];

  it('pairs commands with the responses that followed (first wins)', () => {
    const f = fixtureFromLog(log, 'passat run');
    expect(f.pairs['ATZ']).toBe('ELM327 v1.5');
    expect(f.pairs['0100']).toBe('SEARCHING... 41 00 BE 3E B8 11');
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
});
