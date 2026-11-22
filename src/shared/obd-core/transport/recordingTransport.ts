/** Record any Transport's traffic as `LoggedIo[]` — the same shape and normalisation as the app's
 *  adapter log (connectionService `withLog` uses `logTxText` / `logRxText` from here) — and turn a
 *  scripted session into a replay fixture. Pure core, no React. Used by
 *  `scripts/record-sim-fixtures.ts` to record the simulator for every registry profile. See
 *  docs/simulator.md → "Replay fixtures". */

import { Transport, TransportStatus } from './Transport';
import { fixtureFromLog, LoggedIo, ReplayFixture, ReplayFixtureMeta } from './logReplay';
import { DiagnosticSession } from '../session/DiagnosticSession';
import { Elm327Options } from '../elm327/Elm327Client';
import { bytesToString } from '../../lib/bytes';
import { redactCommand } from './redact';

/** Log text of an outbound command: line endings removed, trimmed (a bare-CR wake-up is ''). A
 *  KWP login (`2B` + code) is redacted (`redactCommand`), so the owner's login code never reaches
 *  the adapter log or an exported replay fixture. */
export function logTxText(bytes: Uint8Array): string {
  return redactCommand(
    bytesToString(bytes)
      .replace(/[\r\n]/g, '')
      .trim(),
  );
}

/** Log text of one inbound chunk: the `>` prompt removed and every line break kept as a single
 *  `\r`. Not trimmed — a BLE notification can end mid-line, and the line structure is what lets a
 *  replay tell several ECUs' answers (and ISO-TP segment lines) apart. */
export function logRxText(bytes: Uint8Array): string {
  return bytesToString(bytes)
    .replace(/>/g, '')
    .replace(/\r\n|\n\r|\n/g, '\r');
}

/** Wraps a Transport and records tx/rx as LoggedIo, in the order they happen. */
export class RecordingTransport implements Transport {
  readonly log: LoggedIo[] = [];

  constructor(private inner: Transport) {}

  get status(): TransportStatus {
    return this.inner.status;
  }
  connect(): Promise<void> {
    return this.inner.connect();
  }
  disconnect(): Promise<void> {
    return this.inner.disconnect();
  }
  write(bytes: Uint8Array): Promise<void> {
    this.log.push({ dir: 'tx', text: logTxText(bytes), ts: Date.now() });
    return this.inner.write(bytes);
  }
  onData(listener: (bytes: Uint8Array) => void): () => void {
    return this.inner.onData((bytes) => {
      this.log.push({ dir: 'rx', text: logRxText(bytes), ts: Date.now() });
      listener(bytes);
    });
  }
  onStatusChange(listener: (status: TransportStatus) => void): () => void {
    return this.inner.onStatusChange(listener);
  }
}

/** Run a scripted session over `inner` while recording it, then return the fixture. The callback
 *  drives the session itself (typically `connect()` first, then the flow's reads); the session is
 *  disconnected afterwards even when the callback throws. */
export async function recordSession(
  inner: Transport,
  run: (session: DiagnosticSession) => Promise<void>,
  meta: ReplayFixtureMeta,
  options: Elm327Options = {},
): Promise<ReplayFixture> {
  const recorder = new RecordingTransport(inner);
  const session = new DiagnosticSession(recorder, options);
  try {
    await run(session);
  } finally {
    await session.disconnect();
  }
  return fixtureFromLog(recorder.log, meta.flow, { meta });
}
