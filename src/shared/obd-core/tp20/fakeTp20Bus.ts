/** In-memory VW TP2.0 bus for tests and the simulator: a gateway + a few pre-UDS modules that
 *  answer channel setup, parameters, keep-alives, and a small KWP2000 application layer (ident,
 *  faults, gateway install list). Lets the whole TP2.0 stack + module-scan flow run with no
 *  hardware. Byte order and response ids follow the canonical real-car trace (setup response on
 *  0x200+dest, module-tx id first) so the fake and the golden-trace test agree. */

import { RawCanLink, RawFrame, TP20_SETUP_ID, TP, TP_CTRL, isLastFrame, expectsAck } from './tp20';

export interface FakeTp20Module {
  /** Logical address, e.g. 0x19 gateway, 0x17 cluster. */
  address: number;
  /** CAN id the tester sends to (module rx) and the id the module answers on (module tx). */
  rxId: number;
  txId: number;
  /** KWP responder: request bytes -> response bytes (service byte first). */
  kwp: (req: number[]) => number[];
  /** Block size the module announces in its PARAM_RESP and applies when sending long responses
   *  (an ACK-expected frame every `blockSize` frames — the tester MUST ack mid-packet). */
  blockSize?: number;
}

export interface FakeTp20Options {
  modules: FakeTp20Module[];
}

export interface FakeKwpDtcSeed {
  /** VAG 5-digit code as a number (decimal of the 2-byte DTC), e.g. 928 for 00928. */
  code: number;
  status?: number;
}

/** Build a KWP responder for a module: ident (0x1A), session start (0x10), faults (0x18).
 *  Modules answer 0x58 0x00 (no faults) unless seeded. */
export function kwpIdentResponder(
  partNumber: string,
  extra: Record<string, string> = {},
  dtcs?: FakeKwpDtcSeed[],
) {
  const ascii = (s: string) => s.split('').map((c) => c.charCodeAt(0));
  return (req: number[]): number[] => {
    if (req[0] === 0x1a) {
      const lid = req[1] ?? 0x9b;
      const text = extra[lid.toString(16)] ?? partNumber;
      return [0x5a, lid, ...ascii(text)];
    }
    if (req[0] === 0x10) return [0x50, req[1] ?? 0x89]; // startDiagnosticSession
    if (req[0] === 0x18) {
      const list = dtcs ?? [];
      const triples = list.flatMap((d) => [(d.code >> 8) & 0xff, d.code & 0xff, d.status ?? 0x22]);
      return [0x58, list.length, ...triples]; // readDTCByStatus
    }
    return [0x7f, req[0] ?? 0x00, 0x11]; // serviceNotSupported
  };
}

/** Gateway responder that also answers the installation-list read (0x21 0x0B -> bitmap). */
export function kwpGatewayResponder(
  installedAddresses: number[],
  opts: { ident?: string; dtcs?: FakeKwpDtcSeed[] } = {},
) {
  const part = opts.ident ?? '1K0907530';
  const ident = kwpIdentResponder(part, { '9b': part }, opts.dtcs);
  const maxByte = installedAddresses.length ? Math.max(...installedAddresses) >> 3 : 0;
  const bitmap = new Array(maxByte + 1).fill(0);
  for (const a of installedAddresses) bitmap[a >> 3] |= 1 << (a & 7);
  return (req: number[]): number[] => {
    if (req[0] === 0x21 && req[1] === 0x0b) return [0x61, 0x0b, ...bitmap];
    return ident(req);
  };
}

export class FakeTp20Bus implements RawCanLink {
  private listeners = new Set<(f: RawFrame) => void>();
  private active: FakeTp20Module | null = null;
  private rxAssembly: number[] = [];
  /** Remaining response frames when paused at a block boundary, waiting for the tester's ACK. */
  private txQueue: number[][] = [];
  private txSeq = 0;
  /** Keep-alive (0xA3) count, for tests. */
  a3Count = 0;

  constructor(private opts: FakeTp20Options) {}

  onFrame(cb: (f: RawFrame) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(frame: RawFrame): void {
    // async delivery so callers' await points run, like a real bus
    setTimeout(() => {
      for (const l of [...this.listeners]) l(frame);
    }, 0);
  }

  async send(frame: RawFrame): Promise<void> {
    // Channel setup broadcast.
    if (frame.id === TP20_SETUP_ID && frame.data[1] === TP_CTRL.SETUP_REQ) {
      const dest = frame.data[0];
      const mod = this.opts.modules.find((m) => m.address === dest);
      if (!mod) return; // silent module
      this.active = mod;
      this.rxAssembly = [];
      this.txQueue = [];
      this.txSeq = 0;
      this.emit({
        id: TP20_SETUP_ID + dest, // canonical: the module answers on 0x200 + its address
        // Canonical byte order: [0x00, D0, modTx_lo, modTx_hi, modRx_lo, modRx_hi, app] — the id
        // the module transmits on first (tester rx), then the id the tester must transmit on.
        data: [0x00, TP_CTRL.SETUP_RESP, mod.txId & 0xff, mod.txId >> 8, mod.rxId & 0xff, mod.rxId >> 8, 0x01],
      });
      return;
    }
    const mod = this.active;
    if (!mod || frame.id !== mod.rxId) return;

    // Channel params.
    if (frame.data[0] === TP_CTRL.PARAM_REQ) {
      this.emit({ id: mod.txId, data: [TP_CTRL.PARAM_RESP, mod.blockSize ?? 0x0f, 0x8a, 0xff, 0x4a, 0xff] });
      return;
    }
    // Keep-alive channel test.
    if (frame.data[0] === TP_CTRL.CHANNEL_TEST) {
      this.a3Count++;
      this.emit({ id: mod.txId, data: [TP_CTRL.PARAM_RESP, mod.blockSize ?? 0x0f, 0x8a, 0xff, 0x4a, 0xff] });
      return;
    }
    if (frame.data[0] === TP_CTRL.DISCONNECT) {
      this.active = null;
      this.txQueue = [];
      return;
    }
    // ACK from tester: resume a block-paused response, if any.
    if (frame.data[0] >> 4 === TP.ACK_READY) {
      if (this.txQueue.length) this.drainTx(mod);
      return;
    }
    if (frame.data[0] >> 4 === TP.NOT_READY) return;

    // Data frame(s) carrying a KWP request.
    const pci = frame.data[0];
    if (pci >> 4 <= TP.DATA_LAST) {
      this.rxAssembly.push(...frame.data.slice(1));
      // Like a real module: ACK every ACK-expected frame (block boundaries AND the last frame).
      if (expectsAck(pci)) {
        const ackSeq = ((pci & 0x0f) + 1) & 0x0f;
        this.emit({ id: mod.txId, data: [(TP.ACK_READY << 4) | ackSeq] });
      }
      if (isLastFrame(pci)) {
        const req = this.rxAssembly;
        this.rxAssembly = [];
        this.pushResponse(mod, mod.kwp(req));
      }
    }
  }

  /** Queue a KWP response as data frames, pausing at block boundaries for the tester's ACK. */
  private pushResponse(mod: FakeTp20Module, resp: number[]): void {
    const bs = Math.max(1, mod.blockSize ?? 0x0f);
    const chunks: number[][] = [];
    for (let i = 0; i < resp.length; i += 7) chunks.push(resp.slice(i, i + 7));
    if (!chunks.length) chunks.push([]);
    this.txQueue = chunks.map((chunk, i) => {
      const last = i === chunks.length - 1;
      const op = last ? TP.DATA_LAST_ACK : (i + 1) % bs === 0 ? TP.DATA_MORE_ACK : TP.DATA_MORE;
      return [(op << 4) | ((this.txSeq + i) & 0x0f), ...chunk];
    });
    this.txSeq = (this.txSeq + chunks.length) & 0x0f;
    this.drainTx(mod);
  }

  private drainTx(mod: FakeTp20Module): void {
    while (this.txQueue.length) {
      const f = this.txQueue.shift()!;
      this.emit({ id: mod.txId, data: f });
      // Block boundary mid-packet: a real module stops here until the tester ACKs.
      if (expectsAck(f[0]) && !isLastFrame(f[0])) return;
    }
  }
}

/** Build a FakeTp20Bus from a vehicle profile's TP2.0 modules + gateway install list, so the
 *  simulator and tests exercise the exact scan the UI runs. */
import type { VehicleProfile } from '../../vehicles/types';
import { GATEWAY_ADDRESS } from './tp20Scan';

export function buildTp20BusFromProfile(profile: VehicleProfile): FakeTp20Bus {
  const tp20Modules = (profile.modules ?? []).filter(
    (m) => m.transport === 'tp20' && m.tp20Address !== undefined,
  );
  const installed = profile.gatewayInstallList ?? [];
  const modules: FakeTp20Module[] = [];

  // Gateway on 0x19 answering the install list (ident/faults from the profile when declared).
  const gwProfile = tp20Modules.find((m) => m.tp20Address === GATEWAY_ADDRESS);
  modules.push({
    address: GATEWAY_ADDRESS,
    rxId: 0x700 + GATEWAY_ADDRESS,
    txId: 0x300 + GATEWAY_ADDRESS,
    kwp: kwpGatewayResponder(installed, {
      ident: gwProfile?.tp20SampleIdent,
      dtcs: gwProfile?.tp20SampleDtcs,
    }),
  });

  for (const m of tp20Modules) {
    const addr = m.tp20Address as number;
    if (addr === GATEWAY_ADDRESS) continue;
    modules.push({
      address: addr,
      rxId: 0x700 + addr,
      txId: 0x300 + addr,
      kwp: kwpIdentResponder(
        m.tp20SampleIdent ?? m.name,
        { '9b': m.tp20SampleIdent ?? m.name },
        m.tp20SampleDtcs,
      ),
    });
  }
  return new FakeTp20Bus({ modules });
}
