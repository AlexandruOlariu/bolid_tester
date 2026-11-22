import * as fs from 'fs';
import * as path from 'path';
import { LABEL_PACKS } from '../../labels/registry';
import { vagEdc17Golf } from '../../labels/packs/vagEdc17Golf';
import type { LabelPack } from '../../labels/types';
import { getVehicleProfile } from '../../vehicles';
import { buildUserProfile, type UserVehicle } from '../../vehicles/userVehicle';
import {
  MAX_EXCHANGE_BYTES,
  isParseError,
  keepBothName,
  keepBothPackId,
  overlapText,
  parseExchangeFile,
  planEmbeddedPacks,
  planLabelPackImport,
  planProfileImport,
  vehicleFromProfile,
  type ParsedExchange,
} from './import';
import {
  exchangeFileName,
  exportLabelPack,
  exportVehicle,
  packsForPartNumbers,
  profilePartNumbers,
  serializeExchange,
  slug,
} from './export';
import { profileFileV1 } from './schemas';
import { validate } from '../validate';
import type { LabelPackV1, ProfileFileV1 } from './types';

const EXAMPLES = path.resolve(__dirname, '../../../../docs/examples');
const readExample = (name: string) => fs.readFileSync(path.join(EXAMPLES, name), 'utf8');
const META = { appVersion: '0.1.0', now: Date.UTC(2026, 10, 9, 10) };

const GOLF_CAR: UserVehicle = {
  id: 'user:abc',
  name: 'Volkswagen 2009',
  year: 2009,
  fuel: 'diesel',
  make: 'vag',
  baseProfileId: 'golf-plus-2009-20tdi',
  learned: {
    protocol: 'ISO_15765_4_CAN_11_500',
    supportedPids: ['0104', '010C', '010D'],
    vin: 'WVWZZZ1KZ9W903398',
    calibrationId: '03L906022LM 4023',
    adapterVersion: 'ELM327 v1.5',
    learnedAt: 1_700_000_000_000,
  },
  notes: 'Bought 2021',
  loginCodes: [{ address: '01', code: 12345, purpose: 'Idle', source: 'user-entered' }],
  modules: [
    {
      address: '03',
      name: 'ABS',
      transport: 'uds',
      reqHeader: '713',
      rxFilter: '77D',
      experimental: true,
    },
  ],
  createdAt: 1,
  updatedAt: 2,
};

const profileOf = (r: ParsedExchange | ReturnType<typeof parseExchangeFile>): ProfileFileV1 => {
  if (isParseError(r) || r.kind !== 'profile') throw new Error('not a profile');
  return r.file;
};
const packOf = (r: ReturnType<typeof parseExchangeFile>): LabelPackV1 => {
  if (isParseError(r) || r.kind !== 'labelpack') throw new Error('not a pack');
  return r.file.payload;
};

describe('parseExchangeFile', () => {
  it('reads both example files', () => {
    expect(
      profileOf(parseExchangeFile(readExample('profile.example.json'))).payload.vehicle.name,
    ).toBe('VW Golf Plus 2009 2.0 TDI 81 kW');
    expect(packOf(parseExchangeFile(readExample('label-pack.example.json'))).id).toBe(
      'example-edc17-03L906022',
    );
  });

  it('accepts a leading byte-order mark', () => {
    expect(isParseError(parseExchangeFile(`\uFEFF${readExample('profile.example.json')}`))).toBe(
      false,
    );
  });

  it('refuses non-JSON, non-exchange, garage and oversize files with a reason', () => {
    const notJson = parseExchangeFile('{ nope');
    expect(isParseError(notJson) && notJson.error).toBe('This file is not valid JSON.');
    const other = parseExchangeFile('{"hello": 1}');
    expect(isParseError(other) && other.error).toMatch(/not a bolid-tester profile/);
    const list = parseExchangeFile('[1, 2]');
    expect(isParseError(list)).toBe(true);
    const garage = parseExchangeFile('{"kind": "bolid.garage", "vehicles": []}');
    expect(isParseError(garage) && garage.error).toMatch(/whole-garage export/);
    const unknown = parseExchangeFile('{"schema": "acme.v1"}');
    expect(isParseError(unknown) && unknown.error).toMatch(/Unknown file format/);
    const big = parseExchangeFile(
      `{"schema":"bolid.profile.v1","x":"${'a'.repeat(MAX_EXCHANGE_BYTES)}"}`,
    );
    expect(isParseError(big) && big.error).toMatch(/too large/);
  });

  it('returns every validator error for a corrupted file (the sheet shows three)', () => {
    const raw = JSON.parse(readExample('profile.example.json')) as {
      payload: { vehicle: Record<string, unknown> };
    };
    raw.payload.vehicle.fuel = 'coal';
    raw.payload.vehicle.year = 'old';
    raw.payload.vehicle.name = '';
    raw.payload.vehicle.baseProfileId = 'Not An Id';
    const r = parseExchangeFile(JSON.stringify(raw));
    expect(isParseError(r)).toBe(true);
    if (isParseError(r)) {
      expect(r.error).toBe('This profile file is not valid.');
      expect(r.details).toEqual([
        '/payload/vehicle/name: must not be empty',
        '/payload/vehicle/year: expected a number, got "old"',
        '/payload/vehicle/fuel: expected one of diesel|petrol|lpg|hybrid|other, got "coal"',
        '/payload/vehicle/baseProfileId: expected a built-in profile id such as "golf-plus-2009-20tdi", got "Not An Id"',
      ]);
    }
  });

  it('a garage car round-trips: export → file → import fields equal the car (minus login codes)', () => {
    const file = exportVehicle(GOLF_CAR, [], META);
    const parsed = profileOf(parseExchangeFile(serializeExchange(file)));
    expect(parsed).toEqual(file);
    const fields = vehicleFromProfile(parsed.payload.vehicle, () => true);
    const { id: _id, createdAt: _c, updatedAt: _u, loginCodes: _codes, ...expected } = GOLF_CAR;
    expect(fields).toEqual(expected);
    expect(JSON.stringify(file)).not.toContain('12345');
    expect(file.payload.vehicle.sourceId).toBe('user:abc');
  });

  it('an unknown base profile falls back to generic', () => {
    const file = exportVehicle({ ...GOLF_CAR, baseProfileId: 'future-car-2030' }, [], META);
    const fields = vehicleFromProfile(file.payload.vehicle, (id) => id === 'golf-plus-2009-20tdi');
    expect(fields.baseProfileId).toBe('generic');
  });
});

describe('planProfileImport', () => {
  const file = exportVehicle(GOLF_CAR, [], META);
  const other: UserVehicle = { ...GOLF_CAR, id: 'user:other', name: 'Other', learned: undefined };

  it('same VIN → conflict (before the name)', () => {
    const sameVin: UserVehicle = { ...GOLF_CAR, id: 'user:x', name: 'My Golf' };
    expect(planProfileImport(file, [other, sameVin])).toEqual({
      action: 'conflict',
      existingId: 'user:x',
      existingName: 'My Golf',
      reason: 'same-vin',
    });
  });

  it('same name only → conflict with reason same-name', () => {
    const sameName: UserVehicle = { ...other, id: 'user:y', name: ' volkswagen 2009 ' };
    expect(planProfileImport(file, [sameName])).toMatchObject({
      action: 'conflict',
      existingId: 'user:y',
      reason: 'same-name',
    });
  });

  it('different → create', () => {
    expect(planProfileImport(file, [other])).toEqual({ action: 'create' });
    expect(planProfileImport(file, [])).toEqual({ action: 'create' });
  });

  it('keep both: the name gets the first free " (n)"', () => {
    expect(keepBothName('Golf', ['Golf'])).toBe('Golf (2)');
    expect(keepBothName('Golf', ['Golf', 'golf (2)'])).toBe('Golf (3)');
  });

  it('keep both: an 80-character name is shortened so the result stays within 80', () => {
    const long = 'G'.repeat(80);
    const out = keepBothName(long, [long]);
    expect(out).toHaveLength(80);
    expect(out.endsWith(' (2)')).toBe(true);
  });
});

describe('exportVehicle clamps to the schema', () => {
  it('a long name, notes and joined CALIDs still export to a file that imports', () => {
    const car: UserVehicle = {
      ...GOLF_CAR,
      name: `  ${'Long name '.repeat(20)}`,
      notes: 'n'.repeat(5000),
      learned: {
        ...(GOLF_CAR.learned as NonNullable<UserVehicle['learned']>),
        calibrationId: Array.from({ length: 6 }, (_, i) => `03L906022LM 40${i}3`).join(' '),
        adapterVersion: 'ELM327\u0000 v1.5é',
      },
    };
    const file = exportVehicle(car, [], META);
    const vehicle = file.payload.vehicle;
    expect(vehicle.name.length).toBeLessThanOrEqual(80);
    expect(vehicle.name.startsWith('Long name')).toBe(true);
    expect(vehicle.notes).toHaveLength(4000);
    expect(vehicle.learned?.calibrationId?.length).toBeLessThanOrEqual(64);
    expect(vehicle.learned?.calibrationId?.startsWith('03L906022LM 4003')).toBe(true);
    expect(vehicle.learned?.adapterVersion).toBe('ELM327 v1.5');
    expect(validate(profileFileV1, file).ok).toBe(true);
    expect(isParseError(parseExchangeFile(serializeExchange(file)))).toBe(false);
  });

  it('a blank name falls back to the default name from the VIN', () => {
    const file = exportVehicle({ ...GOLF_CAR, name: '   ' }, [], META);
    expect(file.payload.vehicle.name.trim()).not.toBe('');
    expect(validate(profileFileV1, file).ok).toBe(true);
  });
});

describe('planLabelPackImport', () => {
  const example = packOf(parseExchangeFile(readExample('label-pack.example.json')));

  it('new id → create; the bundled pack with the same prefix is listed, imported names win', () => {
    const plan = planLabelPackImport(example, [], LABEL_PACKS);
    expect(plan.action).toBe('create');
    expect(plan.full).toBe(false);
    expect(plan.overlaps).toEqual([
      {
        packId: 'vag-edc17-03L906022',
        module: vagEdc17Golf.module,
        bundled: true,
        prefix: '03L906022',
        otherPrefix: '03L906022',
        importedWins: true,
      },
    ]);
    expect(overlapText(plan.overlaps[0])).toBe(
      'This pack also matches prefix 03L906022 used by the bundled EDC17 engine (2.0 TDI CR) pack; the imported names will take precedence.',
    );
  });

  it('pack id collision with a user pack → replace (and the replaced pack is not an overlap)', () => {
    const plan = planLabelPackImport(example, [example], LABEL_PACKS);
    expect(plan.action).toBe('replace');
    expect(plan.overlaps.map((o) => o.packId)).toEqual(['vag-edc17-03L906022']);
  });

  it('a shorter imported prefix does not beat a longer one', () => {
    const short: LabelPackV1 = { ...example, id: 'short', partNumberPrefixes: ['03L906'] };
    const plan = planLabelPackImport(short, [], LABEL_PACKS);
    expect(plan.overlaps).toHaveLength(1);
    expect(plan.overlaps[0].importedWins).toBe(false);
    expect(overlapText(plan.overlaps[0])).toMatch(/has the longer prefix \(03L906022\)/);
  });

  it('no overlap for an unrelated prefix; full at the cap', () => {
    const lone: LabelPackV1 = { ...example, id: 'lone', partNumberPrefixes: ['5M0920'] };
    expect(planLabelPackImport(lone, [], LABEL_PACKS).overlaps).toEqual([]);
    const many: LabelPack[] = Array.from({ length: 3 }, (_, i) => ({ ...lone, id: `p${i}` }));
    expect(planLabelPackImport(lone, many, [], 3).full).toBe(true);
    expect(planLabelPackImport({ ...lone, id: 'p1' }, many, [], 3).full).toBe(false);
  });

  it('keep both: the id gets the first free "-n"', () => {
    expect(keepBothPackId('pack', ['pack'])).toBe('pack-2');
    expect(keepBothPackId('pack', ['pack', 'pack-2'])).toBe('pack-3');
  });
});

describe('embedded packs', () => {
  const example = packOf(parseExchangeFile(readExample('label-pack.example.json')));

  it('a car exports the imported packs for its modules; import adds the new ones, keeps local ones', () => {
    const golf = buildUserProfile(GOLF_CAR, getVehicleProfile('golf-plus-2009-20tdi'));
    expect(profilePartNumbers(golf)).toEqual(expect.arrayContaining(['03L906022LM', '1K0937087D']));
    const unrelated: LabelPackV1 = { ...example, id: 'other', partNumberPrefixes: ['8E0910'] };
    const packs = packsForPartNumbers(profilePartNumbers(golf), [example, unrelated]);
    expect(packs.map((p) => p.id)).toEqual(['example-edc17-03L906022']);

    const file = profileOf(
      parseExchangeFile(serializeExchange(exportVehicle(GOLF_CAR, packs, META))),
    );
    expect(file.payload.labelPacks?.map((p) => p.id)).toEqual(['example-edc17-03L906022']);
    expect(planEmbeddedPacks(file, [])).toEqual({ add: [example], kept: [], overCap: [] });
    expect(planEmbeddedPacks(file, [example])).toEqual({ add: [], kept: [example], overCap: [] });
    expect(planEmbeddedPacks(file, [unrelated], 1).overCap).toEqual([example]);
  });

  it('exportLabelPack copies data only', () => {
    const file = exportLabelPack({ ...example, extra: () => 1 } as unknown as LabelPack, META);
    expect(Object.keys(file.payload)).not.toContain('extra');
    expect(file.schema).toBe('bolid.labelpack.v1');
    expect(file.exportedAt).toBe('2026-11-09T10:00:00.000Z');
  });
});

describe('file names', () => {
  it('bolid-<kind>-<slug>-<stamp>.json', () => {
    const now = new Date(Date.UTC(2026, 10, 9, 10));
    expect(exchangeFileName('profile', 'VW Golf Plus 2009 2.0 TDI', now)).toBe(
      'bolid-profile-vw-golf-plus-2009-2-0-tdi-2026-11-09T10-00-00-000Z.json',
    );
    expect(exchangeFileName('labelpack', 'vag-edc17-03L906022', now)).toBe(
      'bolid-labelpack-vag-edc17-03l906022-2026-11-09T10-00-00-000Z.json',
    );
    expect(slug('Škoda Octavia')).toBe('skoda-octavia');
    expect(slug('///')).toBe('file');
  });
});
