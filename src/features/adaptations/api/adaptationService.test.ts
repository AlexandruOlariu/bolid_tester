/** KWP adaptation writes (plan 22) end to end against the simulated Passat: `writeChannel` through
 *  a real `DiagnosticSession` over `MockTransport`, with a logging wrapper that records every
 *  command so "refused before any bus traffic" is checked on the wire. The scenario pins its own
 *  login code (`kwpLogins` override) — no real code is involved. */
import { DiagnosticSession } from '@/shared/obd-core/session/DiagnosticSession';
import { MockTransport } from '@/shared/obd-core/transport/MockTransport';
import { buildScenario } from '@/shared/obd-core/transport/scenarios';
import { bytesToString } from '@/shared/lib/bytes';
import { getVehicleProfile, type AdaptationChannel } from '@/shared/vehicles';
import { ModuleNotAllowedError, createReadOnlySession } from '@/shared/obd-core';
import { readChannel, readChannelReadOnly, writeChannel } from './adaptationService';

const HEADER = '8101F1';
const CODE = 24680;

const passat = getVehicleProfile('passat-b55-19tdi');
const idle = (passat.adaptations ?? []).find((c) => c.did === '2A') as AdaptationChannel;

/** A connected Passat session plus the list of commands sent after `mark()`. */
async function passatSession() {
  const mock = new MockTransport(
    buildScenario('passat-b55-19tdi', { kwpLogins: { [HEADER]: { code: CODE } } }),
  );
  const sent: string[] = [];
  const write = mock.write.bind(mock);
  mock.write = async (bytes: Uint8Array) => {
    sent.push(bytesToString(bytes).trim());
    return write(bytes);
  };
  const session = new DiagnosticSession(mock);
  await session.connect();
  return {
    session,
    mock,
    sent,
    /** Forget what connect() sent. */
    mark: () => sent.splice(0),
  };
}

describe('writeChannel over KWP (simulated Passat)', () => {
  it('declares the illustrative engine channel as a login-gated KWP channel', () => {
    expect(idle).toMatchObject({ transport: 'kwp', login: true, address: '01', reqHeader: HEADER });
  });

  it('reads the channel through 10 85 + 21', async () => {
    const { session, sent, mark } = await passatSession();
    mark();
    expect(await readChannel(session, idle)).toEqual([0x55]);
    expect(sent).toEqual(expect.arrayContaining(['ATSH' + HEADER, '1085', '212A']));
    mark();
    // A cached session skips the 10 85.
    expect(await readChannel(session, idle, { sessionOpen: true })).toEqual([0x55]);
    expect(sent).not.toContain('1085');
  });

  it('without a login: ok false, "Login required", nothing on the bus', async () => {
    const { session, sent, mark } = await passatSession();
    mark();
    const res = await writeChannel(session, idle, [0x5a]);
    expect(res).toMatchObject({ ok: false, loginRequired: true });
    expect(res.message).toMatch(/Login required/);
    expect(sent).toEqual([]);
  });

  it('out of bounds: refused before any traffic, even with a login', async () => {
    const { session, sent, mark } = await passatSession();
    mark();
    const res = await writeChannel(session, idle, [0xc8], { login: { code: CODE } }); // 2000 rpm
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/maximum|above/i);
    expect(res.loginAccepted).toBeUndefined();
    expect(sent).toEqual([]);
  });

  it('with the right code: session, login, backup, write, verify', async () => {
    const { session, sent, mark } = await passatSession();
    mark();
    const res = await writeChannel(session, idle, [0x5a], { login: { code: CODE } });
    expect(res).toEqual({
      ok: true,
      backup: [0x55],
      message: 'Write verified.',
      loginAccepted: true,
    });
    const kwp = sent.map((c) => c.toUpperCase()).filter((c) => /^(10|2B|21|3B)/.test(c));
    expect(kwp).toEqual(['1085', '2B' + '606800' + '0000', '212A', '3B2A5A', '212A']);
    // Default addressing restored afterwards.
    expect(sent[sent.length - 1]).toBe('ATSH686AF1');
    expect(await readChannel(session, idle)).toEqual([0x5a]);
  });

  it('with a wrong code: "rejected", nothing written', async () => {
    const { session, sent, mark } = await passatSession();
    mark();
    const res = await writeChannel(session, idle, [0x5a], { login: { code: 11111 } });
    expect(res.ok).toBe(false);
    expect(res.loginRejected).toBe(true);
    expect(res.loginAccepted).toBeUndefined();
    expect(res.message).toMatch(/rejected/);
    expect(sent.some((c) => c.startsWith('3B'))).toBe(false);
    expect(await readChannel(session, idle)).toEqual([0x55]);
  });

  it('a login the module refuses for another reason (7F 2B 11) is not reported accepted', async () => {
    const { session, mock, sent, mark } = await passatSession();
    mock.scenario.kwpLogins = {};
    mark();
    const res = await writeChannel(session, idle, [0x5a], { login: { code: CODE } });
    expect(res.ok).toBe(false);
    expect(res.loginAccepted).toBeUndefined();
    expect(res.loginRejected).toBeUndefined();
    expect(sent.some((c) => c.startsWith('3B'))).toBe(false);
  });

  it('a session start that fails before the login is not reported accepted', async () => {
    const { session, mock } = await passatSession();
    const write = mock.write.bind(mock);
    mock.write = async (bytes: Uint8Array) => {
      if (bytesToString(bytes).trim().startsWith('1085')) throw new Error('Link lost');
      return write(bytes);
    };
    const res = await writeChannel(session, idle, [0x5a], { login: { code: CODE } });
    expect(res.ok).toBe(false);
    expect(res.loginAccepted).toBeUndefined();
    expect(res.loginRejected).toBeUndefined();
  });

  it('logs in again after the module restarted its session (10 85)', async () => {
    const { session } = await passatSession();
    expect((await writeChannel(session, idle, [0x5a], { login: { code: CODE } })).ok).toBe(true);
    // Something else restarts the session — the login is gone on the module side.
    expect(await session.send('1085')).toEqual([0x50, 0x85]);
    const again = await writeChannel(session, idle, [0x50], { login: { code: CODE } });
    expect(again).toMatchObject({ ok: true, backup: [0x5a] });
  });

  it('UDS channels on the Golf are unchanged (no login, no KWP traffic)', async () => {
    const golf = getVehicleProfile('golf-plus-2009-20tdi');
    const ch = (golf.adaptations ?? []).find((c) => c.did === '3001') as AdaptationChannel;
    const mock = new MockTransport(buildScenario('golf-plus-2009-20tdi'));
    const session = new DiagnosticSession(mock);
    await session.connect();
    const res = await writeChannel(session, ch, [0x03, 0x84]);
    expect(res).toMatchObject({ ok: true, backup: [0x03, 0x52] });
    expect(res.loginRequired).toBeUndefined();
  });
});

describe('writeChannel with SecurityAccess (plan 23, simulated Golf)', () => {
  // A deliberately trivial TEST VECTOR (seed XOR 0xFFFF), defined only in tests — not a routine.
  const toyKey = (seed: number[]) => [seed[0] ^ 0xff, seed[1] ^ 0xff];
  const golf = getVehicleProfile('golf-plus-2009-20tdi');
  const base = (golf.adaptations ?? []).find((c) => c.did === '3001') as AdaptationChannel;
  const secured: AdaptationChannel = { ...base, security: { level: 0x03 } };

  async function securedGolf() {
    const mock = new MockTransport(
      buildScenario('golf-plus-2009-20tdi', {
        security: {
          '7E0': { level: 0x03, seed: [0x12, 0x34], key: [0xed, 0xcb], protects: ['2E'] },
        },
      }),
    );
    const sent: string[] = [];
    const write = mock.write.bind(mock);
    mock.write = async (bytes: Uint8Array) => {
      sent.push(bytesToString(bytes).trim());
      return write(bytes);
    };
    const session = new DiagnosticSession(mock);
    await session.connect();
    sent.splice(0);
    return { session, sent };
  }

  it('refuses a security channel without a plugin routine before any bus traffic', async () => {
    const { session, sent } = await securedGolf();
    const res = await writeChannel(session, secured, [0x03, 0x84]);
    expect(res).toMatchObject({ ok: false, securityLocked: true });
    expect(res.message).toMatch(/no plugin is installed/);
    expect(sent).toEqual([]);
  });

  it('unlocks with the supplied routine, writes and verifies', async () => {
    const { session, sent } = await securedGolf();
    const res = await writeChannel(session, secured, [0x03, 0x84], { seedToKey: toyKey });
    expect(res).toMatchObject({ ok: true, backup: [0x03, 0x52] });
    expect(sent).toEqual(expect.arrayContaining(['1003', '2703', '2704edcb', '2E30010384']));
  });

  it('a channel without security never sends 27, even with a routine supplied', async () => {
    const { session, sent } = await securedGolf();
    // The module protects 2E, so the unlocked write is refused by the module — not by the app.
    const res = await writeChannel(session, base, [0x03, 0x84], { seedToKey: toyKey });
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/securityAccessDenied/);
    expect(sent.some((c) => c.startsWith('27'))).toBe(false);
  });
});

describe('readChannelReadOnly (AI agent, read-only facade)', () => {
  // Passat KWP scenario: the read path never sends a write or a login.
  it('readChannelReadOnly reads a KWP channel without any session change, write or login', async () => {
    const { session, sent, mark } = await passatSession();
    mark();
    const raw = await readChannelReadOnly(createReadOnlySession(session), idle);
    expect(raw).not.toBeNull();
    expect(sent.filter((c) => /^(2B|3B|27|2E)/i.test(c))).toEqual([]);
    expect(sent.filter((c) => c.startsWith('10'))).toEqual([]);
  });

  it('addresses the KWP module with no receive filter, reads 21 and restores addressing', async () => {
    const { session, sent, mark } = await passatSession();
    mark();
    expect(await readChannelReadOnly(createReadOnlySession(session), idle)).toEqual([0x55]);
    expect(sent).toEqual(expect.arrayContaining(['ATSH' + HEADER, '212A']));
    expect(sent.some((c) => c.startsWith('ATCRA'))).toBe(false);
    expect(sent[sent.length - 1]).toBe('ATSH686AF1');
  });

  it('a channel the module does not answer outside its session reads as null', async () => {
    const { session, mock } = await passatSession();
    mock.scenario.kwpLocals = {};
    expect(await readChannelReadOnly(createReadOnlySession(session), idle)).toBeNull();
  });

  it('reads a UDS channel on the Golf through 22 on its own header and filter', async () => {
    const golf = getVehicleProfile('golf-plus-2009-20tdi');
    const ch = (golf.adaptations ?? []).find((c) => c.did === '3001') as AdaptationChannel;
    const mock = new MockTransport(buildScenario('golf-plus-2009-20tdi'));
    const sent: string[] = [];
    const write = mock.write.bind(mock);
    mock.write = async (bytes: Uint8Array) => {
      sent.push(bytesToString(bytes).trim());
      return write(bytes);
    };
    const session = new DiagnosticSession(mock);
    await session.connect();
    sent.splice(0);
    expect(await readChannelReadOnly(createReadOnlySession(session), ch)).toEqual([0x03, 0x52]);
    expect(sent).toEqual(expect.arrayContaining(['ATSH7E0', 'ATCRA7E8', '223001']));
    expect(sent.filter((c) => /^(10|2E|27)/i.test(c))).toEqual([]);
  });

  it('refuses a channel on an excluded module (immobilizer 25) before any traffic', async () => {
    const { session, sent, mark } = await passatSession();
    mark();
    const immo: AdaptationChannel = { ...idle, address: '25' };
    await expect(readChannelReadOnly(createReadOnlySession(session), immo)).rejects.toBeInstanceOf(
      ModuleNotAllowedError,
    );
    expect(sent).toEqual([]);
  });
});
