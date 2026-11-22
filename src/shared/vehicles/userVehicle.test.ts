/** User vehicles (plan 06): how a garage car becomes a runtime profile, what a live session teaches
 *  it, its default name and the VIN auto-select pick. */
import { getVehicleProfile, vehicleLabel } from './index';
import {
  buildUserProfile,
  curatedProfileId,
  defaultVehicleName,
  isUserVehicleId,
  livePidFilter,
  learnedFromSessionInfo,
  makeForVin,
  mergeModules,
  pickVehicleForVin,
  sanitizeUserModules,
  vinSuffix,
  type UserVehicle,
} from './userVehicle';

const GOLF_VIN = 'WVWZZZ1KZ9W903398';
const PUNTO_VIN = 'ZFA19900000438592';

function user(patch: Partial<UserVehicle> = {}): UserVehicle {
  return {
    id: 'user:test',
    name: 'Test car',
    fuel: 'diesel',
    baseProfileId: 'generic',
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  };
}

const LEARNED = {
  protocol: 'ISO_15765_4_CAN_11_500' as const,
  supportedPids: ['010C', '010D', '0105'],
  vin: GOLF_VIN,
  calibrationId: '03L906022LM',
  learnedAt: 5,
};

describe('buildUserProfile', () => {
  const golf = getVehicleProfile('golf-plus-2009-20tdi');
  const generic = getVehicleProfile('generic');

  it('inherits the experimental arrays from a non-generic base', () => {
    const p = buildUserProfile(user({ baseProfileId: golf.id }), golf);
    expect(golf.extendedPids?.length).toBeGreaterThan(0);
    expect(p.extendedPids).toBe(golf.extendedPids);
    expect(p.modules).toBe(golf.modules);
    expect(p.routines).toBe(golf.routines);
    expect(p.codingModules).toBe(golf.codingModules);
    expect(p.adaptations).toBe(golf.adaptations);
    expect(p.serviceReset).toBe(golf.serviceReset);
    expect(p.gatewayInstallList).toBe(golf.gatewayInstallList);
    expect(p.baseProfileId).toBe(golf.id);
  });

  it('merges discovered modules over the base list, on any base (plan 25)', () => {
    const hvac = {
      address: '08',
      name: 'Auto HVAC',
      transport: 'uds' as const,
      reqHeader: '746',
      rxFilter: '7B0',
      experimental: true,
    };
    const fromGeneric = buildUserProfile(user({ modules: [hvac] }), generic);
    expect(fromGeneric.modules).toEqual([hvac]);

    const abs = {
      ...hvac,
      address: '03',
      name: 'ABS (discovered)',
      reqHeader: '713',
      rxFilter: '77D',
    };
    const p = buildUserProfile(user({ baseProfileId: golf.id, modules: [abs, hvac] }), golf);
    const golfModules = golf.modules ?? [];
    expect(p.modules).toHaveLength(golfModules.length + 1);
    // Same transport + address replaces the base entry in place; the TP2.0 '17' is untouched.
    const i = golfModules.findIndex((m) => m.address === '03');
    expect(p.modules?.[i]).toEqual(abs);
    expect(p.modules?.[p.modules.length - 1]).toEqual(hvac);
    expect(golf.modules?.[i].reqHeader).toBe('760'); // the registry profile is not mutated
    expect(mergeModules([], [])).toEqual([]);
  });

  it('sanitizeUserModules keeps well-formed modules only', () => {
    const ok = {
      address: '08',
      name: 'HVAC',
      transport: 'uds',
      reqHeader: '746',
      rxFilter: '7B0',
      experimental: true,
    };
    expect(
      sanitizeUserModules([
        ok,
        { ...ok, reqHeader: 'ZZZ' },
        { ...ok, address: '8' },
        { ...ok, experimental: 'yes' },
        {
          address: '46',
          name: 'Comfort',
          transport: 'tp20',
          tp20Address: 0x46,
          experimental: true,
        },
        { address: '47', name: 'x', transport: 'tp20', experimental: true },
        null,
        'x',
      ]),
    ).toEqual([
      ok,
      { address: '46', name: 'Comfort', transport: 'tp20', tp20Address: 0x46, experimental: true },
    ]);
    expect(sanitizeUserModules('nope')).toBeUndefined();
    expect(sanitizeUserModules([{ bad: 1 }])).toBeUndefined();
  });

  it('never inherits from generic, nor the known faults or checklist of any base', () => {
    const fromGeneric = buildUserProfile(user(), generic);
    expect(fromGeneric.extendedPids).toBeUndefined();
    expect(fromGeneric.modules).toBeUndefined();
    expect(fromGeneric.routines).toBeUndefined();
    const fromGolf = buildUserProfile(user({ baseProfileId: golf.id }), golf);
    expect(golf.knownFaults?.length).toBeGreaterThan(0);
    expect(fromGolf.knownFaults).toBeUndefined();
    expect(fromGolf.testChecklist).toEqual([]);
  });

  it('takes identity from the user record and the rest from the base', () => {
    const p = buildUserProfile(
      user({ name: 'Dacia Logan', year: 2015, make: 'fiat', notes: 'n' }),
      golf,
    );
    expect(p.id).toBe('user:test');
    expect(p.name).toBe('Dacia Logan');
    expect(p.year).toBe(2015);
    expect(p.fuel).toBe('diesel');
    expect(p.make).toBe('fiat');
    expect(p.notes).toBe('n');
    expect(p.dtcModes).toEqual(golf.dtcModes);
    // Unlearned: protocol, PIDs and VIN patterns are the base's.
    expect(p.expectedProtocol).toBe(golf.expectedProtocol);
    expect(p.supportedPids).toBe(golf.supportedPids);
    expect(p.vinPatterns).toBe(golf.vinPatterns);
    // Missing year / make fall back to the base.
    const bare = buildUserProfile(user(), golf);
    expect(bare.year).toBe(golf.year);
    expect(bare.make).toBe(golf.make);
    expect(bare.notes).toBe('');
  });

  it('learned protocol and PIDs override the base; the VIN gives the VIN pattern', () => {
    const p = buildUserProfile(user({ learned: LEARNED }), generic);
    expect(p.expectedProtocol).toBe('ISO_15765_4_CAN_11_500');
    expect(p.supportedPids).toEqual(['010C', '010D', '0105']);
    expect(p.vinPatterns).toEqual(['WVWZZZ1K']);
  });

  it('a garage car on the Golf base keeps the boost range; a generic-base car has none', () => {
    expect(golf.boost).toBeDefined();
    expect(buildUserProfile(user({ baseProfileId: golf.id }), golf).boost).toEqual(golf.boost);
    expect(buildUserProfile(user(), generic).boost).toBeUndefined();
  });

  it('fault guides follow the base profile', () => {
    expect(curatedProfileId(buildUserProfile(user({ baseProfileId: golf.id }), golf))).toBe(
      golf.id,
    );
    expect(curatedProfileId(golf)).toBe(golf.id);
  });
});

describe('livePidFilter', () => {
  const golf = getVehicleProfile('golf-plus-2009-20tdi');
  const generic = getVehicleProfile('generic');
  it('takes no filter for generic and for any garage car on the generic base', () => {
    expect(livePidFilter(generic)).toBeUndefined();
    // Added by hand, nothing learned: must not be cut down to generic's placeholder list.
    expect(livePidFilter(buildUserProfile(user(), generic))).toBeUndefined();
    expect(livePidFilter(buildUserProfile(user({ learned: LEARNED }), generic))).toBeUndefined();
  });

  it('filters by the curated list on a registry base (learned set wins when there is one)', () => {
    expect(livePidFilter(golf)).toBe(golf.supportedPids);
    expect(livePidFilter(buildUserProfile(user({ baseProfileId: golf.id }), golf))).toBe(
      golf.supportedPids,
    );
    expect(
      livePidFilter(buildUserProfile(user({ baseProfileId: golf.id, learned: LEARNED }), golf)),
    ).toEqual(['010C', '010D', '0105']);
  });
});

describe('learnedFromSessionInfo', () => {
  it('copies the session fields', () => {
    const info = {
      protocol: 'ISO_14230_4_KWP_FAST' as const,
      voltage: 12.4,
      version: 'ELM327 v1.5',
      supportedPids: ['010C', '0105'],
      vin: PUNTO_VIN,
      calibrationId: '55230047AA',
    };
    const l = learnedFromSessionInfo(info, 42);
    expect(l).toEqual({
      protocol: 'ISO_14230_4_KWP_FAST',
      supportedPids: ['010C', '0105'],
      vin: PUNTO_VIN,
      calibrationId: '55230047AA',
      adapterVersion: 'ELM327 v1.5',
      learnedAt: 42,
    });
    // A copy, not the session's own array.
    expect(l.supportedPids).not.toBe(info.supportedPids);
  });
});

describe('names and makes', () => {
  it('defaultVehicleName reads maker and model year from the VIN', () => {
    const name = defaultVehicleName(GOLF_VIN);
    expect(name).toContain('Volkswagen');
    expect(name).toContain('2009');
    // No model year encoded (European VIN) → maker only; unknown WMI or no VIN → "My car".
    expect(defaultVehicleName(PUNTO_VIN)).toBe('Fiat');
    expect(defaultVehicleName('XXX12345678901234')).toBe('My car');
    expect(defaultVehicleName(null)).toBe('My car');
  });

  it('makeForVin maps VW group and Fiat group makers', () => {
    expect(makeForVin(GOLF_VIN)).toBe('vag');
    expect(makeForVin('TMBZZZ1Z0A0000000')).toBe('vag');
    expect(makeForVin(PUNTO_VIN)).toBe('fiat');
    expect(makeForVin('ZAR93900000000000')).toBe('fiat');
    expect(makeForVin('VF1AAAAA000000000')).toBeUndefined();
    expect(makeForVin(null)).toBeUndefined();
  });

  it('vehicleLabel does not repeat a year the garage name already carries', () => {
    const generic = getVehicleProfile('generic');
    const p = buildUserProfile(user({ name: 'Volkswagen 2009', year: 2009 }), generic);
    expect(vehicleLabel(p)).toBe('Volkswagen 2009');
    const q = buildUserProfile(user({ name: 'Logan', year: 2015 }), generic);
    expect(vehicleLabel(q)).toBe('Logan (2015)');
    // Registry labels are unchanged.
    expect(vehicleLabel(getVehicleProfile('golf-plus-2009-20tdi'))).toMatch(/\(2009\)$/);
  });

  it('ids and VIN suffixes', () => {
    expect(isUserVehicleId('user:abc')).toBe(true);
    expect(isUserVehicleId('golf-plus-2009-20tdi')).toBe(false);
    expect(vinSuffix(GOLF_VIN)).toBe('03398');
    expect(vinSuffix(null)).toBeNull();
  });
});

describe('pickVehicleForVin', () => {
  const golfCar = user({ id: 'user:golf', learned: LEARNED, updatedAt: 10 });
  const manual = user({ id: 'user:manual' });

  it('matches a learned VIN, ignoring case and spaces', () => {
    expect(pickVehicleForVin(GOLF_VIN, [manual, golfCar])?.id).toBe('user:golf');
    expect(pickVehicleForVin(` ${GOLF_VIN.toLowerCase()} `, [golfCar])?.id).toBe('user:golf');
  });

  it('picks nothing for another car, a missing VIN or an unlearned garage', () => {
    expect(pickVehicleForVin(PUNTO_VIN, [manual, golfCar])).toBeNull();
    expect(pickVehicleForVin(null, [golfCar])).toBeNull();
    expect(pickVehicleForVin('', [golfCar])).toBeNull();
    expect(pickVehicleForVin(GOLF_VIN, [manual])).toBeNull();
  });

  it('the most recently updated of two matches wins', () => {
    const newer = user({ id: 'user:newer', learned: LEARNED, updatedAt: 20 });
    expect(pickVehicleForVin(GOLF_VIN, [golfCar, newer])?.id).toBe('user:newer');
  });
});
