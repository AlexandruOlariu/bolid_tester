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

  it('decodes multiple monitors without stride corruption (9-byte records)', () => {
    // Two back-to-back 9-byte records. With the old 7-byte stride, record 2 read the previous
    // record's max bytes as its MID/TID and every field was garbage.
    const bytes = [
      0x46,
      0x01, 0x0b, 0x01, 0x00, 0x40, 0x00, 0x00, 0x00, 0xff, // MID 01 (count): val 64
      0x21, 0x85, 0x09, 0x10, 0x00, 0x08, 0x00, 0x20, 0x00, // MID 21 (rpm):  val 4096
    ];
    const r = decodeMode06(bytes);
    expect(r).toHaveLength(2);
    expect(r[0].mid).toBe(0x01);
    expect(r[0].value).toBe(64);
    expect(r[1].mid).toBe(0x21);
    expect(r[1].tid).toBe(0x85);
    expect(r[1].value).toBe(4096);
  });

  it('returns empty for a non-46 / short response', () => {
    expect(decodeMode06([0x7f, 0x06, 0x12])).toEqual([]);
    expect(decodeMode06([])).toEqual([]);
  });
});
