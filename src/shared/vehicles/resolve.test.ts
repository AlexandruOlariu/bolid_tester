/** Profile resolution over the registry + garage, and the simulator source of a garage car
 *  (plan 06). The last test drives the real simulator: a car learned from the simulated Golf
 *  reconnects with the same VIN and PID set. */
import { DiagnosticSession } from '../obd-core/session/DiagnosticSession';
import { MockTransport } from '../obd-core/transport/MockTransport';
import { buildScenario } from '../obd-core/transport/scenarios';
import { getVehicleProfile } from './index';
import { resolveProfile, simulatorSourceFor } from './resolve';
import { learnedFromSessionInfo, type UserVehicle } from './userVehicle';

const car: UserVehicle = {
  id: 'user:logan',
  name: 'Dacia Logan',
  fuel: 'petrol',
  baseProfileId: 'golf-plus-2009-20tdi',
  createdAt: 1,
  updatedAt: 1,
};

async function connectInfo(profileId: string, overrides = {}) {
  const session = new DiagnosticSession(new MockTransport(buildScenario(profileId, overrides)));
  const info = await session.connect();
  await session.disconnect();
  return info;
}

describe('resolveProfile', () => {
  it('returns the registry profile itself for a registry id', () => {
    expect(resolveProfile('golf-plus-2009-20tdi', [car])).toBe(
      getVehicleProfile('golf-plus-2009-20tdi'),
    );
  });

  it('builds a garage car on its base profile', () => {
    const p = resolveProfile('user:logan', [car]);
    expect(p.id).toBe('user:logan');
    expect(p.name).toBe('Dacia Logan');
    expect(p.extendedPids).toBe(getVehicleProfile('golf-plus-2009-20tdi').extendedPids);
  });

  it('falls back to generic for an unknown id (e.g. a deleted garage car)', () => {
    expect(resolveProfile('user:gone', [car]).id).toBe('generic');
    expect(resolveProfile('nope', []).id).toBe('generic');
  });

  it('a garage car whose base disappeared inherits from generic', () => {
    const p = resolveProfile('user:logan', [{ ...car, baseProfileId: 'retired-profile' }]);
    expect(p.id).toBe('user:logan');
    expect(p.extendedPids).toBeUndefined();
  });
});

describe('simulatorSourceFor', () => {
  it('a registry id simulates itself; an unknown id simulates generic', () => {
    expect(simulatorSourceFor('fiat-punto-2008-12', [])).toEqual({
      profileId: 'fiat-punto-2008-12',
      overrides: {},
    });
    expect(simulatorSourceFor('user:gone', [])).toEqual({ profileId: 'generic', overrides: {} });
  });

  it('an unlearned garage car simulates its base unchanged', () => {
    expect(simulatorSourceFor('user:logan', [car])).toEqual({
      profileId: 'golf-plus-2009-20tdi',
      overrides: {},
    });
  });

  it('a car learned from the simulated Golf reconnects with the same VIN and PID set', async () => {
    const info = await connectInfo('golf-plus-2009-20tdi');
    expect(info.vin).toBe('WVWZZZ1KZ9W903398');

    // Learned on a generic base: without the overrides the simulator would answer as generic.
    const learnedCar: UserVehicle = {
      ...car,
      id: 'user:golf',
      baseProfileId: 'generic',
      learned: learnedFromSessionInfo(info),
    };
    const src = simulatorSourceFor('user:golf', [learnedCar]);
    expect(src.profileId).toBe('generic');
    const again = await connectInfo(src.profileId, src.overrides);
    expect(again.vin).toBe(info.vin);
    expect([...again.supportedPids].sort()).toEqual([...info.supportedPids].sort());
    expect(again.calibrationId).toBe(info.calibrationId);

    // The generic simulator alone reports a different car.
    const plain = await connectInfo('generic');
    expect(plain.vin).not.toBe(info.vin);
    expect([...plain.supportedPids].sort()).not.toEqual([...info.supportedPids].sort());
  });
});
