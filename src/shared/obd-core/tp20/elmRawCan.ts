/** RawCanLink over a real ELM327 in raw-CAN mode, for TP2.0 on hardware. Like BleTransport, this
 *  is device-only glue — the protocol logic is what the tests cover (FakeTp20Bus + golden trace);
 *  here only the pure helpers (`parseRawCanLine`, command sequences) are unit-tested.
 *
 *  How it works: ATCAF0 (no auto-formatting), ATH1 (show ids), ATS1 (spaces ON — the line parser
 *  needs `id b1 b2…` tokens), then ATMA monitoring. Sending briefly leaves monitor mode (stop →
 *  header → write → resume); frames the adapter prints inside that command window — the module's
 *  immediate ACK usually lands exactly there — are parsed from the command response instead of
 *  being dropped. On STN/OBDLink adapters (detected via STI) sends use a single STPX command.
 *  `setFilter` narrows the adapter's receive filter (ATCRA / ATCF+ATCM) so ATMA doesn't flood
 *  cheap clones on a busy PQ bus.
 *
 *  Still honest: per-frame turnaround through an ELM327 is slow versus TP2.0's ~100ms ack window;
 *  clones vary. Run `probeTp20Capability` first to detect adapters that can't do raw CAN at all.
 *  See docs/features/tp20.md. */

import { Elm327Client } from '../elm327/Elm327Client';
import { RawCanLink, RawFrame } from './tp20';

function toHex(bytes: number[]): string {
  return bytes.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join('');
}

function hex3(id: number): string {
  return id.toString(16).padStart(3, '0').toUpperCase();
}

/** Parse one ATMA/command-window line (`21F 00 D0 00 03 40 07 01`) into a RawFrame. Rejects
 *  status noise (`OK`, `BUFFER FULL`, `CAN ERROR`, `>`, `?`) and 29-bit ids (TP2.0 is 11-bit).
 *  Requires ATS1: with spaces off the id and data glue into one token and no frame parses. */
export function parseRawCanLine(line: string): RawFrame | null {
  const t = line.trim().toUpperCase().split(/\s+/).filter(Boolean);
  if (t.length < 2 || t.some((x) => /[^0-9A-F]/.test(x))) return null;
  if (t[0].length !== 3) return null; // 11-bit id ("2E8"); anything else is noise or 29-bit
  const id = parseInt(t[0], 16);
  if (Number.isNaN(id) || id > 0x7ff) return null;
  const data: number[] = [];
  for (const b of t.slice(1)) {
    if (b.length !== 2) return null; // not a clean byte dump — don't guess
    data.push(parseInt(b, 16));
  }
  if (!data.length) return null;
  return { id, data };
}

export class Elm327RawCanLink implements RawCanLink {
  private frameListeners = new Set<(f: RawFrame) => void>();
  private started = false;
  private stn = false;
  private lastHeader = -1;

  constructor(private client: Elm327Client) {}

  private dispatch = (line: string): void => {
    const f = parseRawCanLine(line);
    if (f) for (const l of [...this.frameListeners]) l(f);
  };

  /** Run every line of a command response through the frame parser — catches frames printed in
   *  the window between leaving and re-entering monitor mode. */
  private feed(text: string): void {
    for (const line of text.split(/[\r\n]+/)) this.dispatch(line);
  }

  /** Enter raw-CAN mode and begin monitoring. Call once before opening a channel. */
  async begin(): Promise<void> {
    if (this.started) return;
    // ATS1, not ATS0: the monitor parser needs space-separated id/byte tokens.
    for (const c of ['ATCAF0', 'ATH1', 'ATL0', 'ATS1']) await this.client.raw(c);
    // Clear any receive filter left over from a UDS module scan (ATCRA) — best-effort, old
    // firmwares answer '?'.
    await this.clearFilter();
    // STN/OBDLink detection: STPX carries header+data in one command (fewer round-trips/frame).
    const sti = await this.client.raw('STI').catch(() => '');
    this.stn = /\bSTN/i.test(sti);
    await this.client.startMonitor(this.dispatch);
    this.started = true;
  }

  async end(): Promise<void> {
    if (!this.started) return;
    await this.client.stopMonitor();
    // Restore what the normal client expects (init() runs ATL0/ATS0/ATH0): auto-format back on,
    // headers off, spaces off — otherwise every later OBD response parses wrong until re-init.
    for (const c of ['ATCAF1', 'ATH0', 'ATS0']) await this.client.raw(c).catch(() => undefined);
    await this.clearFilter();
    this.started = false;
    this.lastHeader = -1;
  }

  private async clearFilter(): Promise<void> {
    await this.client.raw('ATCRA').catch(() => undefined); // v1.4b+: reset receive address
    await this.client.raw('ATCM000').catch(() => undefined); // older: zero mask = accept all
  }

  /** Narrow the adapter's receive filter (mask 0x7FF = exact id). Null clears. */
  async setFilter(filter: { id: number; mask: number } | null): Promise<void> {
    const monitoring = this.started && this.client.monitoring;
    if (monitoring) await this.client.stopMonitor();
    if (!filter) {
      await this.clearFilter();
    } else if (filter.mask === 0x7ff) {
      await this.client.raw('ATCRA' + hex3(filter.id)).catch(() => undefined);
    } else {
      await this.client.raw('ATCF' + hex3(filter.id)).catch(() => undefined);
      await this.client.raw('ATCM' + hex3(filter.mask)).catch(() => undefined);
    }
    if (monitoring) await this.client.startMonitor(this.dispatch);
  }

  async send(frame: RawFrame): Promise<void> {
    // Sending requires briefly leaving monitor mode: stop, transmit, resume — and PARSE whatever
    // the adapter printed while the prompt window was open (the immediate ACK lands there).
    const monitoring = this.client.monitoring;
    if (monitoring) await this.client.stopMonitor();
    let window: string;
    if (this.stn) {
      // One command, header inline; R:1 prints the first reply frame before the prompt.
      window = await this.client.raw(`STPX H:${hex3(frame.id)}, D:${toHex(frame.data)}, R:1`);
    } else {
      if (frame.id !== this.lastHeader) {
        await this.client.raw('ATSH' + hex3(frame.id));
        this.lastHeader = frame.id;
      }
      window = await this.client.raw(toHex(frame.data));
    }
    this.feed(window);
    if (this.started) await this.client.startMonitor(this.dispatch);
  }

  onFrame(cb: (f: RawFrame) => void): () => void {
    this.frameListeners.add(cb);
    return () => this.frameListeners.delete(cb);
  }
}

/** Quick adapter capability check before a TP2.0 scan: enter raw-CAN monitor mode and count the
 *  frames seen in `listenMs`. A PQ CAN bus chatters constantly with ignition on, so zero frames
 *  means the adapter can't do raw CAN (many clones), the filter stack is broken, or the bus is
 *  asleep — warn before wasting a full scan's worth of timeouts. */
export async function probeTp20Capability(
  client: Elm327Client,
  listenMs = 700,
): Promise<{ ok: boolean; framesSeen: number }> {
  const link = new Elm327RawCanLink(client);
  let frames = 0;
  const unsub = link.onFrame(() => {
    frames++;
  });
  try {
    await link.begin();
    await new Promise((r) => setTimeout(r, listenMs));
  } finally {
    unsub();
    await link.end().catch(() => undefined);
  }
  return { ok: frames > 0, framesSeen: frames };
}
