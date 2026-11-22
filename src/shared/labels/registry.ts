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

/** The packs bundled with the app (TypeScript, reviewed in a PR). */
export const LABEL_PACKS: LabelPack[] = [vagEdc17Golf, vagBcmPq35];

/** Packs the user imported (plan 13), newest first. Plain module state so `shared/labels` stays
 *  free of zustand: `shared/state/labelPackStore` pushes its list here on hydrate and on every
 *  change. */
let userPacks: LabelPack[] = [];

/** Replace the imported packs every lookup sees (called by the label-pack store). */
export function setUserLabelPacks(packs: LabelPack[]): void {
  userPacks = [...packs];
}

/** Every pack a lookup considers: the user's imported packs first, then the bundled ones. */
export function allLabelPacks(): LabelPack[] {
  return [...userPacks, ...LABEL_PACKS];
}

/** Find the pack whose part-number prefix matches best: the longest prefix wins; on an equal
 *  length the pack listed first in `allLabelPacks()` wins, so an imported pack beats a bundled one
 *  (and the newest import beats an older one). */
export function findLabelPack(partNumber: string | undefined | null): LabelPack | null {
  return findLabelPackIn(allLabelPacks(), partNumber);
}

/** `findLabelPack` over an explicit list, in precedence order (for a React hook that re-resolves
 *  when the imported packs change). */
export function findLabelPackIn(
  packs: LabelPack[],
  partNumber: string | undefined | null,
): LabelPack | null {
  if (!partNumber) return null;
  const pn = partNumber.replace(/\s+/g, '').toUpperCase();
  let best: { pack: LabelPack; len: number } | null = null;
  for (const pack of packs) {
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
