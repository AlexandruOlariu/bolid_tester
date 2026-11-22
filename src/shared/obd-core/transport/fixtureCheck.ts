/** Replay a fixture through a real `DiagnosticSession` and compare the result with its `expect`
 *  block. Returns one message per mismatch (empty = the fixture holds). Used by
 *  `fixtures.replay.test.ts` for every committed fixture, and handy after an on-car session to see
 *  what a freshly exported file actually replays to. See docs/simulator.md → "Replay fixtures".
 *
 *  A fixture recorded mid-session (the log cleared after connecting, or a log that wrapped) holds no
 *  `0100` probe. It is replayed without the connect handshake — the session is attached to the
 *  replay transport directly — and only the non-connect expectations are checked; a `protocol`,
 *  `vin` or `supportedPidCount` expectation on such a fixture is reported, since nothing in the
 *  file can confirm it. */

import { ReplayFixture, ReplayTransport } from './logReplay';
import { DiagnosticSession } from '../session/DiagnosticSession';

const sorted = (codes: string[]) => [...codes].sort();
const same = (a: string[], b: string[]) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));

/** True when the fixture recorded the connect probe (`0100`), i.e. the log starts at a connect. */
export function hasConnectTraffic(fixture: ReplayFixture): boolean {
  return '0100' in fixture.pairs || Boolean(fixture.sequences?.['0100']?.length);
}

export async function checkReplayFixture(fixture: ReplayFixture): Promise<string[]> {
  const ex = fixture.expect ?? {};
  const failures: string[] = [];
  const transport = new ReplayTransport(fixture);
  const session = new DiagnosticSession(transport, {
    commandTimeoutMs: 500,
    firstCommandTimeoutMs: 500,
  });
  try {
    if (hasConnectTraffic(fixture)) {
      const info = await session.connect();
      if (ex.protocol !== undefined && info.protocol !== ex.protocol) {
        failures.push(`protocol: expected ${ex.protocol}, replayed ${info.protocol}`);
      }
      if (ex.vin !== undefined && info.vin !== ex.vin) {
        failures.push(`vin: expected ${ex.vin}, replayed ${info.vin}`);
      }
      if (
        ex.supportedPidCount !== undefined &&
        info.supportedPids.length !== ex.supportedPidCount
      ) {
        failures.push(
          `supportedPidCount: expected ${ex.supportedPidCount}, replayed ${info.supportedPids.length}`,
        );
      }
    } else {
      for (const key of ['protocol', 'vin', 'supportedPidCount'] as const) {
        if (ex[key] !== undefined) {
          failures.push(
            `${key}: the fixture holds no connect traffic (no 0100), so it cannot confirm this; ` +
              'record the flow from a fresh connect or drop the expectation',
          );
        }
      }
      await transport.connect();
      session.client.attach();
    }
    // Same order as the app's Faults screen: readiness, Mode 03, Mode 07, freeze frames.
    if (ex.milOn !== undefined) {
      const readiness = await session.readReadiness();
      if (readiness?.milOn !== ex.milOn) {
        failures.push(`milOn: expected ${ex.milOn}, replayed ${readiness?.milOn ?? 'no answer'}`);
      }
    }
    if (ex.storedDtcs !== undefined) {
      const got = (await session.readDtcs('03')).map((d) => d.code);
      if (!same(got, ex.storedDtcs)) {
        failures.push(`storedDtcs: expected [${ex.storedDtcs}], replayed [${got}]`);
      }
    }
    if (ex.pendingDtcs !== undefined) {
      const got = (await session.readDtcs('07')).map((d) => d.code);
      if (!same(got, ex.pendingDtcs)) {
        failures.push(`pendingDtcs: expected [${ex.pendingDtcs}], replayed [${got}]`);
      }
    }
    if (ex.freezeFrameCount !== undefined) {
      const frames = await session.readFreezeFrames();
      if (frames.length !== ex.freezeFrameCount) {
        failures.push(
          `freezeFrameCount: expected ${ex.freezeFrameCount}, replayed ${frames.length}`,
        );
      }
    }
    if (ex.storedDtcsAfterClear !== undefined) {
      if (!(await session.clearDtcs())) failures.push('clear: the 04 request was not acknowledged');
      // The re-read after the clear is the last `03` answer recorded, however many reads came first.
      transport.skipToLast('03');
      const got = (await session.readDtcs('03')).map((d) => d.code);
      if (!same(got, ex.storedDtcsAfterClear)) {
        failures.push(
          `storedDtcsAfterClear: expected [${ex.storedDtcsAfterClear}], replayed [${got}]`,
        );
      }
    }
  } catch (e) {
    failures.push(`replay failed: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    await session.disconnect();
  }
  return failures;
}
