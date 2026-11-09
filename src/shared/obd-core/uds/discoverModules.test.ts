/** Module address discovery (plan 25) against the simulated Golf: exactly the three UDS modules the
 *  simulator seeds an ident for answer, every other candidate is silent, and addressing is restored
 *  after every candidate. */
import { DiagnosticSession } from '../session/DiagnosticSession';
import { MockTransport } from '../transport/MockTransport';
import { buildScenario } from '../transport/scenarios';
import { bytesToString } from '../../lib/bytes';
import { getVehicleProfile } from '../../vehicles';
import { discoverUdsModules } from './discoverModules';
import {
  VAG_UDS_HEADER_CANDIDATES,
  discoveryCandidates,
  groupCandidatesByPair,
  pickCandidateByIdent,
} from './vagHeaders';

/** One probe per distinct id pair: 08 and 46 share 746/7B0. */
const PAIRS = groupCandidatesByPair(VAG_UDS_HEADER_CANDIDATES).length;
const byAddress = (a: string) => VAG_UDS_HEADER_CANDIDATES.find((c) => c.address === a)!;

async function golf() {
  const transport = new MockTransport(buildScenario('golf-plus-2009-20tdi'));
  const tx: string[] = [];
  const write = transport.write.bind(transport);
  transport.write = (bytes) => {
    tx.push(bytesToString(bytes).replace(/\r$/, ''));
    return write(bytes);
  };
  const session = new DiagnosticSession(transport);
  await session.connect();
  tx.length = 0;
  return { session, tx };
}

describe('discoverUdsModules (Golf simulator)', () => {
  it('finds engine, ABS and cluster with their seeded part numbers; the rest stay silent', async () => {
    const { session } = await golf();
    const progress: [number, number][] = [];
    const found = await discoverUdsModules(session, VAG_UDS_HEADER_CANDIDATES, {
      timeoutMs: 500,
      onProgress: (done, total) => progress.push([done, total]),
    });

    expect(PAIRS).toBe(VAG_UDS_HEADER_CANDIDATES.length - 1);
    expect(found).toHaveLength(PAIRS);
    const answered = found.filter((f) => f.state === 'answered');
    expect(answered.map((f) => f.candidate.reqHeader)).toEqual(['7E0', '760', '714']);
    expect(answered.map((f) => f.ident?.partNumber)).toEqual([
      '03L906022LM',
      '1K0907379AC',
      '5M0920861B',
    ]);
    expect(answered[0].ident?.softwareVersion).toBe('4023');
    for (const f of found.filter((x) => x.state !== 'answered')) {
      expect(f.state).toBe('silent');
      expect(f.ident).toBeNull();
    }

    // Progress: once per probed id pair, ending at total.
    const total = PAIRS;
    expect(progress).toHaveLength(total);
    expect(progress[total - 1]).toEqual([total, total]);
  });

  it('restores default addressing after every candidate, and standard reads still work', async () => {
    const { session, tx } = await golf();
    const candidates = VAG_UDS_HEADER_CANDIDATES.slice(0, 4);
    await discoverUdsModules(session, candidates, { timeoutMs: 500 });

    // Each candidate: ATSH <req>, ATCRA <rx>, … then ATSH7DF + bare ATCRA before the next one.
    const resets = tx.filter((c) => c === 'ATSH7DF').length;
    expect(resets).toBe(candidates.length);
    expect(tx.filter((c) => c === 'ATCRA').length).toBe(candidates.length);
    expect(tx.slice(-2)).toEqual(['ATSH7DF', 'ATCRA']);
    for (const c of candidates) {
      const i = tx.indexOf(`ATSH${c.reqHeader}`);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(tx[i + 1]).toBe(`ATCRA${c.rxFilter}`);
    }
    // Only reads went out to the modules.
    const obd = tx.filter((c) => c && !c.startsWith('AT'));
    expect(obd.length).toBeGreaterThan(0);
    expect(obd.every((c) => c.startsWith('22'))).toBe(true);

    const rpm = await session.readValue('010C');
    expect(rpm?.value ?? 0).toBeGreaterThan(0);
  });

  it('restores addressing even when a probe fails with a link error', async () => {
    const { session, tx } = await golf();
    const send = session.send.bind(session);
    session.send = async (cmd: string) => {
      if (cmd === '22F187') throw new Error('BLE write failed');
      return send(cmd);
    };
    const found = await discoverUdsModules(session, VAG_UDS_HEADER_CANDIDATES.slice(0, 2));
    expect(found.map((f) => f.state)).toEqual(['error', 'error']);
    expect(found[0].reason).toBe('BLE write failed');
    expect(tx.slice(-2)).toEqual(['ATSH7DF', 'ATCRA']);
  });

  it('probes a shared id pair once and lets the ident pick the address (08 vs 46)', async () => {
    const { session, tx } = await golf();
    let header = '';
    const setHeader = session.setHeader.bind(session);
    session.setHeader = async (h: string | null) => {
      header = h ?? '';
      return setHeader(h);
    };
    const ascii = (t: string) => [...t].map((ch) => ch.charCodeAt(0));
    const send = session.send.bind(session);
    session.send = async (cmd: string) => {
      if (header !== '746' || !cmd.startsWith('22F1')) return send(cmd);
      const did = cmd.slice(2);
      const text = did === 'F187' ? '1K0959433CT' : did === 'F197' ? 'Komfortsystem' : null;
      return text ? [0x62, 0xf1, parseInt(did.slice(2), 16), ...ascii(text)] : [0x7f, 0x22, 0x31];
    };
    const found = await discoverUdsModules(session, [byAddress('08'), byAddress('46')], {
      timeoutMs: 500,
    });
    expect(found).toHaveLength(1);
    expect(found[0].state).toBe('answered');
    expect(found[0].candidate.address).toBe('46');
    expect(found[0].alternatives?.map((c) => c.address)).toEqual(['08']);
    expect(found[0].ident?.systemName).toBe('Komfortsystem');
    expect(tx.filter((c) => c === 'ATSH746')).toHaveLength(1);
  });

  it('refuses 29-bit CAN, where addressing could not be restored, without sending anything', async () => {
    const transport = new MockTransport(
      buildScenario('generic', { protocol: 'ISO_15765_4_CAN_29_500' }),
    );
    const session = new DiagnosticSession(transport);
    await session.connect();
    expect(session.currentProtocol).toBe('ISO_15765_4_CAN_29_500');
    const sent: string[] = [];
    const send = session.send.bind(session);
    session.send = async (cmd: string) => {
      sent.push(cmd);
      return send(cmd);
    };
    await expect(discoverUdsModules(session, VAG_UDS_HEADER_CANDIDATES)).rejects.toThrow(
      /11-bit CAN/,
    );
    expect(sent).toEqual([]);
  });

  it('a negative reply still counts as a module listening there', async () => {
    const { session } = await golf();
    const send = session.send.bind(session);
    session.send = async (cmd: string) => (cmd.startsWith('22') ? [0x7f, 0x22, 0x31] : send(cmd));
    const [f] = await discoverUdsModules(session, [VAG_UDS_HEADER_CANDIDATES[0]]);
    expect(f.state).toBe('answered');
    expect(f.ident?.raw).toEqual({});
  });
});

describe('discoveryCandidates', () => {
  it('adds a profile pair that is not a known candidate, once', () => {
    const golfModules = getVehicleProfile('golf-plus-2009-20tdi').modules;
    expect(discoveryCandidates(golfModules)).toEqual(VAG_UDS_HEADER_CANDIDATES);
    const extra = {
      address: '5F',
      name: 'Infotainment',
      transport: 'uds',
      reqHeader: '773',
      rxFilter: '7DD',
    };
    const list = discoveryCandidates([extra, extra, { ...extra, transport: 'tp20' }]);
    expect(list).toHaveLength(VAG_UDS_HEADER_CANDIDATES.length + 1);
    expect(list[list.length - 1]).toEqual({
      address: '5F',
      name: 'Infotainment',
      reqHeader: '773',
      rxFilter: '7DD',
    });
  });

  it('pickCandidateByIdent: a unique hint match wins, otherwise the first candidate', () => {
    const shared = [byAddress('08'), byAddress('46')];
    const pick = (systemName?: string, raw: Record<string, string> = {}) =>
      pickCandidateByIdent(shared, { systemName, raw }).address;
    expect(pick('Climatronic')).toBe('08');
    expect(pick('KOMFORTSYSTEM')).toBe('46');
    expect(pick(undefined, { F197: 'J393 Komfort' })).toBe('46');
    expect(pick('Unknown')).toBe('08');
    expect(pickCandidateByIdent(shared, null).address).toBe('08');
    expect(pickCandidateByIdent([byAddress('17')], { raw: {} }).address).toBe('17');
  });

  it('every known candidate has a two-digit address and 3-digit hex ids', () => {
    for (const c of VAG_UDS_HEADER_CANDIDATES) {
      expect(c.address).toMatch(/^[0-9A-F]{2}$/);
      expect(c.reqHeader).toMatch(/^[0-9A-F]{3}$/);
      expect(c.rxFilter).toMatch(/^[0-9A-F]{3}$/);
    }
  });
});
