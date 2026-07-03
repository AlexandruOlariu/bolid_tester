/** Suggest registry profiles for a VIN read live from the car (WMI/model prefixes). Purely
 *  data-driven via each profile's `vinPatterns`; longest matching prefix ranks first. */

import { VehicleProfile } from './types';

export interface VinSuggestion {
  profile: VehicleProfile;
  matchedPattern: string;
}

export function suggestProfilesForVin(
  vin: string | null | undefined,
  profiles: VehicleProfile[],
): VinSuggestion[] {
  if (!vin) return [];
  const v = vin.replace(/\s+/g, '').toUpperCase();
  if (v.length < 8) return [];
  const out: VinSuggestion[] = [];
  for (const profile of profiles) {
    for (const pattern of profile.vinPatterns ?? []) {
      const p = pattern.toUpperCase();
      if (v.startsWith(p)) {
        out.push({ profile, matchedPattern: p });
        break;
      }
    }
  }
  return out.sort((a, b) => b.matchedPattern.length - a.matchedPattern.length);
}
