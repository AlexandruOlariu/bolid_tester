import { decodeDtcBytes, encodeDtc, parseDtcBytes, describeDtc, vagCodeForDtc } from './dtc';

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

  it('describes the real Golf engine faults', () => {
    expect(describeDtc('P2183')).toMatch(/coolant temperature/i);
    expect(describeDtc('P2015')).toMatch(/intake manifold/i);
    expect(describeDtc('P0121')).toMatch(/throttle/i);
  });

  it('maps a generic P-code to its VAG 5-digit code (shared DTC bytes)', () => {
    // Verified against a real Car Scanner OBD2 export of a VW Golf: same hex for both forms.
    expect(vagCodeForDtc('P2183')).toBe('08579'); // 0x2183 = 8579
    expect(vagCodeForDtc('P2015')).toBe('08213'); // 0x2015 = 8213
    expect(vagCodeForDtc('P0121')).toBe('00289'); // 0x0121 = 289
    expect(vagCodeForDtc('')).toBe('');
    // Non-powertrain (C/B/U) codes are not VAG-mapped here — must not return a bogus number.
    expect(vagCodeForDtc('U0100')).toBe('');
    expect(vagCodeForDtc('C0101')).toBe('');
    // The relationship is exactly: VAG decimal === the DTC's two raw bytes.
    for (const code of ['P2183', 'P2015', 'P0121']) {
      const [b0, b1] = encodeDtc(code);
      expect(parseInt(vagCodeForDtc(code), 10)).toBe((b0 << 8) | b1);
    }
  });
});
