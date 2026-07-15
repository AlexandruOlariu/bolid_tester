/** Turn a captured adapter I/O log (Settings → adapter log) into a replayable simulator fixture:
 *  every tx command maps to the rx text that followed it on the real car. A ReplayTransport then
 *  serves those exact responses, so real-car behaviour becomes a regression fixture — no more
 *  "confirm on the car" for every experiment. See docs/simulator.md. */

import { Transport, TransportStatus } from './Transport';
import { stringToBytes, bytesToString } from '../../lib/bytes';

/** Matches the shape of the Settings adapter log without importing app state into the core. */
export interface LoggedIo {
  dir: 'tx' | 'rx';
  text: string;
  ts?: number;
}

export interface ReplayFixture {
  name?: string;
  createdAt?: number;
  /** command (upper, no spaces) -> raw response text (as the adapter sent it, prompt stripped). */
  pairs: Record<string, string>;
}

const norm = (cmd: string) => cmd.replace(/\s+/g, '').toUpperCase();

/** Build a fixture from the log: each tx opens a slot; rx lines until the next tx belong to it.
 *  The FIRST response per command wins (the state right after connecting). */
export function fixtureFromLog(entries: LoggedIo[], name?: string): ReplayFixture {
  const pairs: Record<string, string> = {};
  let current: string | null = null;
  let acc: string[] = [];
  const commit = () => {
    if (current !== null && acc.length && !(current in pairs)) {
      pairs[current] = acc.join(' ').replace(/\s+/g, ' ').trim();
    }
  };
  for (const e of entries) {
    if (e.dir === 'tx') {
      commit();
      current = norm(e.text);
      acc = [];
    } else if (current !== null && e.text.trim()) {
      acc.push(e.text.trim());
    }
  }
  commit();
  return { name, createdAt: Date.now(), pairs };
}

/** A Transport that answers from a ReplayFixture. Unknown commands get NO DATA (OBD) / OK (AT),
 *  so a partially-captured log still connects. */
export class ReplayTransport implements Transport {
  status: TransportStatus = 'disconnected';
  private listeners = new Set<(b: Uint8Array) => void>();

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
  async write(bytes: Uint8Array): Promise<void> {
    const cmd = norm(bytesToString(bytes).replace(/[\r\n]/g, ''));
    if (!cmd) return;
    const known = this.fixture.pairs[cmd];
    const body = known ?? (cmd.startsWith('AT') ? 'OK' : 'NO DATA');
    const out = stringToBytes(body + '\r\r>');
    setTimeout(() => {
      for (const l of [...this.listeners]) l(out);
    }, 0);
  }
}
