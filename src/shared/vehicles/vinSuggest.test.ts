import { suggestProfilesForVin, topVinSuggestions } from './vinSuggest';
import { VEHICLE_PROFILES } from './index';
import { generic } from './generic';
import type { VehicleProfile } from './types';

const topIds = (vin: string | null, profiles: VehicleProfile[] = VEHICLE_PROFILES) =>
  topVinSuggestions(vin, profiles).map((s) => s.profile.id);

describe('VIN -> profile suggestion', () => {
  it('matches the example cars by their VIN prefixes', () => {
    expect(suggestProfilesForVin('WVWZZZ1KZ9W903398', VEHICLE_PROFILES)[0]?.profile.id).toBe(
      'golf-plus-2009-20tdi',
    );
    expect(suggestProfilesForVin('WVWZZZ3BZ4E342958', VEHICLE_PROFILES)[0]?.profile.id).toBe(
      'passat-b55-19tdi',
    );
    expect(suggestProfilesForVin('ZFA19900000438592', VEHICLE_PROFILES)[0]?.profile.id).toBe(
      'fiat-punto-2008-12',
    );
  });

  it('returns nothing for foreign or missing VINs', () => {
    expect(suggestProfilesForVin('1HGBH41JXMN109186', VEHICLE_PROFILES)).toEqual([]);
    expect(suggestProfilesForVin(null, VEHICLE_PROFILES)).toEqual([]);
    expect(suggestProfilesForVin('WVW', VEHICLE_PROFILES)).toEqual([]);
  });
});

describe('topVinSuggestions — every profile tied for the longest match', () => {
  it('a Tiguan VIN suggests the Tiguan', () => {
    expect(topIds('WVGZZZ5NZEW000001')).toEqual(['tiguan-2014-20tdi']);
  });

  it('the Golf Plus and the Golf 6 sample VINs each get only their own profile', () => {
    // The simulator's sample VINs (SAMPLE_VINS in obd-core/transport/scenarios.ts).
    expect(topIds('WVWZZZ1KZ9W903398')).toEqual(['golf-plus-2009-20tdi']);
    expect(topIds('WVWZZZ1KZAW000001')).toEqual(['golf-6-2010-14tsi']);
  });

  it('a 1K VIN of another model year offers both, in registry order', () => {
    expect(topIds('WVWZZZ1KZCW000001')).toEqual(['golf-plus-2009-20tdi', 'golf-6-2010-14tsi']);
  });

  it('the longest matching pattern wins whatever order a profile lists its patterns in', () => {
    const shortFirst: VehicleProfile = {
      ...generic,
      id: 'short-first',
      vinPatterns: ['WVWZZZ1K', 'WVWZZZ1KZA'],
    };
    const shortOnly: VehicleProfile = { ...generic, id: 'short-only', vinPatterns: ['WVWZZZ1K'] };
    const profiles = [shortOnly, shortFirst];

    expect(suggestProfilesForVin('WVWZZZ1KZAW000001', profiles)[0]).toEqual({
      profile: shortFirst,
      matchedPattern: 'WVWZZZ1KZA',
    });
    expect(topIds('WVWZZZ1KZAW000001', profiles)).toEqual(['short-first']);
  });

  it('no match gives an empty list', () => {
    expect(topIds('1HGBH41JXMN109186')).toEqual([]);
    expect(topIds(null)).toEqual([]);
    expect(topIds('WVW')).toEqual([]);
  });
});
