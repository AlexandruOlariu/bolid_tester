import { DiagnosticSession, MockTransport, UdsError, buildScenario } from '@/shared/obd-core';
import { bytesToString } from '@/shared/lib/bytes';
import type { GuidedRoutine } from '@/shared/vehicles';
import { describeRoutineFailure, startRoutine } from './routineService';

const basicSetting: GuidedRoutine = {
  module: 'Engine',
  reqHeader: '7E0',
  rxFilter: '7E8',
  kind: 'basicSetting',
  service: '31',
  id: '0301',
  name: 'Intake flap adaptation',
  description: '',
  interlocks: {},
  experimental: true,
};

const outputTest: GuidedRoutine = {
  ...basicSetting,
  kind: 'outputTest',
  service: '2F',
  id: '0130',
};

const nrc = (code: number) => new UdsError('raw', code);

describe('describeRoutineFailure', () => {
  it('explains securityAccessDenied (0x33) as an unlock the app does not carry', () => {
    const msg = describeRoutineFailure(nrc(0x33), basicSetting);
    expect(msg).toMatch(/security access/i);
    expect(msg).toContain('basic setting');
  });

  it('uses the "output test" wording for a 2F routine', () => {
    expect(describeRoutineFailure(nrc(0x33), outputTest)).toContain('output test');
  });

  it.each([
    ['serviceNotSupported (0x11)', 0x11],
    ['subFunctionNotSupported (0x12)', 0x12],
    ['requestOutOfRange (0x31)', 0x31],
    ['subFunctionNotSupportedInActiveSession (0x7e)', 0x7e],
    ['serviceNotSupportedInActiveSession (0x7f)', 0x7f],
  ])('flags %s as an unverified routine ID', (_label, code) => {
    const msg = describeRoutineFailure(nrc(code as number), basicSetting);
    expect(msg).toMatch(/unverified/i);
    expect(msg).toContain(basicSetting.id);
  });

  it('maps conditionsNotCorrect (0x22) to warm-up / idle advice', () => {
    const msg = describeRoutineFailure(nrc(0x22), basicSetting);
    expect(msg).toMatch(/conditions are not correct/i);
    expect(msg).toMatch(/idle/i);
  });

  it('distinguishes requestSequenceError (0x24) from conditionsNotCorrect', () => {
    const msg = describeRoutineFailure(nrc(0x24), basicSetting);
    expect(msg).toMatch(/out of sequence/i);
    expect(msg).not.toMatch(/operating temperature/i); // not the 0x22 advice
  });

  it.each([
    ['invalidKey (0x35)', 0x35, /invalid key/i],
    ['exceedNumberOfAttempts (0x36)', 0x36, /locked out|too many/i],
    ['requiredTimeDelayNotExpired (0x37)', 0x37, /lockout delay/i],
  ])('gives lockout guidance for %s', (_label, code, re) => {
    expect(describeRoutineFailure(nrc(code as number), basicSetting)).toMatch(re as RegExp);
  });

  it('falls back to the raw message for an unknown NRC', () => {
    expect(
      describeRoutineFailure(new UdsError('Negative response (NRC 0xa5)', 0xa5), basicSetting),
    ).toBe('Negative response (NRC 0xa5)');
  });

  it('falls back to the raw message for a UdsError with no NRC and for a plain Error', () => {
    expect(describeRoutineFailure(new UdsError('No response'), basicSetting)).toBe('No response');
    expect(describeRoutineFailure(new Error('boom'), basicSetting)).toBe('boom');
    expect(describeRoutineFailure('weird', basicSetting)).toBe('weird');
  });
});

describe('startRoutine with SecurityAccess (plan 23, simulated Golf engine)', () => {
  // A deliberately trivial TEST VECTOR (seed XOR 0xFFFF), defined only in tests — not a routine.
  const toyKey = (seed: number[]) => [seed[0] ^ 0xff, seed[1] ^ 0xff];
  const secured: GuidedRoutine = { ...basicSetting, security: { level: 0x03 } };

  async function securedEngine() {
    const mock = new MockTransport(
      buildScenario('golf-plus-2009-20tdi', {
        security: {
          '7E0': { level: 0x03, seed: [0x12, 0x34], key: [0xed, 0xcb], protects: ['31'] },
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

  it('without a plugin the routine is attempted unlocked and the module answers NRC 0x33', async () => {
    const { session, sent } = await securedEngine();
    const err = await startRoutine(session, secured).catch((e: unknown) => e);
    expect((err as UdsError).nrc).toBe(0x33);
    expect(sent.some((c) => c.startsWith('27'))).toBe(false);
    expect(describeRoutineFailure(err, secured)).toMatch(/security-access plugin/);
  });

  it('with a plugin routine the module is unlocked first and the routine starts', async () => {
    const { session, sent } = await securedEngine();
    await startRoutine(session, secured, { seedToKey: toyKey });
    expect(sent).toEqual(expect.arrayContaining(['1003', '2703', '2704edcb', '31010301']));
  });
});
