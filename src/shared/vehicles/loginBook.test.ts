import { loginCodeFor, removeLoginCode, sanitizeLoginCodes, upsertLoginCode } from './loginBook';
import type { LoginCodeEntry } from './types';

const documented: LoginCodeEntry = {
  address: '01',
  code: 11111,
  purpose: 'Idle speed adaptation',
  source: 'owner-vcds-log',
};
const mine: LoginCodeEntry = {
  address: '01',
  code: 22222,
  purpose: 'Idle speed adaptation',
  source: 'user-entered',
};

describe('loginCodeFor', () => {
  it("prefers the user's entry over the profile's for the same address", () => {
    expect(loginCodeFor({ loginCodes: [documented] }, { loginCodes: [mine] }, '01')).toBe(mine);
  });

  it("falls back to the profile's documented code", () => {
    expect(loginCodeFor({ loginCodes: [documented] }, null, '01')).toBe(documented);
    expect(loginCodeFor({ loginCodes: [documented] }, { loginCodes: [] }, '01')).toBe(documented);
  });

  it('returns null when neither has the address', () => {
    expect(loginCodeFor({ loginCodes: [documented] }, { loginCodes: [mine] }, '17')).toBeNull();
    expect(loginCodeFor({}, undefined, '01')).toBeNull();
  });

  it('matches the address case- and space-insensitively', () => {
    const e = { ...mine, address: '0a' };
    expect(loginCodeFor({}, { loginCodes: [e] }, ' 0A ')).toBe(e);
  });
});

describe('code book edits', () => {
  it('keeps one code per module address', () => {
    const list = upsertLoginCode([documented], mine);
    expect(list).toEqual([mine]);
    expect(upsertLoginCode(list, { ...mine, address: '17' })).toHaveLength(2);
  });

  it('removes by address', () => {
    expect(removeLoginCode([mine, { ...mine, address: '17' }], '01')).toEqual([
      { ...mine, address: '17' },
    ]);
    expect(removeLoginCode(undefined, '01')).toEqual([]);
  });

  it('drops malformed entries from a persisted list', () => {
    expect(
      sanitizeLoginCodes([
        mine,
        { address: '17', code: '12345', purpose: 'x', source: 'user-entered' },
        { address: '17', code: 70000, purpose: 'x', source: 'user-entered' },
        { address: '', code: 1, purpose: 'x', source: 'user-entered' },
        { address: '46', code: 1, wsc: -1, purpose: 'x', source: 'user-entered' },
        { address: '46', code: 1, source: 'nonsense' },
        null,
      ]),
    ).toEqual([mine, { address: '46', code: 1, purpose: '', source: 'user-entered' }]);
    expect(sanitizeLoginCodes('nope')).toBeUndefined();
    expect(sanitizeLoginCodes([])).toBeUndefined();
  });
});
