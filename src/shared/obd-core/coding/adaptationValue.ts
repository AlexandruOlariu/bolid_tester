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

/** The part of a channel the write guard needs: scaling plus the display bounds. A profile's
 *  `AdaptationChannel` satisfies it structurally. */
export interface AdaptationBounds extends AdaptationScaling {
  min?: number;
  max?: number;
  unit?: string;
}

/** The single bounds guard every adaptation write passes through (the Adaptations screen, the
 *  backup restore, any future path). Non-null = a plain-English refusal: the raw bytes are not the
 *  channel's width, or they decode outside its min/max. Never clamps — the caller refuses. */
export function adaptationBoundsError(ch: AdaptationBounds, raw: number[]): string | null {
  if (raw.length !== ch.byteCount) {
    return `Value has ${raw.length} byte${raw.length === 1 ? '' : 's'}; this channel takes ${ch.byteCount}.`;
  }
  if (ch.min === undefined && ch.max === undefined) return null;
  const value = decodeAdaptationRaw(raw, ch);
  const shown = `${value}${ch.unit ? ' ' + ch.unit : ''}`;
  if (ch.min !== undefined && value < ch.min) {
    return `Value ${shown} is below the channel minimum (${ch.min}).`;
  }
  if (ch.max !== undefined && value > ch.max) {
    return `Value ${shown} is above the channel maximum (${ch.max}).`;
  }
  return null;
}
