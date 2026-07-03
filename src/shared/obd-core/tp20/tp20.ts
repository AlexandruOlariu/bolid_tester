/** VW/VAG Transport Protocol 2.0 (TP2.0) — the channel layer that carries KWP2000 to PRE-UDS
 *  modules (cluster, comfort, gateway…) on PQ-platform CAN cars (e.g. the Golf Plus 2009). This is
 *  what a VCDS "auto-scan" uses to reach modules that do not answer ISO-TP/UDS.
 *
 *  DESIGN: the protocol logic is pure and driven through a minimal `RawCanLink` (send a CAN frame /
 *  receive CAN frames), so it is fully unit-tested against an in-memory VW bus (`fakeTp20Bus.ts`)
 *  AND against a golden byte trace of a canonical real-car exchange (`tp20GoldenTrace.test.ts`) —
 *  no hardware, matching the repo's "testable without a car" rule. A real ELM327 raw-CAN link
 *  (`elmRawCan.ts`) implements the same interface for devices.
 *
 *  Wire facts this implementation is aligned to (canonical published PQ traces; engine 0x01 shown):
 *    tester → 0x200   01 C0 00 10 00 03 01    channel setup request
 *    ECU    → 0x201   00 D0 00 03 40 07 01    positive response (0xD0) on 0x200+dest:
 *                                             bytes 2-3 = id the ECU transmits on (tester rx,
 *                                             0x300), bytes 4-5 = id the tester must transmit on
 *                                             (0x740). Bit 0x10 of an id's high byte = invalid id.
 *    tester → 0x740   A0 0F 8A FF 32 FF       parameters: block size 15, T1 (ack timeout) ≈100ms
 *    ECU    → 0x300   A1 0F 8A FF 4A FF       parameters accepted
 *  Data frames are [PCI, …≤7 bytes]: PCI high nibble = opcode, low nibble = rolling sequence.
 *  ACK-expected frames (opcodes 0x0/0x1) must be answered with 0xB<next-seq> before the sender may
 *  continue — including MID-packet, every <block size> frames of a long transfer. Idle channels are
 *  kept open with periodic channel tests (0xA3 → 0xA1).
 *
 *  HONESTY: real-adapter reliability still depends on the ELM327 clone (see elmRawCan.ts), but the
 *  byte layer is pinned by the golden-trace test rather than only being self-consistent with the
 *  fake bus. See docs/features/tp20.md. */

export interface RawFrame {
  id: number;
  data: number[];
}

export interface RawCanLink {
  send(frame: RawFrame): Promise<void>;
  onFrame(cb: (f: RawFrame) => void): () => void;
  /** Optional hardware receive-filter hint (11-bit id + mask; null clears). Real ELM327 links use
   *  it to keep ATMA from flooding cheap clones; in-memory buses can ignore it. */
  setFilter?(filter: { id: number; mask: number } | null): Promise<void>;
}

/** Broadcast id used for channel setup. The module answers on TP20_SETUP_ID + its logical
 *  address (0x201 for engine 0x01…); some implementations answer on 0x200 itself — accept both. */
export const TP20_SETUP_ID = 0x200;

/** Data-frame PCI high-nibble opcodes (low nibble = rolling sequence 0..15). */
export const TP = {
  DATA_MORE_ACK: 0x0, // more frames follow, ACK expected (block boundary)
  DATA_LAST_ACK: 0x1, // last frame of packet, ACK expected
  DATA_MORE: 0x2, // more frames follow, no ACK
  DATA_LAST: 0x3, // last frame of packet, no ACK
  NOT_READY: 0x9, // receiver not ready; low nibble = next expected seq
  ACK_READY: 0xb, // ready to receive; low nibble = next expected seq
} as const;

/** Channel-control opcodes (single-byte first byte, not sequenced). */
export const TP_CTRL = {
  SETUP_REQ: 0xc0,
  SETUP_RESP: 0xd0, // 0xD1..0xD8 = negative setup responses
  PARAM_REQ: 0xa0,
  PARAM_RESP: 0xa1,
  CHANNEL_TEST: 0xa3, // keep-alive; answered with PARAM_RESP
  DISCONNECT: 0xa8,
} as const;

/** Canonical channel parameters we announce: BS 15, T1 100ms, T3 5ms (VCDS-like). */
const PARAM_BYTES = [0x0f, 0x8a, 0xff, 0x32, 0xff];

const MAX_INBOX = 64;

export class Tp20Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Tp20Error';
  }
}

export interface Tp20Options {
  timeoutMs?: number;
  /** Idle keep-alive period (0xA3 channel test). 0 disables. Default 900ms — real modules drop a
   *  silent channel after ~1s. */
  keepAliveMs?: number;
}

/** Split a KWP payload into TP2.0 data frames (7 data bytes per frame), sequenced. Within a packet,
 *  plain DATA_MORE is used except at block boundaries (every `blockSize` frames → DATA_MORE_ACK,
 *  where the sender must stop for an ACK) and the last frame (DATA_LAST_ACK). */
export function toTpFrames(payload: number[], startSeq = 0, blockSize = 0x0f): number[][] {
  const bs = Math.max(1, blockSize);
  const frames: number[][] = [];
  const chunks: number[][] = [];
  for (let i = 0; i < payload.length; i += 7) chunks.push(payload.slice(i, i + 7));
  if (chunks.length === 0) chunks.push([]);
  chunks.forEach((chunk, i) => {
    const last = i === chunks.length - 1;
    const op = last ? TP.DATA_LAST_ACK : (i + 1) % bs === 0 ? TP.DATA_MORE_ACK : TP.DATA_MORE;
    const seq = (startSeq + i) & 0x0f;
    frames.push([(op << 4) | seq, ...chunk]);
  });
  return frames;
}

/** True when a data frame's opcode marks the last frame of a packet. */
export function isLastFrame(pci: number): boolean {
  const op = pci >> 4;
  return op === TP.DATA_LAST_ACK || op === TP.DATA_LAST;
}

export function expectsAck(pci: number): boolean {
  const op = pci >> 4;
  return op === TP.DATA_MORE_ACK || op === TP.DATA_LAST_ACK;
}

/** A single TP2.0 channel to one module. Stop-and-wait with block-size honoring: send a packet
 *  (pausing for an ACK at every block boundary), await the final ACK, collect the response packet
 *  (ACKing every ACK-expected frame, mid-packet included), and keep the channel alive with periodic
 *  0xA3 channel tests while idle. */
export class Tp20Channel {
  private txId = 0; // id WE transmit on (the module listens here)
  private rxId = 0; // id the MODULE transmits on (we listen here)
  private seq = 0;
  private peerBlockSize = 0x0f;
  private setupIds: number[] = [];
  private inbox: RawFrame[] = [];
  private waiters: {
    pred: (f: RawFrame) => boolean;
    resolve: (f: RawFrame) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }[] = [];
  private unsub: (() => void) | null = null;
  private kaTimer: ReturnType<typeof setInterval> | null = null;
  /** Serializes channel operations (requests + keep-alive channel tests). The busy FLAG this
   *  replaces was check-then-act racy: a keep-alive tick could pass the check just as a request
   *  started and inject its 0xA3 between the request's data frames — a protocol violation. */
  private ops: Promise<unknown> = Promise.resolve();
  private pendingOps = 0;
  private readonly timeout: number;
  private readonly keepAliveMs: number;

  constructor(
    private link: RawCanLink,
    opts: Tp20Options = {},
  ) {
    this.timeout = opts.timeoutMs ?? 1000;
    this.keepAliveMs = opts.keepAliveMs ?? 900;
  }

  private attach(): void {
    if (this.unsub) return;
    this.unsub = this.link.onFrame(this.onRaw);
  }

  private accepts(id: number): boolean {
    if (this.rxId) return id === this.rxId;
    return this.setupIds.includes(id);
  }

  private onRaw = (f: RawFrame): void => {
    if (!this.accepts(f.id)) return;
    // Peer channel test while open: answer with our params, never queue it.
    if (this.rxId && f.id === this.rxId && f.data[0] === TP_CTRL.CHANNEL_TEST) {
      void this.link
        .send({ id: this.txId, data: [TP_CTRL.PARAM_RESP, ...PARAM_BYTES] })
        .catch(() => undefined);
      return;
    }
    this.inbox.push(f);
    if (this.inbox.length > MAX_INBOX) this.inbox.shift(); // bound memory on chatty buses
    this.pump();
  };

  /** Match queued frames against waiting predicates, in waiter order. */
  private pump(): void {
    let progress = true;
    while (progress) {
      progress = false;
      for (let w = 0; w < this.waiters.length; w++) {
        const idx = this.inbox.findIndex(this.waiters[w].pred);
        if (idx >= 0) {
          const [frame] = this.inbox.splice(idx, 1);
          const [waiter] = this.waiters.splice(w, 1);
          clearTimeout(waiter.timer);
          waiter.resolve(frame);
          progress = true;
          break;
        }
      }
    }
  }

  private next(pred: (f: RawFrame) => boolean): Promise<RawFrame> {
    return new Promise<RawFrame>((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = this.waiters.findIndex((x) => x.timer === timer);
        if (i >= 0) this.waiters.splice(i, 1);
        reject(new Tp20Error('TP2.0 timeout waiting for a frame'));
      }, this.timeout);
      this.waiters.push({ pred, resolve, reject, timer });
      this.pump();
    });
  }

  /** Open a channel to a logical module address (e.g. 0x01 engine, 0x19 gateway). */
  async open(dest: number): Promise<void> {
    this.attach();
    this.inbox.length = 0; // no stale frames from a previous life
    this.setupIds = [TP20_SETUP_ID, TP20_SETUP_ID + dest];
    // Narrow a hardware receive filter to the setup-response range (0x200..0x2FF).
    await this.link.setFilter?.({ id: TP20_SETUP_ID, mask: 0x700 }).catch(() => undefined);
    // Channel setup: tester → 0x200; the module answers on 0x200+dest (canonically) or 0x200.
    await this.link.send({
      id: TP20_SETUP_ID,
      data: [dest, TP_CTRL.SETUP_REQ, 0x00, 0x10, 0x00, 0x03, 0x01],
    });
    const resp = await this.next(
      (f) => this.setupIds.includes(f.id) && (f.data[1] & 0xf0) === TP_CTRL.SETUP_RESP,
    );
    if (resp.data[1] !== TP_CTRL.SETUP_RESP) {
      throw new Tp20Error(
        `Channel setup refused (0x${resp.data[1].toString(16).toUpperCase()})`,
      );
    }
    // [0x00, D0, rx_lo, rx_hi, tx_lo, tx_hi, app]: bytes 2-3 = id the module transmits on (our
    // rx), bytes 4-5 = id we must transmit on. High-byte bit 0x10 flags an invalid id; ids are
    // 11-bit, so the significant high bits are 0x07.
    if (resp.data[3] & 0x10 || resp.data[5] & 0x10) {
      throw new Tp20Error('Channel setup returned an invalid CAN id');
    }
    this.rxId = resp.data[2] | ((resp.data[3] & 0x07) << 8);
    this.txId = resp.data[4] | ((resp.data[5] & 0x07) << 8);
    if (!this.txId || !this.rxId) throw new Tp20Error('Channel setup returned no valid CAN ids');
    await this.link.setFilter?.({ id: this.rxId, mask: 0x7ff }).catch(() => undefined);
    // Channel parameters handshake; the response carries the module's block size.
    await this.link.send({ id: this.txId, data: [TP_CTRL.PARAM_REQ, ...PARAM_BYTES] });
    const param = await this.next((f) => f.id === this.rxId && f.data[0] === TP_CTRL.PARAM_RESP);
    const bs = (param.data[1] ?? 0x0f) & 0x0f;
    this.peerBlockSize = bs || 0x0f;
    this.seq = 0;
    if (this.keepAliveMs > 0) this.kaTimer = setInterval(this.kaTick, this.keepAliveMs);
  }

  /** Run a channel operation exclusively: chained behind every earlier operation. */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    this.pendingOps += 1;
    const done = () => {
      this.pendingOps -= 1;
    };
    const run = () => fn();
    const next = this.ops.then(run, run);
    this.ops = next.then(done, done);
    return next;
  }

  /** Send a KWP request and return the reassembled KWP response bytes. Serialized against the
   *  keep-alive: no channel test can interleave with a running request. */
  async request(payload: number[]): Promise<number[]> {
    return this.enqueue(() => this.doRequest(payload));
  }

  private async doRequest(payload: number[]): Promise<number[]> {
    if (!this.txId) throw new Tp20Error('Channel not open');
    const frames = toTpFrames(payload, this.seq, this.peerBlockSize);
    for (const f of frames) {
      await this.link.send({ id: this.txId, data: f });
      // Block boundary mid-packet: the receiver must ACK before we may continue.
      if (expectsAck(f[0]) && !isLastFrame(f[0])) await this.awaitAck();
    }
    this.seq = (this.seq + frames.length) & 0x0f;
    // Final ACK for our packet (0xB<next-seq>).
    await this.awaitAck();

    // Collect the response packet, ACKing every ACK-expected frame (mid-packet included).
    const out: number[] = [];
    for (;;) {
      const f = await this.next(
        (x) =>
          x.id === this.rxId &&
          ((x.data[0] >> 4) <= TP.DATA_LAST || x.data[0] === TP_CTRL.DISCONNECT),
      );
      if (f.data[0] === TP_CTRL.DISCONNECT) {
        this.halt();
        throw new Tp20Error('Module closed the TP2.0 channel');
      }
      out.push(...f.data.slice(1));
      const pci = f.data[0];
      if (expectsAck(pci)) {
        const ackSeq = ((pci & 0x0f) + 1) & 0x0f;
        await this.link.send({ id: this.txId, data: [(TP.ACK_READY << 4) | ackSeq] });
      }
      if (isLastFrame(pci)) break;
    }
    return out;
  }

  /** Wait for the module's ACK (0xB<seq>), tolerating NOT_READY (0x9<seq>) pauses and detecting a
   *  peer disconnect. */
  private async awaitAck(): Promise<void> {
    for (;;) {
      const f = await this.next(
        (x) =>
          x.id === this.rxId &&
          ((x.data[0] >> 4) === TP.ACK_READY ||
            (x.data[0] >> 4) === TP.NOT_READY ||
            x.data[0] === TP_CTRL.DISCONNECT),
      );
      if (f.data[0] === TP_CTRL.DISCONNECT) {
        this.halt();
        throw new Tp20Error('Module closed the TP2.0 channel');
      }
      if ((f.data[0] >> 4) === TP.ACK_READY) return;
      // NOT_READY: receiver busy — keep waiting (each wait has its own timeout budget).
    }
  }

  private kaTick = (): void => {
    // Skip when anything is running or queued — keep-alives exist for IDLE channels only.
    if (this.pendingOps > 0 || !this.txId) return;
    void this.enqueue(() => this.channelTest()).catch(() => undefined);
  };

  /** Idle keep-alive: 0xA3 channel test, expecting a PARAM_RESP. Failure = dead channel. */
  private async channelTest(): Promise<void> {
    if (!this.txId) return; // closed while queued
    try {
      await this.link.send({ id: this.txId, data: [TP_CTRL.CHANNEL_TEST] });
      await this.next((f) => f.id === this.rxId && f.data[0] === TP_CTRL.PARAM_RESP);
    } catch {
      this.halt(); // channel is gone; the next request() throws 'Channel not open'
    }
  }

  /** Drop channel state without touching the bus (peer already disconnected / keep-alive died). */
  private halt(): void {
    if (this.kaTimer) {
      clearInterval(this.kaTimer);
      this.kaTimer = null;
    }
    this.txId = 0;
    this.rxId = 0;
    this.setupIds = [];
  }

  async close(): Promise<void> {
    if (this.kaTimer) {
      clearInterval(this.kaTimer);
      this.kaTimer = null;
    }
    if (this.txId) {
      try {
        await this.link.send({ id: this.txId, data: [TP_CTRL.DISCONNECT] });
      } catch {
        // best-effort
      }
    }
    await this.link.setFilter?.(null).catch(() => undefined);
    this.unsub?.();
    this.unsub = null;
    this.txId = 0;
    this.rxId = 0;
    this.setupIds = [];
    this.inbox.length = 0;
    for (const w of this.waiters.splice(0)) {
      clearTimeout(w.timer);
      w.reject(new Tp20Error('TP2.0 channel closed'));
    }
  }
}

/** Parse a VAG gateway installation-list KWP response ([0x61, lid, ...bitmap]) into the set of
 *  installed module addresses. Bit n of byte b => address (b*8 + n); address 0 is not a module.
 *  NOTE: bitmap semantics are plausible-but-unverified on a real gateway — see docs/features/tp20.md. */
export function parseGatewayInstallList(kwpResponse: number[]): number[] {
  if (kwpResponse.length < 3 || kwpResponse[0] !== 0x61) return [];
  const bitmap = kwpResponse.slice(2);
  const addresses: number[] = [];
  bitmap.forEach((byte, b) => {
    for (let bit = 0; bit < 8; bit++) {
      if (byte & (1 << bit)) {
        const addr = b * 8 + bit;
        if (addr) addresses.push(addr);
      }
    }
  });
  return addresses;
}

/** One KWP2000 fault as VAG modules report it: 2-byte DTC (read as decimal = the VCDS 5-digit
 *  code) + status byte. */
export interface KwpDtc {
  raw: number;
  /** VCDS-style 5-digit VAG code, e.g. '00928'. */
  vag: string;
  status: number;
}

/** Parse a KWP readDiagnosticTroubleCodesByStatus response ([0x58, count, (hi lo status)*]).
 *  Returns null when the payload is not a positive 0x58 response. */
export function parseKwpDtcs(resp: number[]): KwpDtc[] | null {
  if (!resp.length || resp[0] !== 0x58) return null;
  const count = resp[1] ?? 0;
  const out: KwpDtc[] = [];
  for (let i = 2; i + 1 < resp.length && out.length < count; i += 3) {
    const raw = (resp[i] << 8) | resp[i + 1];
    if (!raw) continue;
    out.push({ raw, vag: raw.toString().padStart(5, '0'), status: resp[i + 2] ?? 0 });
  }
  return out;
}
