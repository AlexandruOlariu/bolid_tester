import { parseHexBytes, toHex, byteToHex } from './hex';

describe('hex helpers', () => {
  it('parses hex ignoring spaces and prompt chars', () => {
    expect(parseHexBytes('41 0C 1A F8')).toEqual([0x41, 0x0c, 0x1a, 0xf8]);
    expect(parseHexBytes('>41 0C')).toEqual([0x41, 0x0c]);
  });

  it('drops a trailing odd nibble', () => {
    expect(parseHexBytes('410C0')).toEqual([0x41, 0x0c]);
  });

  it('formats bytes as uppercase hex', () => {
    expect(byteToHex(5)).toBe('05');
    expect(toHex([0x0c, 0xd0])).toBe('0CD0');
    expect(toHex([1, 2], ' ')).toBe('01 02');
  });
});
