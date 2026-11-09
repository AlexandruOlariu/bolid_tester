import type { UserVehicle } from '@/shared/vehicles';
import {
  MIN_YEAR,
  draftFromVehicle,
  draftToVehicle,
  emptyDraft,
  validateDraft,
  type VehicleDraft,
} from './vehicleDraft';

const NOW = new Date(2026, 10, 9);
const draft = (over: Partial<VehicleDraft> = {}): VehicleDraft => ({
  ...emptyDraft(),
  name: 'Dacia Logan',
  ...over,
});

describe('validateDraft', () => {
  it('accepts a named car with a blank year on the generic base', () => {
    expect(validateDraft(draft(), NOW)).toEqual({});
  });

  it('requires a non-blank name', () => {
    expect(validateDraft(draft({ name: '   ' }), NOW).name).toMatch(/Give the car a name/);
  });

  it('accepts four-digit years from 1980 to next year', () => {
    expect(validateDraft(draft({ year: String(MIN_YEAR) }), NOW).year).toBeUndefined();
    expect(validateDraft(draft({ year: ' 2015 ' }), NOW).year).toBeUndefined();
    expect(validateDraft(draft({ year: '2027' }), NOW).year).toBeUndefined();
  });

  it('rejects out-of-range or malformed years', () => {
    for (const year of ['1979', '2028', '15', '20155', '2o15', '2015.0', '-2015']) {
      expect(validateDraft(draft({ year }), NOW).year).toBe(
        'Year must be between 1980 and 2027, or left blank.',
      );
    }
  });

  it('requires a registry base profile', () => {
    expect(validateDraft(draft({ baseProfileId: 'user:abc' }), NOW).baseProfileId).toBe(
      'Pick a base profile.',
    );
    expect(
      validateDraft(draft({ baseProfileId: 'golf-plus-2009-20tdi' }), NOW).baseProfileId,
    ).toBeUndefined();
  });
});

describe('draftToVehicle', () => {
  it('trims text, parses the year and drops blank notes', () => {
    expect(
      draftToVehicle(draft({ name: '  Logan  ', year: ' 2015 ', notes: '  ', fuel: 'lpg' })),
    ).toEqual({
      name: 'Logan',
      year: 2015,
      fuel: 'lpg',
      baseProfileId: 'generic',
      notes: undefined,
    });
  });

  it('leaves a blank year unknown and keeps trimmed notes', () => {
    const v = draftToVehicle(draft({ notes: ' timing belt done ' }));
    expect(v.year).toBeUndefined();
    expect(v.notes).toBe('timing belt done');
  });
});

describe('draftFromVehicle', () => {
  it('round-trips a garage record through the form', () => {
    const v: UserVehicle = {
      id: 'user:x',
      name: 'Logan',
      year: 2015,
      fuel: 'petrol',
      baseProfileId: 'generic',
      notes: 'n',
      createdAt: 1,
      updatedAt: 1,
    };
    const d = draftFromVehicle(v);
    expect(d).toEqual({
      name: 'Logan',
      year: '2015',
      fuel: 'petrol',
      baseProfileId: 'generic',
      notes: 'n',
    });
    expect(draftToVehicle(d)).toEqual({
      name: 'Logan',
      year: 2015,
      fuel: 'petrol',
      baseProfileId: 'generic',
      notes: 'n',
    });
    expect(draftFromVehicle({ ...v, year: undefined, notes: undefined })).toMatchObject({
      year: '',
      notes: '',
    });
  });
});
