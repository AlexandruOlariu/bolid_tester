import { decodeDtcBytes, encodeDtc, parseDtcBytes, describeDtc } from './dtc';

describe('DTC encode/decode', () => {
  it('decodes the letter and digits', () => {
    expect(decodeDtcBytes(0x01, 0x33)).toBe('P0133');
    expect(decodeDtcBytes(0x41, 0x01)).toBe('C0101');
    expect(decodeDtcBytes(0xc3, 0x00)).toBe('U0300');
    expect(decodeDtcBytes(0x00, 0x00)).toBe('');
  });

  it('encode is the inverse of decode', () => {
    for (const code of ['P0299', 'P0401', 'C0101', 'U0300', 'B1234']) {
      const [a, b] = encodeDtc(code);
      expect(decodeDtcBytes(a, b)).toBe(code);
    }
  });

  it('parses K-line style (pairs + 00 00 padding)', () => {
    expect(parseDtcBytes([0x01, 0x33, 0x02, 0x99, 0x00, 0x00])).toEqual(['P0133', 'P0299']);
  });

  it('parses CAN style (leading count byte)', () => {
    expect(parseDtcBytes([0x02, 0x01, 0x33, 0x02, 0x99])).toEqual(['P0133', 'P0299']);
  });

  it('describes known and unknown codes', () => {
    expect(describeDtc('P0299')).toMatch(/underboost/i);
    expect(describeDtc('P3FFF')).toMatch(/Powertrain/);
  });
});
