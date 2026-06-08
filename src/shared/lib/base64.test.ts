import { bytesToBase64, base64ToBytes } from './base64';

describe('base64', () => {
  it('round-trips arbitrary byte arrays', () => {
    const cases: number[][] = [
      [],
      [0x00],
      [0x41],
      [0x41, 0x0c],
      [0x41, 0x0c, 0xd0],
      [1, 2, 3, 4, 5],
      [0x30, 0x31, 0x30, 0x43, 0x0d], // "010C\r"
    ];
    for (const arr of cases) {
      expect(base64ToBytes(bytesToBase64(arr))).toEqual(arr);
    }
  });

  it('matches known vectors', () => {
    expect(bytesToBase64([0x4d, 0x61, 0x6e])).toBe('TWFu'); // "Man"
    expect(bytesToBase64([0x41])).toBe('QQ==');
    expect(base64ToBytes('QVRaDQ==')).toEqual([0x41, 0x54, 0x5a, 0x0d]); // "ATZ\r"
  });
});
