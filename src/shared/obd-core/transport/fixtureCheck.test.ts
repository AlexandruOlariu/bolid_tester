/** `checkReplayFixture` on the shapes a real on-car export produces but the simulator recorder
 *  never does: a log cleared after connecting (no connect traffic) and a clear flow with several
 *  `03` reads before the `04`. See docs/testing.md → "Recording results". */
import { checkReplayFixture, hasConnectTraffic } from './fixtureCheck';
import { fixtureFromLog } from './logReplay';
import { MockTransport } from './MockTransport';
import { RecordingTransport } from './recordingTransport';
import { buildScenario } from './scenarios';
import { DiagnosticSession } from '../session/DiagnosticSession';

const OPTS = { commandTimeoutMs: 1000, firstCommandTimeoutMs: 1000 };
const GOLF_CODES = ['P2183', 'P2015', 'P0121'];

/** Connect to the simulated Golf, then (like Settings → Adapter log → Clear) keep only what the
 *  flow logs after the connect. */
async function recordAfterConnect(run: (s: DiagnosticSession) => Promise<void>) {
  const rec = new RecordingTransport(new MockTransport(buildScenario('golf-plus-2009-20tdi')));
  const session = new DiagnosticSession(rec, OPTS);
  await session.connect();
  const from = rec.log.length;
  await run(session);
  await session.disconnect();
  return rec.log.slice(from);
}

describe('checkReplayFixture', () => {
  it('replays a flow recorded mid-session (no connect traffic) without the connect handshake', async () => {
    const log = await recordAfterConnect(async (s) => {
      await s.readReadiness();
      await s.readDtcs('03');
      await s.readDtcs('07');
    });
    const fixture = fixtureFromLog(log, 'faults');
    expect(hasConnectTraffic(fixture)).toBe(false);
    expect(
      await checkReplayFixture({ ...fixture, expect: { milOn: true, storedDtcs: GOLF_CODES } }),
    ).toEqual([]);
    // A wrong expectation still fails on such a fixture.
    expect(await checkReplayFixture({ ...fixture, expect: { storedDtcs: ['P0001'] } })).toEqual([
      expect.stringMatching(/^storedDtcs:/),
    ]);
  });

  it('reports connect expectations a mid-session fixture cannot confirm', async () => {
    const log = await recordAfterConnect(async (s) => {
      await s.readDtcs('03');
    });
    const failures = await checkReplayFixture({
      ...fixtureFromLog(log, 'faults'),
      expect: { protocol: 'ISO_15765_4_CAN_11_500', storedDtcs: GOLF_CODES },
    });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/^protocol: the fixture holds no connect traffic/);
  });

  it('a clear flow with several 03 reads before the 04 checks the last re-read', async () => {
    const log = await recordAfterConnect(async (s) => {
      await s.readDtcs('03'); // screen load
      await s.readDtcs('03'); // pull to refresh
      await s.clearDtcs();
      await s.readDtcs('03'); // re-read after the clear
    });
    const fixture = fixtureFromLog(log, 'clear');
    expect(fixture.sequences?.['03']).toHaveLength(3);
    expect(
      await checkReplayFixture({
        ...fixture,
        expect: { storedDtcs: GOLF_CODES, storedDtcsAfterClear: [] },
      }),
    ).toEqual([]);
    // Only the post-clear expectation present: still the last answer, not the first.
    expect(await checkReplayFixture({ ...fixture, expect: { storedDtcsAfterClear: [] } })).toEqual(
      [],
    );
  });
});
