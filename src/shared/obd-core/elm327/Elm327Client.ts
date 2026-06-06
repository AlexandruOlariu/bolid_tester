/** Half-duplex ELM327 command channel over a Transport. Serializes commands, waits for the `>`
 *  prompt, and cleans/decodes responses. See docs/architecture.md & docs/obd2-reference.md. */

import { Transport } from '../transport/Transport';
import { bytesToString, stringToBytes } from '../../lib/bytes';
import { parseElmResponse, ParsedResponse } from './responseParser';
import { ProtocolId, protocolFromElmNumber } from '../obd/protocols';

export interface Elm327Options {
  commandTimeoutMs?: number;
  firstCommandTimeoutMs?: number;
}

const PROMPT = '>';

export class Elm327Client {
  private buffer = '';
  private queue: Promise<unknown> = Promise.resolve();
  private pending: {
    resolve: (s: string) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  private unsub: (() => void) | null = null;
  private firstObd = true;

  constructor(
    private transport: Transport,
    private options: Elm327Options = {},
  ) {}

  /** Begin listening to the transport (idempotent). */
  attach(): void {
    if (!this.unsub) this.unsub = this.transport.onData(this.onData);
  }

  detach(): void {
    this.unsub?.();
    this.unsub = null;
  }

  private onData = (bytes: Uint8Array): void => {
    this.buffer += bytesToString(bytes);
    const idx = this.buffer.indexOf(PROMPT);
    if (idx >= 0 && this.pending) {
      const chunk = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      const p = this.pending;
      this.pending = null;
      clearTimeout(p.timer);
      p.resolve(chunk);
    }
  };

  /** Send a raw command and resolve with the cleaned text response (without the prompt). */
  raw(cmd: string, timeoutMs?: number): Promise<string> {
    const run = () => this.exec(cmd, timeoutMs);
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private exec(cmd: string, timeoutMs?: number): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      this.attach();
      this.buffer = '';
      const timeout = timeoutMs ?? this.options.commandTimeoutMs ?? 4000;
      const timer = setTimeout(() => {
        if (this.pending) {
          this.pending = null;
          reject(new Error(`ELM327 timeout after ${timeout}ms for "${cmd}"`));
        }
      }, timeout);
      this.pending = { resolve, reject, timer };
      this.transport.write(stringToBytes(cmd + '\r')).catch((e: unknown) => {
        clearTimeout(timer);
        this.pending = null;
        reject(e instanceof Error ? e : new Error(String(e)));
      });
    });
  }

  /** Send an OBD command and parse the response (uses a longer timeout for the first one). */
  async command(cmd: string): Promise<ParsedResponse> {
    const isObd = /^[0-9A-Fa-f]/.test(cmd);
    const timeout =
      isObd && this.firstObd ? (this.options.firstCommandTimeoutMs ?? 9000) : undefined;
    const raw = await this.raw(cmd, timeout);
    if (isObd) this.firstObd = false;
    return parseElmResponse(raw);
  }

  /** Run the standard initialization sequence. */
  async init(): Promise<void> {
    this.firstObd = true;
    const seq = ['ATZ', 'ATE0', 'ATL0', 'ATS0', 'ATH0', 'ATAT1', 'ATSP0'];
    for (const c of seq) {
      await this.raw(c, c === 'ATZ' ? 5000 : undefined);
    }
  }

  /** Probe the bus by requesting the first supported-PID bitmap. */
  async probe(): Promise<boolean> {
    const r = await this.command('0100');
    return r.notice === null && r.bytes.length >= 2;
  }

  async protocolNumber(): Promise<ProtocolId> {
    return protocolFromElmNumber(await this.raw('ATDPN'));
  }

  async voltage(): Promise<number | null> {
    const m = (await this.raw('ATRV')).match(/(\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : null;
  }

  async version(): Promise<string> {
    return (await this.raw('ATI')).replace(/[\r\n>]/g, ' ').trim();
  }
}
