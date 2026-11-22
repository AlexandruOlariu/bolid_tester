/** Turn a captured adapter I/O log (Settings → adapter log, or a `RecordingTransport`) into a
 *  replayable simulator fixture: every tx command maps to the rx text that followed it. A
 *  ReplayTransport then serves those exact responses, so real-car behaviour becomes a regression
 *  fixture — no more "confirm on the car" for every experiment. Committed fixtures live in
 *  `transport/fixtures/<vehicleId>/<flow>.json` and run in CI (`fixtures.replay.test.ts`). See
 *  docs/simulator.md → "Replay fixtures". */

import { Transport, TransportStatus } from './Transport';
import { stringToBytes, bytesToString } from '../../lib/bytes';

/** Matches the shape of the Settings adapter log without importing app state into the core.
 *  `rx` text is the raw chunk with the `>` prompt removed and line breaks kept as `\r`
 *  (see `logRxText`), so multi-line answers (several ECUs, ISO-TP segments) survive the trip. */
export interface LoggedIo {
  dir: 'tx' | 'rx';
  text: string;
  ts?: number;
}

/** Where a fixture came from and what it exercises. Simulator fixtures never count as validation. */
export interface ReplayFixtureMeta {
  source: 'simulator' | 'car';
  /** Registry profile id, or `user:<id>` for a learned profile. */
  vehicleId: string;
  /** 'connect' | 'live' | 'faults' | 'clear' | 'inspection' | 'battery' | 'extended' |
   *  'module-scan' | 'sniffer' | any custom name. */
  flow: string;
  /** Adapter ATI string, e.g. 'ELM327 v2.2'. */
  adapter?: string;
  /** ProtocolId the session negotiated. */
  protocol?: string;
  appVersion?: string;
  /** Oldest adapter-log entries lost before the export because the Settings log (a fixed-size ring
   *  buffer) wrapped. Present only when > 0: the fixture then starts mid-session. */
  droppedEntries?: number;
  notes?: string;
}

/** What replaying the fixture through a real `DiagnosticSession` must produce. Every field is
 *  optional; `fixtures.replay.test.ts` asserts only the ones present. */
export interface ReplayFixtureExpect {
  protocol?: string;
  vin?: string | null;
  supportedPidCount?: number;
  storedDtcs?: string[];
  pendingDtcs?: string[];
  milOn?: boolean;
  /** Number of Mode 02 freeze frames `readFreezeFrames()` returns. */
  freezeFrameCount?: number;
  /** Clear flows: the stored codes the LAST recorded Mode 03 answer holds (the re-read after
   *  `clearDtcs()`), however many `03` reads the recording made before the `04`. */
  storedDtcsAfterClear?: string[];
}

export interface ReplayFixture {
  name?: string;
  createdAt?: number;
  /** command (upper, no spaces) -> response text (prompt stripped, lines joined with `\r`). The
   *  FIRST response per command (the state right after connecting). */
  pairs: Record<string, string>;
  /** Every response per command, in order, for commands whose answer changed during the session
   *  (a clear flow: `03` → codes, then `04`, then `03` → none). ReplayTransport consumes these
   *  first and repeats the last one when exhausted. Commands answered identically every time are
   *  left out — `pairs` already replays them exactly. */
  sequences?: Record<string, string[]>;
  meta?: ReplayFixtureMeta;
  expect?: ReplayFixtureExpect;
}

export interface FixtureFromLogOptions {
  meta?: ReplayFixtureMeta;
  /** Fill `sequences` (default true). */
  keepSequences?: boolean;
}

const norm = (cmd: string) => cmd.replace(/\s+/g, '').toUpperCase();

/** Normalise the rx text of one command's slot: the chunks are concatenated as the adapter sent
 *  them (a BLE notification can split a line anywhere), then split into lines; each line's
 *  whitespace is collapsed, blank lines dropped, and the lines re-joined with `\r` — the ELM327's
 *  own line separator, so `parseElmResponse` sees the same structure on replay. */
function responseText(chunks: string[]): string {
  return chunks
    .join('')
    .replace(/>/g, '')
    .split(/[\r\n]+/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\r');
}

/** Build a fixture from the log: each tx opens a slot; rx entries until the next tx belong to it.
 *  `pairs` keeps the FIRST response per command; `sequences` (unless `keepSequences: false`) keeps
 *  every response of the commands whose answer changed. A bare-CR wake-up (empty tx) and a command
 *  that got no reply are skipped. */
export function fixtureFromLog(
  entries: LoggedIo[],
  name?: string,
  opts: FixtureFromLogOptions = {},
): ReplayFixture {
  const pairs: Record<string, string> = {};
  const all: Record<string, string[]> = {};
  let current: string | null = null;
  let acc: string[] = [];
  const commit = () => {
    if (!current) return;
    const text = responseText(acc);
    if (!text) return;
    if (!(current in pairs)) pairs[current] = text;
    (all[current] ??= []).push(text);
  };
  for (const e of entries) {
    if (e.dir === 'tx') {
      commit();
      current = norm(e.text);
      acc = [];
    } else if (current !== null) {
      acc.push(e.text);
    }
  }
  commit();

  const fixture: ReplayFixture = { name, createdAt: Date.now(), pairs };
  if (opts.keepSequences ?? true) {
    const sequences: Record<string, string[]> = {};
    for (const [cmd, seq] of Object.entries(all)) {
      if (seq.some((r) => r !== seq[0])) sequences[cmd] = seq;
    }
    fixture.sequences = sequences;
  }
  if (opts.meta) fixture.meta = { ...opts.meta };
  return fixture;
}

/** A Transport that answers from a ReplayFixture: a command's `sequences` entry first (one
 *  response per send, repeating the last when exhausted), then its `pairs` entry. Unknown commands
 *  get NO DATA (OBD) / OK (AT), so a partially-captured log still connects. */
export class ReplayTransport implements Transport {
  status: TransportStatus = 'disconnected';
  private listeners = new Set<(b: Uint8Array) => void>();
  /** Per-command position in `fixture.sequences`. */
  private cursor = new Map<string, number>();

  constructor(public fixture: ReplayFixture) {}

  async connect(): Promise<void> {
    this.status = 'connected';
  }
  async disconnect(): Promise<void> {
    this.status = 'disconnected';
  }
  onData(listener: (b: Uint8Array) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  /** Replay fixtures never drop their link, so status is fixed after connect/disconnect and this
   *  is a no-op subscription (kept to satisfy the Transport contract). */
  onStatusChange(): () => void {
    return () => undefined;
  }

  /** Move `cmd`'s sequence cursor to its last recorded response, so the next send replays the
   *  final answer the session got. The fixture checker uses it for the post-clear `03` read: a
   *  recording can hold any number of `03` reads before the `04` (screen load, pull to refresh),
   *  and the re-read after the clear is always the last one. No-op without a sequence. */
  skipToLast(cmd: string): void {
    const seq = this.fixture.sequences?.[norm(cmd)];
    if (seq && seq.length) this.cursor.set(norm(cmd), seq.length - 1);
  }

  /** The response for the next send of `cmd`, advancing its sequence cursor. */
  private next(cmd: string): string | undefined {
    const seq = this.fixture.sequences?.[cmd];
    if (seq && seq.length) {
      const i = this.cursor.get(cmd) ?? 0;
      this.cursor.set(cmd, i + 1);
      return seq[Math.min(i, seq.length - 1)];
    }
    return this.fixture.pairs[cmd];
  }

  async write(bytes: Uint8Array): Promise<void> {
    const cmd = norm(bytesToString(bytes).replace(/[\r\n]/g, ''));
    if (!cmd) return;
    const body = this.next(cmd) ?? (cmd.startsWith('AT') ? 'OK' : 'NO DATA');
    const out = stringToBytes(body + '\r\r>');
    setTimeout(() => {
      for (const l of [...this.listeners]) l(out);
    }, 0);
  }
}
