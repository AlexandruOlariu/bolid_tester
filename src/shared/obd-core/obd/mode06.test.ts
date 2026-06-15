import { decodeMode06 } from './mode06';

describe('decodeMode06', () => {
  it('decodes a passing test group with scaling', () => {
    // 46 | MID=01 TID=0B UASID=01(count) val=0x0040(64) min=0x0000 max=0x00FF(255)
    const bytes = [0x46, 0x01, 0x0b, 0x01, 0x00, 0x40, 0x00, 0x00, 0x00, 0xff];
    const r = decodeMode06(bytes);
    expect(r).toHaveLength(1);
    expect(r[0].mid).toBe(1);
    expect(r[0].value).toBe(64);
    expect(r[0].max).toBe(255);
    expect(r[0].pass).toBe(true);
  });

  it('flags a failing test (value above max)', () => {
    const bytes = [0x46, 0x02, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x80];
    expect(decodeMode06(bytes)[0].pass).toBe(false);
  });

  it('returns empty for a non-46 / short response', () => {
    expect(decodeMode06([0x7f, 0x06, 0x12])).toEqual([]);
    expect(decodeMode06([])).toEqual([]);
  });
});
