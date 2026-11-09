import {
  describeLoginFailure,
  formatLoginCode,
  kwpLogin,
  kwpLoginRequest,
  parseLoginCode,
  parseWorkshopCode,
} from './kwpLogin';
import { UdsError, describeUnlockFailure, type UdsSend } from './udsCoding';

/** A fake sender that records every request and answers with `reply`. */
function fakeSend(reply: number[] | null): { send: UdsSend; sent: string[] } {
  const sent: string[] = [];
  return {
    sent,
    send: async (cmd) => {
      sent.push(cmd);
      return reply;
    },
  };
}

describe('kwpLogin', () => {
  it('sends 2B + 2-byte code + 3-byte workshop code (12345 / wsc 0 -> 2B 30 39 00 00 00)', async () => {
    const { send, sent } = fakeSend([0x6b]);
    await kwpLogin(send, 12345);
    expect(sent).toEqual(['2B303900' + '0000']);
    expect(kwpLoginRequest(12345, 0)).toBe('2B3039000000');
  });

  it('encodes the workshop code big-endian in three bytes', () => {
    expect(kwpLoginRequest(1, 99999)).toBe('2B000101869F');
  });

  it('resolves on the positive 0x6B response', async () => {
    const { send } = fakeSend([0x6b]);
    await expect(kwpLogin(send, 1)).resolves.toBeUndefined();
  });

  it('throws UdsError nrc 0x35 "Login code rejected" on 7F 2B 35', async () => {
    const { send } = fakeSend([0x7f, 0x2b, 0x35]);
    const err = await kwpLogin(send, 4321).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UdsError);
    expect((err as UdsError).nrc).toBe(0x35);
    expect((err as UdsError).message).toMatch(/Login code rejected/);
  });

  it('passes other negative responses through with their NRC', async () => {
    const { send } = fakeSend([0x7f, 0x2b, 0x36]);
    const err = await kwpLogin(send, 4321).catch((e: unknown) => e);
    expect((err as UdsError).nrc).toBe(0x36);
  });

  it('refuses out-of-range codes before sending anything', async () => {
    const { send, sent } = fakeSend([0x6b]);
    await expect(kwpLogin(send, 65536)).rejects.toThrow(/out of range/);
    await expect(kwpLogin(send, 1, 100000)).rejects.toThrow(/out of range/);
    expect(sent).toEqual([]);
  });
});

describe('login code text', () => {
  it('formats five digits zero-padded', () => {
    expect(formatLoginCode(7)).toBe('00007');
    expect(formatLoginCode(12345)).toBe('12345');
  });

  it('parses 1–5 digits within 0–65535', () => {
    expect(parseLoginCode('01234')).toBe(1234);
    expect(parseLoginCode(' 65535 ')).toBe(65535);
    expect(parseLoginCode('65536')).toBeNull();
    expect(parseLoginCode('abc')).toBeNull();
    expect(parseLoginCode('')).toBeNull();
    expect(parseLoginCode('123456')).toBeNull();
  });

  it('parses an optional workshop code', () => {
    expect(parseWorkshopCode('')).toBe(0);
    expect(parseWorkshopCode('99999')).toBe(99999);
    expect(parseWorkshopCode('1a')).toBeNull();
  });
});

describe('describeLoginFailure / describeUnlockFailure', () => {
  it('names a rejected code and a write refused for a missing login', () => {
    expect(describeLoginFailure(new UdsError('x', 0x35))).toMatch(/Login code rejected/);
    expect(describeLoginFailure(new UdsError('x', 0x33))).toMatch(/without a valid login/);
  });

  it('shares the lockout texts for 0x36 / 0x37', () => {
    const locked = new UdsError('x', 0x36);
    const delay = new UdsError('x', 0x37);
    expect(describeLoginFailure(locked)).toBe(describeUnlockFailure(locked));
    expect(describeUnlockFailure(locked)).toMatch(/locked out/);
    expect(describeUnlockFailure(delay)).toMatch(/lockout delay/);
  });

  it('returns null for anything else', () => {
    expect(describeLoginFailure(new UdsError('No response'))).toBeNull();
    expect(describeLoginFailure(new Error('boom'))).toBeNull();
    expect(describeUnlockFailure(new UdsError('x', 0x22))).toBeNull();
  });
});
