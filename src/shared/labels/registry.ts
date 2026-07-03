import { LabelPack, MeasurementLabel, AdaptationLabel } from './types';
import { vagEdc17Golf } from './packs/vagEdc17Golf';

export const LABEL_PACKS: LabelPack[] = [vagEdc17Golf];

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
