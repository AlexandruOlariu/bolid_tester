/** Pure byte/bit coding helpers: read a coding byte string, flip bits, decode a bit-field schema,
 *  and diff two codings for the before→after preview. No device I/O. See docs/features/coding.md. */

export interface CodingField {
  byte: number;
  /** Single bit (0–7). Omit for a whole-byte/mask field. */
  bit?: number;
  /** Mask within the byte (when not a single bit). */
  mask?: number;
  name: string;
}

export interface DecodedField {
  name: string;
  value: number;
  byte: number;
}

export function getBit(bytes: number[], byteIndex: number, bit: number): 0 | 1 {
  return ((bytes[byteIndex] ?? 0) >> bit) & 1 ? 1 : 0;
}

/** Immutably set a single bit. */
export function setBit(bytes: number[], byteIndex: number, bit: number, value: 0 | 1): number[] {
  const out = bytes.slice();
  const cur = out[byteIndex] ?? 0;
  out[byteIndex] = value ? cur | (1 << bit) : cur & ~(1 << bit);
  out[byteIndex] &= 0xff;
  return out;
}

/** Immutably set a whole byte. */
export function setByte(bytes: number[], byteIndex: number, value: number): number[] {
  const out = bytes.slice();
  out[byteIndex] = value & 0xff;
  return out;
}

export function decodeSchema(bytes: number[], schema: CodingField[]): DecodedField[] {
  return schema.map((f) => {
    let value: number;
    if (f.bit !== undefined) value = getBit(bytes, f.byte, f.bit);
    else if (f.mask !== undefined) value = (bytes[f.byte] ?? 0) & f.mask;
    else value = bytes[f.byte] ?? 0;
    return { name: f.name, value, byte: f.byte };
  });
}

export interface ByteDiff {
  index: number;
  before: number;
  after: number;
}

/** Indices where two codings differ (length-tolerant). */
export function diffCoding(before: number[], after: number[]): ByteDiff[] {
  const len = Math.max(before.length, after.length);
  const out: ByteDiff[] = [];
  for (let i = 0; i < len; i++) {
    const a = before[i] ?? 0;
    const b = after[i] ?? 0;
    if (a !== b) out.push({ index: i, before: a, after: b });
  }
  return out;
}

export function bytesToHexString(bytes: number[]): string {
  return bytes.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}
