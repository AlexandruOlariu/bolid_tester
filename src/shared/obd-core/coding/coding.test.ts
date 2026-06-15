import { getBit, setBit, setByte, decodeSchema, diffCoding, bytesToHexString } from './coding';

describe('coding byte/bit helpers', () => {
  it('reads and sets single bits immutably', () => {
    const bytes = [0b0000_0001, 0x00];
    expect(getBit(bytes, 0, 0)).toBe(1);
    expect(getBit(bytes, 0, 1)).toBe(0);
    const next = setBit(bytes, 0, 1, 1);
    expect(next[0]).toBe(0b0000_0011);
    expect(bytes[0]).toBe(0b0000_0001); // original untouched
    expect(setBit(next, 0, 0, 0)[0]).toBe(0b0000_0010);
  });

  it('sets whole bytes with masking to 0xFF', () => {
    expect(setByte([0, 0], 1, 0x1ff)[1]).toBe(0xff);
  });

  it('decodes a bit-field schema', () => {
    const decoded = decodeSchema([0b0000_0101, 0x42], [
      { byte: 0, bit: 0, name: 'a' },
      { byte: 0, bit: 1, name: 'b' },
      { byte: 1, name: 'c' },
    ]);
    expect(decoded).toEqual([
      { name: 'a', value: 1, byte: 0 },
      { name: 'b', value: 0, byte: 0 },
      { name: 'c', value: 0x42, byte: 1 },
    ]);
  });

  it('diffs two codings', () => {
    expect(diffCoding([1, 2, 3], [1, 9, 3])).toEqual([{ index: 1, before: 2, after: 9 }]);
    expect(bytesToHexString([0x0a, 0xff])).toBe('0A FF');
  });
});
