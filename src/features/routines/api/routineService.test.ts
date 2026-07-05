import { UdsError } from '@/shared/obd-core';
import type { GuidedRoutine } from '@/shared/vehicles';
import { describeRoutineFailure } from './routineService';

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

const outputTest: GuidedRoutine = { ...basicSetting, kind: 'outputTest', service: '2F', id: '0130' };

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
    expect(describeRoutineFailure(new UdsError('Negative response (NRC 0xa5)', 0xa5), basicSetting)).toBe(
      'Negative response (NRC 0xa5)',
    );
  });

  it('falls back to the raw message for a UdsError with no NRC and for a plain Error', () => {
    expect(describeRoutineFailure(new UdsError('No response'), basicSetting)).toBe('No response');
    expect(describeRoutineFailure(new Error('boom'), basicSetting)).toBe('boom');
    expect(describeRoutineFailure('weird', basicSetting)).toBe('weird');
  });
});
