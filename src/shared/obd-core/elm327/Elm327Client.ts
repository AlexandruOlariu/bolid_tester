/** Half-duplex ELM327 command channel over a Transport. Serializes commands, waits for the `>`
 *  prompt, and cleans/decodes responses. See docs/architecture.md & docs/obd2-reference.md.
 *
 *  Link hardening (plan 12, docs/features/connection.md):
 *   - **Sleep / wake.** ELM327 adapters auto-sleep when idle, and the byte that wakes the chip is
 *     lost together with the command it belonged to. After `wakeAfterIdleMs` of silence a short
 *     wake-up goes out first (a bare `\r`, or `ATI` when repeating the last command is not safe).
 *   - **Drain-until-prompt.** After a timeout (of a command or of a wake-up) the client keeps
 *     listening for the late reply's `>` (up to `DRAIN_GRACE_MS`) and discards it, so a late reply
 *     can never resolve the next command. */

import { Transport } from '../transport/Transport';
import { bytesToString, stringToBytes } from '../../lib/bytes';
import { parseElmResponse, ParsedResponse } from './responseParser';
import { ProtocolId, protocolFromElmNumber } from '../obd/protocols';

export interface Elm327Options {
  commandTimeoutMs?: number;
  firstCommandTimeoutMs?: number;
  /** Idle gap (ms) after which the adapter may have auto-slept; a wake-up is sent before the next
   *  command. Default `DEFAULT_WAKE_AFTER_IDLE_MS` (20 s). 0 disables. */
  wakeAfterIdleMs?: number;
}

const PROMPT = '>';

/** Default idle gap before a wake-up is sent (ELM327 clones typically sleep after tens of seconds). */
export const DEFAULT_WAKE_AFTER_IDLE_MS = 20_000;
/** How long a wake-up waits for the adapter's prompt. Resolves either way — never rejects. */
export const WAKE_TIMEOUT_MS = 600;
/** After a timeout, how long the client keeps listening for the late reply's prompt before the next
 *  command may go out. Caps the extra cost of a timeout at this many milliseconds. */
export const DRAIN_GRACE_MS = 300;

/** Commands an ELM327 may safely run twice. A bare `\r` makes a real ELM327 **repeat the previous
 *  command**, so the bare-CR wake is only used when that repeat is harmless: OBD reads (Modes
 *  01/02/03/07/09/0A), UDS reads (`22`, `19`), TesterPresent (`3E`) and idempotent AT settings and
 *  queries. Anything else — clearing codes (`04`/`14`), writes (`2E`/`3B`), routines (`31`), output
 *  tests (`2F`), sessions / security access (`10`/`27`), resets (`ATZ`/`ATWS`/`ATD`), protocol
 *  changes (`ATSP`), monitor mode (`ATMA`) — is woken with `ATI` instead. */
const REPEAT_SAFE =
  /^(?:0[12379A][0-9A-F]*|22[0-9A-F]+|19[0-9A-F]+|3E[0-9A-F]*|AT(?:I|RV|DPN?|E[01]|L[01]|S[01]|H[01]|AT[0-2]|ST[0-9A-F]+|SH[0-9A-F]+|CRA[0-9A-F]*|CAF[01]|@1))$/;

/** True when a bare `\r` (which repeats `last` on a real ELM327) is a safe wake-up. Pass
 *  `rawCan: true` while CAN auto-formatting is off (`ATCAF0`, e.g. the TP2.0 raw-CAN link): then
 *  every hex write is a raw CAN frame (a TP2.0 data frame may begin with `01`/`22`/… yet carry a
 *  write, and a repeat would resend it with a stale sequence number), so only AT commands qualify. */
export function isRepeatSafe(last: string | null, rawCan = false): boolean {
  if (last === null) return false;
  const c = last.replace(/\s+/g, '').toUpperCase();
  if (rawCan && !c.startsWith('AT')) return false;
  return REPEAT_SAFE.test(c);
}

/** Whether CAN auto-formatting is off after `cmd`: `ATCAF0` turns raw-CAN on; `ATCAF1` and the
 *  resets (`ATZ`/`ATWS`/`ATD`) restore the default. */
function nextRawCan(cmd: string, current: boolean): boolean {
  const c = cmd.replace(/\s+/g, '').toUpperCase();
  if (c === 'ATCAF0') return true;
  if (c === 'ATCAF1' || c === 'ATZ' || c === 'ATWS' || c === 'ATD') return false;
  return current;
}

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
  /** Monitor mode (ATMA): lines stream to this listener, bypassing the command queue. */
  private monitorListener: ((line: string) => void) | null = null;
  private monitorRelease: (() => void) | null = null;
  /** Raised default per-command timeout for slow links (K-line). Overrides options.commandTimeoutMs. */
  private slowTimeoutMs: number | null = null;
  /** Last time a byte went out or came in (ms). 0 = never — the adapter may already be asleep. */
  private lastIoAt = 0;
  /** The last command the adapter is known to have run (for the bare-CR repeat-safety check), or
   *  null when unknown: before the first, and after a command timed out or its write failed — the
   *  adapter may never have run it, so its own remembered command could be an older, unsafe one. */
  private lastCmd: string | null = null;
  /** CAN auto-formatting is off (`ATCAF0`): hex writes are raw frames, never repeat-safe. */
  private rawCan = false;
  /** Set after a timeout while the late reply is drained (discarded) up to its prompt. */
  private draining = false;
  /** Resolves when the drain ends (prompt seen or `DRAIN_GRACE_MS` elapsed). */
  private drainPromise: Promise<void> | null = null;
  private finishDrain: (() => void) | null = null;

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

  /** Switch the default per-command timeout to a slower value (e.g. K-line links where Mode 03/04
   *  and KWP routines take longer than CAN). Pass null to revert to the configured default. */
  setSlow(ms: number | null = 12000): void {
    this.slowTimeoutMs = ms;
  }

  private onData = (bytes: Uint8Array): void => {
    this.lastIoAt = Date.now();
    this.buffer += bytesToString(bytes);
    if (this.monitorListener) {
      let nl: number;
      while ((nl = this.buffer.search(/[\r\n]/)) >= 0) {
        const line = this.buffer.slice(0, nl).trim();
        this.buffer = this.buffer.slice(nl + 1);
        if (line && line !== PROMPT) this.monitorListener(line);
      }
      return;
    }
    const idx = this.buffer.indexOf(PROMPT);
    if (idx >= 0 && this.draining) {
      // The late reply to a command that already timed out: discard it through its prompt. It is
      // never handed to `pending` — the next command is only written once the drain has ended.
      this.buffer = this.buffer.slice(idx + 1);
      this.endDrain();
      return;
    }
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
    const run = async () => {
      // A late reply to a timed-out command must be discarded before this one goes out.
      if (this.drainPromise) await this.drainPromise;
      if (this.needsWake()) {
        await this.execWake();
        // A wake-up whose reply is late is drained like a timed-out command.
        if (this.drainPromise) await this.drainPromise;
      }
      return this.exec(cmd, timeoutMs);
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** True when the link has been silent long enough that the adapter may have auto-slept. Monitor
   *  mode is exempt (it streams constantly and owns the channel). */
  private needsWake(): boolean {
    const after = this.options.wakeAfterIdleMs ?? DEFAULT_WAKE_AFTER_IDLE_MS;
    if (after <= 0 || this.monitorListener) return false;
    return Date.now() - this.lastIoAt > after;
  }

  /** Wake a possibly-sleeping adapter: send a bare `\r` (or `ATI` when repeating the last command
   *  is not safe — see `isRepeatSafe`), wait up to `WAKE_TIMEOUT_MS` for a prompt, then discard
   *  whatever came back. Resolves either way, never rejects: a failed wake just lets the real
   *  command try (and time out on its own if the adapter is really gone). On a timeout a drain
   *  starts, because the wake's reply may still be coming (a bare `\r` repeats the last command,
   *  which can be a slow `19…`/`22…` read or a K-line request) and must not resolve the next one. */
  private async execWake(): Promise<void> {
    this.attach();
    const wake = isRepeatSafe(this.lastCmd, this.rawCan) ? '' : 'ATI';
    this.buffer = '';
    let answered = false;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (this.pending?.timer === timer) {
          this.pending = null;
          this.startDrain();
        }
        resolve();
      }, WAKE_TIMEOUT_MS);
      const settle = () => {
        clearTimeout(timer);
        if (this.pending?.timer === timer) this.pending = null;
        resolve();
      };
      const onPrompt = () => {
        answered = true;
        settle();
      };
      this.pending = { resolve: onPrompt, reject: settle, timer };
      this.lastIoAt = Date.now();
      this.transport.write(stringToBytes(wake + '\r')).catch(settle);
    });
    // Only an answered `ATI` is known to be the adapter's remembered command; an unanswered one
    // leaves it unknown, so the next wake uses `ATI` again instead of trusting a bare CR.
    if (wake) this.lastCmd = answered ? wake : null;
    this.buffer = '';
  }

  /** Begin draining after a timeout: keep accumulating until the late reply's prompt (handled in
   *  onData) or `DRAIN_GRACE_MS`, whichever comes first. */
  private startDrain(): void {
    if (this.draining) return;
    this.draining = true;
    let release: () => void = () => undefined;
    this.drainPromise = new Promise<void>((r) => {
      release = r;
    });
    const timer = setTimeout(() => this.endDrain(), DRAIN_GRACE_MS);
    this.finishDrain = () => {
      clearTimeout(timer);
      release();
    };
  }

  private endDrain(): void {
    if (!this.draining) return;
    this.draining = false;
    const finish = this.finishDrain;
    this.finishDrain = null;
    this.drainPromise = null;
    finish?.();
  }

  private exec(cmd: string, timeoutMs?: number): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      this.attach();
      this.buffer = '';
      const timeout = timeoutMs ?? this.slowTimeoutMs ?? this.options.commandTimeoutMs ?? 4000;
      const timer = setTimeout(() => {
        if (this.pending) {
          this.pending = null;
          // The adapter may never have run it (e.g. swallowed by a sleeping adapter), so its
          // remembered command is unknown: the next wake must not be a bare CR.
          this.lastCmd = null;
          // The reply may still be on its way: drain it so it can't resolve the next command.
          this.startDrain();
          reject(new Error(`ELM327 timeout after ${timeout}ms for "${cmd}"`));
        }
      }, timeout);
      this.pending = { resolve, reject, timer };
      this.lastIoAt = Date.now();
      this.lastCmd = cmd;
      this.rawCan = nextRawCan(cmd, this.rawCan);
      this.transport.write(stringToBytes(cmd + '\r')).catch((e: unknown) => {
        clearTimeout(timer);
        // Unknown whether (or how much of) the command reached the adapter.
        this.lastCmd = null;
        // Only while this command still owns the channel (a late rejection after its timeout must
        // not clobber the next command): a partial write can still draw a reply (the `?` to
        // BleTransport's line flush), so drain it before the next command goes out.
        if (this.pending?.timer === timer) {
          this.pending = null;
          this.startDrain();
        }
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

  /** Start ELM327 monitor mode (default `ATMA`): frames stream to `listener` until
   *  stopMonitor(). The command queue is held meanwhile — monitor mode owns the channel. */
  async startMonitor(listener: (line: string) => void, cmd = 'ATMA'): Promise<void> {
    if (this.monitorListener) return;
    this.attach();
    const hold = new Promise<void>((res) => (this.monitorRelease = res));
    this.queue = this.queue.then(() => hold);
    this.monitorListener = listener;
    this.buffer = '';
    this.lastIoAt = Date.now();
    this.lastCmd = cmd;
    await this.transport.write(stringToBytes(cmd + '\r'));
  }

  /** Stop monitor mode: any character interrupts ATMA; wait briefly for the prompt, then release
   *  the command queue. Safe to call when not monitoring. */
  async stopMonitor(): Promise<void> {
    if (!this.monitorListener) return;
    await this.transport.write(stringToBytes('\r'));
    await new Promise((r) => setTimeout(r, 120));
    this.monitorListener = null;
    this.buffer = '';
    this.monitorRelease?.();
    this.monitorRelease = null;
  }

  get monitoring(): boolean {
    return this.monitorListener !== null;
  }

  /** Run the standard initialization sequence. */
  async init(): Promise<void> {
    this.firstObd = true;
    const seq = ['ATZ', 'ATE0', 'ATL0', 'ATS0', 'ATH0', 'ATAT1', 'ATSP0'];
    for (const c of seq) {
      await this.raw(c, c === 'ATZ' ? 5000 : undefined);
      // The adapter just answered a reset, so it is awake: a fresh connection wakes at most once
      // (before ATZ), never again mid-init.
      if (c === 'ATZ') this.lastIoAt = Date.now();
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
