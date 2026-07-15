/** VCDS-style long-coding helper: pure functions that turn a coding value + its bit/byte schema
 *  (optionally enriched with label-pack names) into a byte-by-byte, per-bit breakdown for the UI,
 *  and merge label-pack coding-bit labels additively over a profile's own schema. No device I/O —
 *  the gated write path stays in udsCoding / the coding feature. See docs/features/coding.md. */

import { CodingField } from './coding';

/** A label pack's coding-bit descriptor. Kept structural (not imported from the labels module) so
 *  obd-core has no dependency on `shared/labels`; it mirrors `CodingBitLabel` there. */
export interface CodingBitDescriptor {
  byte: number;
  bit?: number;
  mask?: number;
  name: string;
}

const fieldKey = (f: { byte: number; bit?: number; mask?: number }): string =>
  `${f.byte}:${f.bit ?? 'm'}:${f.mask ?? ''}`;

/** Merge a coding module's own `schema` with label-pack bit labels **additively**: the profile
 *  schema is authoritative and wins on a conflicting field; pack labels only fill in byte/bit
 *  positions the schema does not already name. Order is stable (schema first, then new pack fields).
 *  Lets the long-coding helper show human names from a matching label pack without ever overriding
 *  the profile's own field names. */
export function mergeCodingLabels(
  schema: CodingField[],
  packBits?: CodingBitDescriptor[],
): CodingField[] {
  const seen = new Set(schema.map(fieldKey));
  const out = schema.slice();
  for (const b of packBits ?? []) {
    const k = fieldKey(b);
    if (!seen.has(k)) {
      out.push({ byte: b.byte, bit: b.bit, mask: b.mask, name: b.name });
      seen.add(k);
    }
  }
  return out;
}

export interface CodingBitView {
  /** Bit index 0–7. */
  bit: number;
  value: 0 | 1;
  /** Field name when the (merged) schema names this exact bit. */
  name?: string;
}

export interface CodingFieldView {
  name: string;
  /** Single bit this field targets, if any. */
  bit?: number;
  /** Mask this field targets, if any. */
  mask?: number;
  /** Field value: 0/1 for a bit, the masked bits for a mask, the whole byte otherwise. */
  value: number;
}

export interface CodingByteView {
  index: number;
  /** Byte value 0–255. */
  value: number;
  /** Two-char uppercase hex, e.g. '0A'. */
  hex: string;
  /** All 8 bits, most-significant first (bit 7 → bit 0), each annotated when named. */
  bits: CodingBitView[];
  /** Named fields anchored on this byte (bit, mask or whole-byte), for the labelled view. */
  fields: CodingFieldView[];
  /** True when this byte differs from `baseline` — drives the changed-byte highlight in the preview.
   *  `undefined` when no baseline was supplied. */
  changed?: boolean;
}

function fieldValue(byteValue: number, f: CodingField): number {
  if (f.bit !== undefined) return (byteValue >> f.bit) & 1;
  if (f.mask !== undefined) return byteValue & f.mask;
  return byteValue;
}

/** Build a VCDS-style byte-by-byte breakdown of a coding value. Every byte lists its 8 bits
 *  (msb first) annotated with the field name where the merged schema names that bit, plus the named
 *  bit/mask/whole-byte fields anchored on the byte. When `baseline` is given, each byte is flagged
 *  `changed` so the UI can highlight the old→new delta live as the user toggles bits. Pure. */
export function buildCodingView(
  bytes: number[],
  fields: CodingField[],
  baseline?: number[],
): CodingByteView[] {
  const len = Math.max(bytes.length, baseline?.length ?? 0);
  const out: CodingByteView[] = [];
  for (let i = 0; i < len; i++) {
    const value = bytes[i] ?? 0;
    const byteFields = fields.filter((f) => f.byte === i);
    const nameForBit = (bit: number): string | undefined =>
      byteFields.find((f) => f.bit === bit)?.name;
    const bits: CodingBitView[] = [];
    for (let b = 7; b >= 0; b--) {
      bits.push({ bit: b, value: ((value >> b) & 1) as 0 | 1, name: nameForBit(b) });
    }
    const fieldViews: CodingFieldView[] = byteFields.map((f) => ({
      name: f.name,
      bit: f.bit,
      mask: f.mask,
      value: fieldValue(value, f),
    }));
    out.push({
      index: i,
      value,
      hex: value.toString(16).padStart(2, '0').toUpperCase(),
      bits,
      fields: fieldViews,
      changed: baseline ? (baseline[i] ?? 0) !== value : undefined,
    });
  }
  return out;
}
