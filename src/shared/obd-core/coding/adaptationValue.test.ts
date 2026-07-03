import { decodeAdaptationRaw, encodeAdaptationValue } from './adaptationValue';

describe('adaptation value math', () => {
  it('round-trips a 2-byte plain value', () => {
    const s = { byteCount: 2 };
    expect(decodeAdaptationRaw([0x03, 0x52], s)).toBe(850);
    expect(encodeAdaptationValue(850, s)).toEqual([0x03, 0x52]);
  });

  it('applies scale and offset', () => {
    const s = { byteCount: 1, scale: 0.5 };
    expect(decodeAdaptationRaw([0x64], s)).toBe(50);
    expect(encodeAdaptationValue(50, s)).toEqual([0x64]);
    const t = { byteCount: 1, scale: 1, offset: -40 };
    expect(decodeAdaptationRaw([0x82], t)).toBe(90);
    expect(encodeAdaptationValue(90, t)).toEqual([0x82]);
  });

  it('clamps to the byte range', () => {
    expect(encodeAdaptationValue(99999, { byteCount: 1 })).toEqual([0xff]);
    expect(encodeAdaptationValue(-5, { byteCount: 2 })).toEqual([0x00, 0x00]);
  });

  it("decodes and encodes signed (two's-complement) values", () => {
    const s = { byteCount: 1, signed: true };
    expect(decodeAdaptationRaw([0xfe], s)).toBe(-2);
    expect(encodeAdaptationValue(-2, s)).toEqual([0xfe]);
    const w = { byteCount: 2, signed: true, scale: 0.1 };
    expect(decodeAdaptationRaw([0xff, 0x9c], w)).toBeCloseTo(-10);
    expect(encodeAdaptationValue(-10, w)).toEqual([0xff, 0x9c]);
  });

  it('clamps signed values to the signed range', () => {
    const s = { byteCount: 1, signed: true };
    expect(encodeAdaptationValue(500, s)).toEqual([0x7f]);
    expect(encodeAdaptationValue(-500, s)).toEqual([0x80]);
    expect(decodeAdaptationRaw([0x7f], s)).toBe(127);
    expect(decodeAdaptationRaw([0x80], s)).toBe(-128);
  });
});
