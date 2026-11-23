/** Suggest registry profiles for a VIN read live from the car (WMI/model prefixes). Purely
 *  data-driven via each profile's `vinPatterns`; longest matching prefix ranks first. */

import { VehicleProfile } from './types';

export interface VinSuggestion {
  profile: VehicleProfile;
  matchedPattern: string;
}

/** Every profile with a pattern the VIN starts with, longest match first. Per profile the longest
 *  matching pattern counts, whatever order the profile lists its patterns in. */
export function suggestProfilesForVin(
  vin: string | null | undefined,
  profiles: VehicleProfile[],
): VinSuggestion[] {
  if (!vin) return [];
  const v = vin.replace(/\s+/g, '').toUpperCase();
  if (v.length < 8) return [];
  const out: VinSuggestion[] = [];
  for (const profile of profiles) {
    let best: string | null = null;
    for (const pattern of profile.vinPatterns ?? []) {
      const p = pattern.toUpperCase();
      if (v.startsWith(p) && p.length > (best?.length ?? 0)) best = p;
    }
    if (best) out.push({ profile, matchedPattern: best });
  }
  return out.sort((a, b) => b.matchedPattern.length - a.matchedPattern.length);
}

/** The suggestions tied for the longest match (in `profiles` order); empty when nothing matches.
 *  Several profiles can share a VIN prefix (the Golf Plus and the Golf 6 are both `WVWZZZ1K…`), and
 *  when the VIN alone cannot tell them apart every candidate is offered. */
export function topVinSuggestions(
  vin: string | null | undefined,
  profiles: VehicleProfile[],
): VinSuggestion[] {
  const all = suggestProfilesForVin(vin, profiles);
  const longest = all[0]?.matchedPattern.length ?? 0;
  return all.filter((s) => s.matchedPattern.length === longest);
}
