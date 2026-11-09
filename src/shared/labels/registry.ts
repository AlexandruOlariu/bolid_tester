import {
  LabelPack,
  MeasurementLabel,
  AdaptationLabel,
  CodingBitLabel,
  MeasuringGroup,
  MAX_GROUP_DIDS,
} from './types';
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

/** A pack's measuring groups as `[groupNo, group]`, sorted by group number (numerically, so '75'
 *  and '075' sort alike), each group's DIDs upper-cased and capped at four. A group may name a DID
 *  the pack has no `measurements` label for — it is still returned; the UI falls back to the
 *  profile's DID name or "no definition". Empty for no pack / a pack without groups. */
export function measuringGroups(pack: LabelPack | null): [string, MeasuringGroup][] {
  const groups = pack?.measuringGroups;
  if (!groups) return [];
  const num = (k: string) => {
    const n = parseInt(k, 10);
    return Number.isNaN(n) ? Number.MAX_SAFE_INTEGER : n;
  };
  return Object.entries(groups)
    .sort(([a], [b]) => num(a) - num(b) || a.localeCompare(b))
    .map(([no, g]): [string, MeasuringGroup] => [
      no,
      { ...g, dids: g.dids.map((d) => d.toUpperCase()).slice(0, MAX_GROUP_DIDS) },
    ]);
}
