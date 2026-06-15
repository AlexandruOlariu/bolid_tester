import {
  UdsSend,
  UdsError,
  codeModule,
  readDataByIdentifier,
  enterSession,
  serviceReset,
} from './udsCoding';

/** A fake module that stores coding for one DID and answers the UDS services we use. */
function fakeModule(did: string, initial: number[], opts: { requireSecurity?: boolean } = {}) {
  let coding = initial.slice();
  let unlocked = !opts.requireSecurity;
  const hexToBytes = (h: string): number[] => {
    const out: number[] = [];
    for (let i = 0; i < h.length; i += 2) out.push(parseInt(h.slice(i, i + 2), 16));
    return out;
  };
  const send: UdsSend = async (cmd) => {
    const c = cmd.toLowerCase();
    if (c.startsWith('10')) return [0x50, ...hexToBytes(c.slice(2))];
    if (c === '3e00') return [0x7e, 0x00];
    if (c.startsWith('27')) {
      const sub = c.slice(2, 4);
      if (sub === '01') return [0x67, 0x01, 0xde, 0xad];
      unlocked = true;
      return [0x67, 0x02];
    }
    if (c.startsWith('31')) return [0x71, ...hexToBytes(c.slice(2))];
    if (c === '22' + did.toLowerCase()) return [0x62, ...hexToBytes(did), ...coding];
    if (c.startsWith('2e' + did.toLowerCase())) {
      if (!unlocked) return [0x7f, 0x2e, 0x33]; // securityAccessDenied
      coding = hexToBytes(c.slice(2 + did.length));
      return [0x6e, ...hexToBytes(did)];
    }
    return null;
  };
  return { send, get: () => coding };
}

describe('udsCoding', () => {
  it('reads the current coding (strips service byte + DID echo)', async () => {
    const m = fakeModule('F1A0', [0x01, 0x02, 0x03]);
    expect(await readDataByIdentifier(m.send, 'F1A0')).toEqual([0x01, 0x02, 0x03]);
  });

  it('runs the full backup→write→verify flow', async () => {
    const m = fakeModule('F1A0', [0x01, 0x02, 0x03]);
    const res = await codeModule(m.send, { did: 'F1A0', newData: [0x01, 0x06, 0x03] });
    expect(res.backup).toEqual([0x01, 0x02, 0x03]);
    expect(res.written).toEqual([0x01, 0x06, 0x03]);
    expect(res.verified).toBe(true);
    expect(m.get()).toEqual([0x01, 0x06, 0x03]);
  });

  it('performs security access when required', async () => {
    const m = fakeModule('F1A0', [0x00], { requireSecurity: true });
    const res = await codeModule(m.send, {
      did: 'F1A0',
      newData: [0x01],
      security: { level: 0x01, seedToKey: (seed) => seed.map((b) => b ^ 0xff) },
    });
    expect(res.verified).toBe(true);
  });

  it('throws UdsError on a negative response (no security)', async () => {
    const m = fakeModule('F1A0', [0x00], { requireSecurity: true });
    await expect(codeModule(m.send, { did: 'F1A0', newData: [0x01] })).rejects.toBeInstanceOf(UdsError);
  });

  it('throws on a missing response', async () => {
    const send: UdsSend = async () => null;
    await expect(enterSession(send)).rejects.toBeInstanceOf(UdsError);
  });
  it('runs a KWP-transport service reset (routine)', async () => {
    const m = fakeModule('F1A0', [0x00]);
    const res = await serviceReset(m.send, { transport: 'kwp', method: 'routine', routineId: '01', session: 0x85 });
    expect(res.ok).toBe(true);
    expect(res.method).toBe('routine');
  });

  it('runs a routine-based service reset', async () => {
    const m = fakeModule('F1A0', [0x00]);
    const res = await serviceReset(m.send, { method: 'routine', routineId: '0203' });
    expect(res.ok).toBe(true);
    expect(res.method).toBe('routine');
  });

  it('runs an adaptation-based service reset and backs up the old value', async () => {
    const m = fakeModule('2202', [0x12, 0x34]);
    const res = await serviceReset(m.send, {
      method: 'adaptation',
      adaptations: [{ did: '2202', defaultBytes: [0x00, 0x00] }],
    });
    expect(res.backups[0].bytes).toEqual([0x12, 0x34]);
    expect(m.get()).toEqual([0x00, 0x00]);
  });
});
