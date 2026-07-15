import { LabelPack, MeasurementLabel, AdaptationLabel, CodingBitLabel } from './types';
import { vagEdc17Golf } from './packs/vagEdc17Golf';
import { vagBcmPq35 } from './packs/vagBcmPq35';

export const LABEL_PACKS: LabelPack[] = [vagEdc17Golf, vagBcmPq35];

/** Find the pack whose part-number prefix matches best (longest prefix wins). */
export function findLabelPack(partNumber: string | undefined | null): LabelPack | null {
  if (!partNumber) return null;
  const pn = partNumber.replace(/\s+/g, '').toUpperCase();
  let best: { pack: LabelPack; len: number } | null = null;
  for (const pack of LABEL_PACKS) {
    for (const prefix of pack.partNumberPrefixes) {
      const p = prefix.replace(/\s+/g, '').toUpperCase();
      if (pn.startsWith(p) && (!best || p.length > best.len)) best = { pack, len: p.length };
    }
  }
  return best?.pack ?? null;
}

export function measurementLabel(pack: LabelPack | null, did: string): MeasurementLabel | null {
  return pack?.measurements?.[did.toUpperCase()] ?? pack?.measurements?.[did] ?? null;
}

export function adaptationLabel(pack: LabelPack | null, did: string): AdaptationLabel | null {
  return pack?.adaptations?.[did.toUpperCase()] ?? pack?.adaptations?.[did] ?? null;
}

/** Coding-bit labels a pack declares for a coding DID (e.g. 'F1A0'), for the long-coding helper.
 *  Empty when the pack has none — the helper still shows the profile's own schema names. */
export function codingBitLabels(pack: LabelPack | null, did: string): CodingBitLabel[] {
  return pack?.codingBits?.[did.toUpperCase()] ?? pack?.codingBits?.[did] ?? [];
}
