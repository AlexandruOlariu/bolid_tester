import {
  UdsSend,
  UdsError,
  checkNegative,
  codeModule,
  readDataByIdentifier,
  enterSession,
  securityAccess,
  serviceReset,
  isModuleUnreachableError,
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

describe('checkNegative / response pending (NRC 0x78)', () => {
  const caught = (fn: () => void): UdsError | null => {
    try {
      fn();
      return null;
    } catch (e) {
      return e as UdsError;
    }
  };

  it('strips leading 7F xx 78 echoes and returns the final response', () => {
    expect(
      checkNegative(0x31, [0x7f, 0x31, 0x78, 0x7f, 0x31, 0x78, 0x71, 0x01, 0x02, 0x03]),
    ).toEqual([0x71, 0x01, 0x02, 0x03]);
  });

  it('throws a 0x78-tagged error when ONLY pending echoes arrived', () => {
    const e = caught(() => checkNegative(0x31, [0x7f, 0x31, 0x78]));
    expect(e).toBeInstanceOf(UdsError);
    expect(e?.nrc).toBe(0x78);
  });

  it('reports the real negative response behind pending echoes', () => {
    const e = caught(() => checkNegative(0x31, [0x7f, 0x31, 0x78, 0x7f, 0x31, 0x22]));
    expect(e?.nrc).toBe(0x22);
  });

  it('does not treat another service’s 7F as a pending echo', () => {
    // 7F 2E 78 while waiting on 0x31: not an echo for this request — a plain negative response.
    const e = caught(() => checkNegative(0x31, [0x7f, 0x2e, 0x78]));
    expect(e?.message).toContain('Negative response');
  });
});

describe('securityAccess lockout handling', () => {
  it('retries once after NRC 0x37 (requiredTimeDelayNotExpired)', async () => {
    let seedCalls = 0;
    const send: UdsSend = async (cmd) => {
      if (cmd.toLowerCase().startsWith('2701')) {
        seedCalls += 1;
        return seedCalls === 1 ? [0x7f, 0x27, 0x37] : [0x67, 0x01, 0xde, 0xad];
      }
      return [0x67, 0x02];
    };
    await securityAccess(send, 0x01, (s) => s, { retryDelayMs: 0 });
    expect(seedCalls).toBe(2);
  });

  it('does NOT retry NRC 0x36 (exceedNumberOfAttempts)', async () => {
    let calls = 0;
    const send: UdsSend = async () => {
      calls += 1;
      return [0x7f, 0x27, 0x36];
    };
    await expect(securityAccess(send, 0x01, (s) => s, { retryDelayMs: 0 })).rejects.toBeInstanceOf(
      UdsError,
    );
    expect(calls).toBe(1);
  });
});

describe('isModuleUnreachableError', () => {
  it.each([
    'No response',
    'NO DATA',
    'ELM327 timeout after 4000ms for "1085"',
    'Timed out waiting for prompt',
    'timed-out',
    'UNABLE TO CONNECT',
    'BUS INIT ERROR',
    'BUS INIT: ...ERROR',
  ])('recognises "%s" as unreachable', (msg) => {
    expect(isModuleUnreachableError(msg)).toBe(true);
  });

  it.each([
    'Negative response (NRC 0x31)',
    'Unexpected response 0x50 (wanted 0x71)',
    'BLE write failed',
  ])('does NOT flag "%s"', (msg) => {
    expect(isModuleUnreachableError(msg)).toBe(false);
  });
});
