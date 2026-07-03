/** Unit tests for the pure/behavioral parts of the ELM327 raw-CAN link: line parsing, the
 *  begin/end command sequences (the ATS1-vs-ATS0 distinction is load-bearing), command-window
 *  frame capture, filters, the STN fast path, and the capability probe — all against a scripted
 *  Elm327Client stand-in (the real device path stays device-only, like BleTransport). */

import type { Elm327Client } from '../elm327/Elm327Client';
import { Elm327RawCanLink, parseRawCanLine, probeTp20Capability } from './elmRawCan';
import { RawFrame } from './tp20';

function mockClient(responses: Record<string, string> = {}) {
  const calls: string[] = [];
  let monitorCb: ((line: string) => void) | null = null;
  const client = {
    raw: async (cmd: string) => {
      calls.push(cmd);
      return responses[cmd] ?? 'OK';
    },
    startMonitor: async (cb: (line: string) => void) => {
      monitorCb = cb;
    },
    stopMonitor: async () => {
      monitorCb = null;
    },
    get monitoring() {
      return monitorCb !== null;
    },
  };
  return {
    client: client as unknown as Elm327Client,
    calls,
    feedMonitor: (line: string) => monitorCb?.(line),
  };
}

describe('parseRawCanLine', () => {
  it('parses spaced ATMA lines (11-bit id + byte tokens)', () => {
    expect(parseRawCanLine('21F 00 D0 00 03 40 07 01')).toEqual({
      id: 0x21f,
      data: [0x00, 0xd0, 0x00, 0x03, 0x40, 0x07, 0x01],
    });
    expect(parseRawCanLine('  300 b1 ')).toEqual({ id: 0x300, data: [0xb1] });
  });

  it('rejects adapter status noise', () => {
    for (const line of ['OK', 'BUFFER FULL', 'CAN ERROR', '<DATA ERROR', '>', '?', 'STOPPED', '']) {
      expect(parseRawCanLine(line)).toBeNull();
    }
  });

  it('rejects glued hex (what ATS0 would produce) — this is why begin() must set ATS1', () => {
    expect(parseRawCanLine('2E8021A9B')).toBeNull();
  });

  it('rejects 29-bit ids and ragged byte tokens (TP2.0 is 11-bit)', () => {
    expect(parseRawCanLine('18DAF110 01 02')).toBeNull();
    expect(parseRawCanLine('2E8 1 02')).toBeNull();
    expect(parseRawCanLine('2E8')).toBeNull();
  });
});

describe('Elm327RawCanLink', () => {
  it('begin() sets raw-CAN mode with spaces ON and clears leftover filters', async () => {
    const { client, calls } = mockClient();
    const link = new Elm327RawCanLink(client);
    await link.begin();
    expect(calls).toContain('ATCAF0');
    expect(calls).toContain('ATH1');
    expect(calls).toContain('ATS1');
    expect(calls).not.toContain('ATS0');
    expect(calls).toContain('ATCRA'); // leftover UDS ATCRA filter cleared
    expect(client.monitoring).toBe(true);
  });

  it('end() restores what the normal OBD client expects (ATCAF1/ATH0/ATS0)', async () => {
    const { client, calls } = mockClient();
    const link = new Elm327RawCanLink(client);
    await link.begin();
    calls.length = 0;
    await link.end();
    expect(calls).toEqual(expect.arrayContaining(['ATCAF1', 'ATH0', 'ATS0']));
    expect(client.monitoring).toBe(false);
  });

  it('send() sets the header once per id and writes hex bytes', async () => {
    const { client, calls } = mockClient();
    const link = new Elm327RawCanLink(client);
    await link.begin();
    calls.length = 0;
    await link.send({ id: 0x200, data: [0x01, 0xc0, 0x00, 0x10, 0x00, 0x03, 0x01] });
    await link.send({ id: 0x200, data: [0xb1] });
    expect(calls.filter((c) => c === 'ATSH200')).toHaveLength(1); // header cached
    expect(calls).toContain('01C00010000301'); // the data bytes as one hex write
    expect(calls).toContain('B1');
    expect(client.monitoring).toBe(true); // monitor resumed after each send
  });

  it('parses frames printed inside the send command window (the immediate ACK lands there)', async () => {
    const { client } = mockClient({ '021A9B': '300 B1 \r300 10 5A 9B 30 33 4C' });
    const link = new Elm327RawCanLink(client);
    const seen: RawFrame[] = [];
    link.onFrame((f) => seen.push(f));
    await link.begin();
    await link.send({ id: 0x740, data: [0x02, 0x1a, 0x9b] });
    expect(seen).toHaveLength(2);
    expect(seen[0]).toEqual({ id: 0x300, data: [0xb1] });
    expect(seen[1].data.slice(0, 3)).toEqual([0x10, 0x5a, 0x9b]);
  });

  it('setFilter uses ATCRA for exact ids, ATCF/ATCM for ranges, and clears on null', async () => {
    const { client, calls } = mockClient();
    const link = new Elm327RawCanLink(client);
    await link.begin();
    calls.length = 0;
    await link.setFilter({ id: 0x300, mask: 0x7ff });
    expect(calls).toContain('ATCRA300');
    calls.length = 0;
    await link.setFilter({ id: 0x200, mask: 0x700 });
    expect(calls).toEqual(expect.arrayContaining(['ATCF200', 'ATCM700']));
    calls.length = 0;
    await link.setFilter(null);
    expect(calls).toContain('ATCRA');
    expect(client.monitoring).toBe(true); // monitoring resumed around the filter change
  });

  it('uses a single STPX command per frame on STN/OBDLink adapters', async () => {
    const { client, calls } = mockClient({ STI: 'STN2255 v5.6.8' });
    const link = new Elm327RawCanLink(client);
    await link.begin();
    calls.length = 0;
    await link.send({ id: 0x740, data: [0x10, 0x1a, 0x9b] });
    expect(calls).toEqual(
      expect.arrayContaining([expect.stringMatching(/^STPX H:740, D:101A9B/)]),
    );
    expect(calls.some((c) => c.startsWith('ATSH'))).toBe(false);
  });
});

describe('probeTp20Capability', () => {
  it('reports ok when raw-CAN traffic is visible', async () => {
    const { client, feedMonitor } = mockClient();
    setTimeout(() => {
      feedMonitor('280 01 02 03 04 05 06 07 08');
      feedMonitor('320 04 00 4A');
    }, 10);
    const probe = await probeTp20Capability(client, 60);
    expect(probe.ok).toBe(true);
    expect(probe.framesSeen).toBe(2);
    expect(client.monitoring).toBe(false); // probe cleans up after itself
  });

  it('reports not-ok on a silent bus / incapable clone', async () => {
    const { client } = mockClient();
    const probe = await probeTp20Capability(client, 40);
    expect(probe).toEqual({ ok: false, framesSeen: 0 });
  });
});
