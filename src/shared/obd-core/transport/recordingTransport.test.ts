import { logRxText, logTxText, recordSession, RecordingTransport } from './recordingTransport';
import { ReplayTransport } from './logReplay';
import { MockTransport } from './MockTransport';
import { buildScenario } from './scenarios';
import { DiagnosticSession } from '../session/DiagnosticSession';
import { stringToBytes } from '../../lib/bytes';
import { REDACTED_LOGIN, redactCommand } from './redact';

const OPTS = { commandTimeoutMs: 1000, firstCommandTimeoutMs: 1000 };

describe('log text normalisation', () => {
  it('tx drops line endings; rx drops the prompt but keeps every line break as CR', () => {
    expect(logTxText(stringToBytes('0100\r'))).toBe('0100');
    expect(logTxText(stringToBytes('\r'))).toBe('');
    expect(logRxText(stringToBytes('43 01 01 13\r\n43 00\n\r>'))).toBe('43 01 01 13\r43 00\r');
    // Not trimmed: a notification that ends mid-line must not lose the boundary.
    expect(logRxText(stringToBytes('41 0C '))).toBe('41 0C ');
  });

  it('tx redacts a KWP login (2B + code + workshop code), and nothing else', () => {
    expect(logTxText(stringToBytes('2B3039000000\r'))).toBe(REDACTED_LOGIN);
    expect(logTxText(stringToBytes('2B 30 39 00 00 2A\r'))).toBe(REDACTED_LOGIN);
    expect(logTxText(stringToBytes('2B3039000000\r'))).not.toContain('3039');
    expect(redactCommand('1085')).toBe('1085');
    expect(redactCommand('3B2A5A')).toBe('3B2A5A');
    expect(redactCommand('ATSH8101F1')).toBe('ATSH8101F1');
  });
});

describe('RecordingTransport', () => {
  it('captures tx and rx in order without changing what the session sees', async () => {
    const rec = new RecordingTransport(new MockTransport(buildScenario('golf-plus-2009-20tdi')));
    const session = new DiagnosticSession(rec, OPTS);
    await session.connect();
    const rpm = await session.readValue('010C');
    expect(rpm?.value).toBeCloseTo(820, 0);
    await session.disconnect();

    expect(rec.log[0]).toMatchObject({ dir: 'tx' });
    const dirs = rec.log.map((e) => e.dir);
    // Every command is followed by its reply before the next command goes out (half-duplex).
    for (let i = 0; i < dirs.length - 1; i++) {
      if (dirs[i] === 'tx') expect(dirs[i + 1]).toBe('rx');
    }
    const txs = rec.log.filter((e) => e.dir === 'tx').map((e) => e.text);
    expect(txs).toContain('ATZ');
    expect(txs.indexOf('0100')).toBeGreaterThan(txs.indexOf('ATZ'));
    expect(txs[txs.length - 1]).toBe('010C');
    const last = rec.log[rec.log.length - 1];
    expect(last).toMatchObject({ dir: 'rx' });
    expect(last.text).toContain('410C0CD0');
  });

  for (const id of ['generic', 'golf-plus-2009-20tdi', 'fiat-punto-2008-12', 'passat-b55-19tdi']) {
    it(`${id}: a recorded connect replays to the identical SessionInfo`, async () => {
      let live: unknown = null;
      const fixture = await recordSession(
        new MockTransport(buildScenario(id)),
        async (session) => {
          live = await session.connect();
        },
        { source: 'simulator', vehicleId: id, flow: 'connect' },
        OPTS,
      );
      expect(fixture.meta).toEqual({ source: 'simulator', vehicleId: id, flow: 'connect' });
      expect(fixture.name).toBe('connect');

      const replayed = await new DiagnosticSession(new ReplayTransport(fixture), OPTS).connect();
      expect(replayed).toEqual(live);
    });
  }

  it('a recorded clear flow replays before/after through `sequences`', async () => {
    const fixture = await recordSession(
      new MockTransport(buildScenario('golf-plus-2009-20tdi', { storedDtcs: ['P0299'] })),
      async (session) => {
        await session.connect();
        await session.readDtcs('03');
        await session.clearDtcs();
        await session.readDtcs('03');
      },
      { source: 'simulator', vehicleId: 'golf-plus-2009-20tdi', flow: 'clear' },
      OPTS,
    );
    expect(fixture.sequences?.['03']).toHaveLength(2);

    const session = new DiagnosticSession(new ReplayTransport(fixture), OPTS);
    await session.connect();
    expect((await session.readDtcs('03')).map((d) => d.code)).toEqual(['P0299']);
    expect(await session.clearDtcs()).toBe(true);
    expect(await session.readDtcs('03')).toEqual([]);
  });

  it('disconnects the session even when the flow throws', async () => {
    const mock = new MockTransport(buildScenario('generic'));
    await expect(
      recordSession(
        mock,
        async (session) => {
          await session.connect();
          throw new Error('flow failed');
        },
        { source: 'simulator', vehicleId: 'generic', flow: 'connect' },
        OPTS,
      ),
    ).rejects.toThrow('flow failed');
    expect(mock.status).toBe('disconnected');
  });
});
