/** Pure adaptation-value math: raw big-endian bytes <-> display value with scale/offset. Used by
 *  the adaptations feature (see docs/features/adaptations.md); unit-tested here so the feature
 *  layer stays thin. */

export interface AdaptationScaling {
  byteCount: number;
  /** value = rawInt * scale + offset. Defaults 1 / 0. */
  scale?: number;
  offset?: number;
  /** Interpret the raw integer as two's-complement — VAG uses signed adaptation values for e.g.
   *  idle-offset channels. Default unsigned. */
  signed?: boolean;
}

export function decodeAdaptationRaw(raw: number[], s: AdaptationScaling): number {
  let n = 0;
  for (const b of raw) n = n * 256 + (b & 0xff);
  if (s.signed) {
    const half = Math.pow(256, raw.length) / 2;
    if (n >= half) n -= half * 2;
  }
  return n * (s.scale ?? 1) + (s.offset ?? 0);
}

/** Inverse of decode; clamps to what byteCount can hold (signed or unsigned) and rounds to the
 *  nearest raw step. */
export function encodeAdaptationValue(value: number, s: AdaptationScaling): number[] {
  const scale = s.scale ?? 1;
  const offset = s.offset ?? 0;
  let n = Math.round((value - offset) / scale);
  const span = Math.pow(256, s.byteCount);
  const min = s.signed ? -span / 2 : 0;
  const max = s.signed ? span / 2 - 1 : span - 1;
  n = Math.max(min, Math.min(max, n));
  if (n < 0) n += span; // two's complement
  const out: number[] = [];
  for (let i = s.byteCount - 1; i >= 0; i--) out.push((n >> (8 * i)) & 0xff);
  return out;
}
