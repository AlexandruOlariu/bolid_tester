/** Golden-trace test: drives Tp20Channel against the CANONICAL published real-car byte exchange
 *  (PQ-platform engine, logical address 0x01) instead of the fake bus. The fake is coherent by
 *  construction — both ends share one codebase — so it can never catch an id-orientation or
 *  byte-order mistake. This script can: every tester frame is asserted byte-for-byte, and the
 *  replies are the documented ECU bytes.
 *
 *  Trace (see tp20.ts header):
 *    tester → 0x200   01 C0 00 10 00 03 01        channel setup
 *    ECU    → 0x201   00 D0 00 03 40 07 01        → ECU sends on 0x300, tester sends on 0x740
 *    tester → 0x740   A0 0F 8A FF 32 FF           parameters
 *    ECU    → 0x300   A1 0F 8A FF 4A FF
 *    tester → 0x740   10 1A 9B                    KWP readEcuIdentification, seq 0, LAST_ACK
 *    ECU    → 0x300   B1                          ACK, next seq 1
 *    ECU    → 0x300   20 5A 9B 30 33 4C 39 30     response frame 1/2 (MORE, seq 0)
 *    ECU    → 0x300   11 36 30 32 32 4C 4D        response frame 2/2 (LAST_ACK, seq 1)
 *    tester → 0x740   B2                          ACK, next seq 2
 *    tester → 0x740   A8                          disconnect */

import { RawCanLink, RawFrame, Tp20Channel } from './tp20';

interface Step {
  expectId: number;
  expectData: number[];
  replies: RawFrame[];
}

class ScriptedLink implements RawCanLink {
  sent: RawFrame[] = [];
  private listeners = new Set<(f: RawFrame) => void>();

  constructor(private script: Step[]) {}

  onFrame(cb: (f: RawFrame) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(f: RawFrame): void {
    setTimeout(() => {
      for (const l of [...this.listeners]) l(f);
    }, 0);
  }

  async send(frame: RawFrame): Promise<void> {
    this.sent.push(frame);
    const step = this.script.shift();
    if (!step) throw new Error(`Unexpected extra frame: id 0x${frame.id.toString(16)}`);
    expect(frame.id).toBe(step.expectId);
    expect(frame.data).toEqual(step.expectData);
    for (const r of step.replies) this.emit(r);
  }

  get done(): boolean {
    return this.script.length === 0;
  }
}

const ident = (s: string) => s.split('').map((c) => c.charCodeAt(0));

describe('TP2.0 golden trace (canonical real-car bytes, engine 0x01)', () => {
  it('reproduces the documented byte exchange end-to-end', async () => {
    const part = '03L906022LM'; // 11 chars -> KWP resp 5A 9B + 11 = 13 bytes -> 2 frames
    const bytes = ident(part);
    const link = new ScriptedLink([
      {
        expectId: 0x200,
        expectData: [0x01, 0xc0, 0x00, 0x10, 0x00, 0x03, 0x01],
        replies: [{ id: 0x201, data: [0x00, 0xd0, 0x00, 0x03, 0x40, 0x07, 0x01] }],
      },
      {
        // Parameters go to 0x740 — if the channel had rx/tx swapped, this send would hit 0x300
        // and the test fails here.
        expectId: 0x740,
        expectData: [0xa0, 0x0f, 0x8a, 0xff, 0x32, 0xff],
        replies: [{ id: 0x300, data: [0xa1, 0x0f, 0x8a, 0xff, 0x4a, 0xff] }],
      },
      {
        expectId: 0x740,
        expectData: [0x10, 0x1a, 0x9b],
        replies: [
          { id: 0x300, data: [0xb1] },
          { id: 0x300, data: [0x20, 0x5a, 0x9b, ...bytes.slice(0, 5)] },
          { id: 0x300, data: [0x11, ...bytes.slice(5)] },
        ],
      },
      { expectId: 0x740, expectData: [0xb2], replies: [] },
      { expectId: 0x740, expectData: [0xa8], replies: [] },
    ]);

    const ch = new Tp20Channel(link, { timeoutMs: 300, keepAliveMs: 0 });
    await ch.open(0x01);
    const resp = await ch.request([0x1a, 0x9b]);
    await ch.close();

    expect(resp[0]).toBe(0x5a);
    expect(String.fromCharCode(...resp.slice(2)).trim()).toBe(part);
    expect(link.done).toBe(true);
    expect(link.sent.map((f) => f.id)).toEqual([0x200, 0x740, 0x740, 0x740, 0x740]);
  });

  it('rejects a negative channel-setup response', async () => {
    const link = new ScriptedLink([
      {
        expectId: 0x200,
        expectData: [0x01, 0xc0, 0x00, 0x10, 0x00, 0x03, 0x01],
        replies: [{ id: 0x201, data: [0x00, 0xd6, 0x00, 0x00, 0x00, 0x00, 0x01] }], // no resources
      },
    ]);
    const ch = new Tp20Channel(link, { timeoutMs: 200, keepAliveMs: 0 });
    await expect(ch.open(0x01)).rejects.toThrow(/refused/i);
  });

  it('rejects a setup response carrying the invalid-id flag (0x10 in the high byte)', async () => {
    const link = new ScriptedLink([
      {
        expectId: 0x200,
        expectData: [0x01, 0xc0, 0x00, 0x10, 0x00, 0x03, 0x01],
        replies: [{ id: 0x201, data: [0x00, 0xd0, 0x00, 0x13, 0x40, 0x07, 0x01] }],
      },
    ]);
    const ch = new Tp20Channel(link, { timeoutMs: 200, keepAliveMs: 0 });
    await expect(ch.open(0x01)).rejects.toThrow(/invalid/i);
  });
});
