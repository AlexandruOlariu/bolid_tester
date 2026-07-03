import {
  Tp20Channel,
  toTpFrames,
  isLastFrame,
  expectsAck,
  parseGatewayInstallList,
  parseKwpDtcs,
  TP,
} from './tp20';
import { FakeTp20Bus, kwpIdentResponder, kwpGatewayResponder } from './fakeTp20Bus';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('TP2.0 framing', () => {
  it('splits payloads into 7-byte sequenced frames; intermediates are plain MORE, last is LAST_ACK', () => {
    const frames = toTpFrames([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(frames).toHaveLength(2);
    expect(frames[0][0] >> 4).toBe(TP.DATA_MORE);
    expect(expectsAck(frames[0][0])).toBe(false);
    expect(frames[0].slice(1)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(isLastFrame(frames[1][0])).toBe(true);
    expect(expectsAck(frames[1][0])).toBe(true);
    expect(frames[1].slice(1)).toEqual([8, 9]);
  });

  it('marks ACK-expected block boundaries every blockSize frames', () => {
    // 20 bytes -> 3 frames; blockSize 2 -> frame index 1 is a boundary (MORE_ACK)
    const frames = toTpFrames(new Array(20).fill(0xaa), 0, 2);
    expect(frames).toHaveLength(3);
    expect(frames[0][0] >> 4).toBe(TP.DATA_MORE);
    expect(frames[1][0] >> 4).toBe(TP.DATA_MORE_ACK);
    expect(frames[2][0] >> 4).toBe(TP.DATA_LAST_ACK);
    // rolling sequence in the low nibble
    expect(frames.map((f) => f[0] & 0x0f)).toEqual([0, 1, 2]);
  });

  it('parses a gateway install-list bitmap into addresses (address 0 is not a module)', () => {
    // byte0 bit1 (addr 1) + bit3 (addr 3); byte2 bit7 (addr 23=0x17)
    expect(parseGatewayInstallList([0x61, 0x0b, 0b00001010, 0x00, 0b10000000])).toEqual([1, 3, 23]);
    expect(parseGatewayInstallList([0x61, 0x0b, 0b00000001])).toEqual([]); // only bit for addr 0
    expect(parseGatewayInstallList([0x7f, 0x21, 0x11])).toEqual([]);
  });

  it('parses KWP 0x58 fault responses into VAG 5-digit codes', () => {
    const dtcs = parseKwpDtcs([0x58, 2, 0x03, 0xa0, 0x22, 0x05, 0x32, 0x08]);
    expect(dtcs).toEqual([
      { raw: 0x03a0, vag: '00928', status: 0x22 },
      { raw: 0x0532, vag: '01330', status: 0x08 },
    ]);
    expect(parseKwpDtcs([0x58, 0])).toEqual([]);
    expect(parseKwpDtcs([0x7f, 0x18, 0x11])).toBeNull();
  });
});

describe('TP2.0 channel against the fake VW bus', () => {
  function bus() {
    return new FakeTp20Bus({
      modules: [
        {
          address: 0x1f,
          rxId: 0x200 + 0x1f,
          txId: 0x300 + 0x1f,
          kwp: kwpGatewayResponder([0x01, 0x03, 0x08, 0x09, 0x17, 0x19, 0x25, 0x46]),
        },
        {
          address: 0x17,
          rxId: 0x740,
          txId: 0x760,
          kwp: kwpIdentResponder('5M0920861B', { '9b': '5M0920861B KOMBIINSTRUMENT' }),
        },
        {
          address: 0x09,
          rxId: 0x741,
          txId: 0x761,
          // multi-frame ident to exercise reassembly
          kwp: kwpIdentResponder('1K0937087 Bordnetz-SG lange Kennung XYZ'),
        },
      ],
    });
  }

  it('opens a channel to the cluster and reads its ident', async () => {
    const ch = new Tp20Channel(bus());
    await ch.open(0x17);
    const resp = await ch.request([0x1a, 0x9b]);
    expect(resp[0]).toBe(0x5a);
    const text = String.fromCharCode(...resp.slice(2));
    expect(text).toContain('KOMBIINSTRUMENT');
    await ch.close();
  });

  it('reads the gateway installation list and decodes installed modules', async () => {
    const ch = new Tp20Channel(bus());
    await ch.open(0x1f);
    const resp = await ch.request([0x21, 0x0b]);
    const addrs = parseGatewayInstallList(resp);
    expect(addrs).toEqual([0x01, 0x03, 0x08, 0x09, 0x17, 0x19, 0x25, 0x46]);
    await ch.close();
  });

  it('reassembles a multi-frame response', async () => {
    const ch = new Tp20Channel(bus());
    await ch.open(0x09);
    const resp = await ch.request([0x1a, 0x9b]);
    const text = String.fromCharCode(...resp.slice(2));
    expect(text).toContain('lange Kennung XYZ');
    await ch.close();
  });

  it('times out opening a channel to an absent module', async () => {
    const ch = new Tp20Channel(bus(), { timeoutMs: 60, keepAliveMs: 0 });
    await expect(ch.open(0x55)).rejects.toThrow(/timeout/i);
  });

  it('ACKs mid-packet at block boundaries when receiving a long response (blockSize 2)', async () => {
    const longIdent = '1K0959433E Komfortgeraet PQ35 lange Kennung 0102'; // > 5 frames
    const fake = new FakeTp20Bus({
      modules: [
        {
          address: 0x46,
          rxId: 0x746,
          txId: 0x346,
          blockSize: 2, // the module pauses for an ACK every 2 frames — the tester MUST ack
          kwp: kwpIdentResponder(longIdent),
        },
      ],
    });
    const ch = new Tp20Channel(fake, { timeoutMs: 250 });
    await ch.open(0x46);
    const resp = await ch.request([0x1a, 0x9b]);
    expect(String.fromCharCode(...resp.slice(2))).toContain('lange Kennung 0102');
    await ch.close();
  });

  it('honors the peer block size when sending a long request', async () => {
    let seen: number[] = [];
    const fake = new FakeTp20Bus({
      modules: [
        {
          address: 0x46,
          rxId: 0x746,
          txId: 0x346,
          blockSize: 2, // announced in PARAM_RESP; boundary frames must stop for the module's ACK
          kwp: (req) => {
            seen = req;
            return [0x50, req[1] ?? 0];
          },
        },
      ],
    });
    const ch = new Tp20Channel(fake, { timeoutMs: 250 });
    await ch.open(0x46);
    const payload = Array.from({ length: 20 }, (_, i) => i + 1);
    const resp = await ch.request(payload);
    expect(resp[0]).toBe(0x50);
    expect(seen).toEqual(payload); // fully reassembled by the module despite the block pauses
    await ch.close();
  });

  it('keeps an idle channel alive with 0xA3 channel tests and still works afterwards', async () => {
    const fake = bus();
    const ch = new Tp20Channel(fake, { timeoutMs: 200, keepAliveMs: 25 });
    await ch.open(0x17);
    await sleep(90);
    expect(fake.a3Count).toBeGreaterThanOrEqual(2);
    const resp = await ch.request([0x1a, 0x9b]); // channel survived the idle period
    expect(resp[0]).toBe(0x5a);
    await ch.close();
    const after = fake.a3Count;
    await sleep(60);
    expect(fake.a3Count).toBe(after); // keep-alive stops with the channel
  });
});
