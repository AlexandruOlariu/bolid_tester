import {
  adaptationBoundsError,
  decodeAdaptationRaw,
  encodeAdaptationValue,
} from './adaptationValue';

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

describe('adaptationBoundsError (the shared write guard)', () => {
  // Shaped like the Golf's idle-speed-offset channel 3001: 2 bytes, 750–950 rpm.
  const idle = { byteCount: 2, min: 750, max: 950, unit: 'rpm' };

  it('accepts a value inside the bounds, including the edges', () => {
    expect(adaptationBoundsError(idle, [0x03, 0x52])).toBeNull(); // 850
    expect(adaptationBoundsError(idle, [0x02, 0xee])).toBeNull(); // 750
    expect(adaptationBoundsError(idle, [0x03, 0xb6])).toBeNull(); // 950
  });

  it('refuses a value below the minimum', () => {
    expect(adaptationBoundsError(idle, [0x02, 0xed])).toBe(
      'Value 749 rpm is below the channel minimum (750).',
    );
  });

  it('refuses a value above the maximum', () => {
    expect(adaptationBoundsError(idle, [0x04, 0x00])).toBe(
      'Value 1024 rpm is above the channel maximum (950).',
    );
  });

  it('applies scaling before comparing', () => {
    const egr = { byteCount: 1, scale: 0.5, min: 0, max: 100, unit: '%' };
    expect(adaptationBoundsError(egr, [0xc8])).toBeNull(); // 100 %
    expect(adaptationBoundsError(egr, [0xca])).toBe(
      'Value 101 % is above the channel maximum (100).',
    );
  });

  it('accepts anything of the right width when the channel has no bounds', () => {
    expect(adaptationBoundsError({ byteCount: 1 }, [0xff])).toBeNull();
    expect(adaptationBoundsError({ byteCount: 2 }, [0x00, 0x00])).toBeNull();
  });

  it('refuses raw bytes of the wrong width, bounded or not', () => {
    expect(adaptationBoundsError(idle, [0x52])).toBe('Value has 1 byte; this channel takes 2.');
    expect(adaptationBoundsError({ byteCount: 1 }, [0x00, 0x01])).toBe(
      'Value has 2 bytes; this channel takes 1.',
    );
  });

  it("decodes a signed channel as two's complement", () => {
    const offset = { byteCount: 1, signed: true, min: -10, max: 10 };
    expect(adaptationBoundsError(offset, [0xfe])).toBeNull(); // -2
    expect(adaptationBoundsError(offset, [0xf0])).toBe(
      'Value -16 is below the channel minimum (-10).',
    );
    // Unsigned, the same byte would be 240 — above the max, not below the min.
    expect(adaptationBoundsError({ ...offset, signed: false }, [0xf0])).toBe(
      'Value 240 is above the channel maximum (10).',
    );
  });
});
