import { suggestProfilesForVin } from './vinSuggest';
import { VEHICLE_PROFILES } from './index';

describe('VIN -> profile suggestion', () => {
  it('matches the example cars by their VIN prefixes', () => {
    expect(
      suggestProfilesForVin('WVWZZZ1KZ9W903398', VEHICLE_PROFILES)[0]?.profile.id,
    ).toBe('golf-plus-2009-20tdi');
    expect(
      suggestProfilesForVin('WVWZZZ3BZ4E342958', VEHICLE_PROFILES)[0]?.profile.id,
    ).toBe('passat-b55-19tdi');
    expect(
      suggestProfilesForVin('ZFA19900000438592', VEHICLE_PROFILES)[0]?.profile.id,
    ).toBe('fiat-punto-2008-12');
  });

  it('returns nothing for foreign or missing VINs', () => {
    expect(suggestProfilesForVin('1HGBH41JXMN109186', VEHICLE_PROFILES)).toEqual([]);
    expect(suggestProfilesForVin(null, VEHICLE_PROFILES)).toEqual([]);
    expect(suggestProfilesForVin('WVW', VEHICLE_PROFILES)).toEqual([]);
  });
});
