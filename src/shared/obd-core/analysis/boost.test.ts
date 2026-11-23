import { getVehicleProfile } from '../../vehicles';
import type { BoostRange } from '../../vehicles/types';
import {
  assessBoost,
  ASSUMED_BARO_KPA,
  MAP_BELOW_BARO_KPA,
  STUCK_SENSOR_KPA,
  STUCK_VNT_IDLE_KPA,
} from './boost';

const golf = getVehicleProfile('golf-plus-2009-20tdi').boost!;
const passat = getVehicleProfile('passat-b55-19tdi').boost!;

describe('assessBoost', () => {
  it('normal idle and hold', () =>
    expect(
      assessBoost(
        { idleMapKpa: 100, idleRpm: 820, holdMapKpa: 125, holdMaxRpm: 2500, baroKpa: 100 },
        golf,
      ).findings,
    ).toEqual([{ id: 'ok', severity: 'ok' }]));
  it('no boost at the hold (simulated low-boost fault)', () =>
    expect(
      assessBoost(
        { idleMapKpa: 100, idleRpm: 820, holdMapKpa: 104, holdMaxRpm: 2500, baroKpa: 100 },
        golf,
      ).findings.map((f) => f.id),
    ).toEqual(['no_boost_hold']));
  it('more than 30 kPa at idle points to a stuck VNT', () =>
    expect(
      assessBoost(
        { idleMapKpa: 135, idleRpm: 820, holdMapKpa: null, holdMaxRpm: null, baroKpa: 100 },
        golf,
      ).findings[0],
    ).toEqual({ id: 'stuck_vnt', severity: 'warn' }));
  it('identical MAP while rpm rises is a stuck sensor', () =>
    expect(
      assessBoost(
        { idleMapKpa: 100, idleRpm: 820, holdMapKpa: 101, holdMaxRpm: 2500, baroKpa: 100 },
        golf,
      ).findings[0].id,
    ).toBe('stuck_sensor'));
  it('a hold below minHoldRpm is not judged', () =>
    expect(
      assessBoost(
        { idleMapKpa: 100, idleRpm: 820, holdMapKpa: 101, holdMaxRpm: 1500, baroKpa: 100 },
        golf,
      ).findings.map((f) => f.id),
    ).toEqual(['hold_not_reached']));
  it('without 0133 the baro is assumed and said so', () => {
    const r = assessBoost(
      { idleMapKpa: 100, idleRpm: 820, holdMapKpa: null, holdMaxRpm: null, baroKpa: null },
      golf,
    );
    expect(r.baroAssumed).toBe(true);
    expect(r.notes.join(' ')).toContain('baro assumed 101.3 kPa');
  });

  it('without 0133, MAP 90 kPa at idle (about 850 m) is not called implausible', () => {
    const r = assessBoost(
      { idleMapKpa: 90, idleRpm: 820, holdMapKpa: null, holdMaxRpm: null, baroKpa: null },
      passat,
    );
    expect(r.findings.map((f) => f.id)).not.toContain('map_below_baro');
    expect(r.findings).toEqual([{ id: 'ok', severity: 'ok' }]);
    expect(r.notes.join(' ')).toContain('baro is unknown');
  });

  it('without 0133 the hold is judged on its rise over the idle MAP (500 m, healthy)', () => {
    // Baro ~95.5 kPa at 500 m: idle MAP 95.5, hold 101.5 = 6 kPa of boost, within the Passat's 5-60.
    const r = assessBoost(
      { idleMapKpa: 95.5, idleRpm: 820, holdMapKpa: 101.5, holdMaxRpm: 2500, baroKpa: null },
      passat,
    );
    expect(r.holdDeltaKpa).toBe(6);
    expect(r.findings).toEqual([{ id: 'ok', severity: 'ok' }]);
    expect(r.notes.join(' ')).toContain('over the idle MAP');
  });

  it('without 0133 a hold with no rise is still no_boost_hold', () =>
    expect(
      assessBoost(
        { idleMapKpa: 95, idleRpm: 820, holdMapKpa: 97, holdMaxRpm: 2500, baroKpa: null },
        passat,
      ).findings,
    ).toEqual([{ id: 'no_boost_hold', severity: 'warn' }]));

  it('exports the thresholds', () => {
    expect(ASSUMED_BARO_KPA).toBe(101.3);
    expect(STUCK_VNT_IDLE_KPA).toBe(30);
    expect(MAP_BELOW_BARO_KPA).toBe(-10);
    expect(STUCK_SENSOR_KPA).toBe(2);
  });

  it('MAP well below baro at idle is flagged', () =>
    expect(
      assessBoost(
        { idleMapKpa: 85, idleRpm: 820, holdMapKpa: null, holdMaxRpm: null, baroKpa: 100 },
        golf,
      ).findings,
    ).toEqual([{ id: 'map_below_baro', severity: 'warn' }]));

  it('idle delta above the range but within 30 kPa is idle_high (info)', () =>
    expect(
      assessBoost(
        { idleMapKpa: 120, idleRpm: 820, holdMapKpa: null, holdMaxRpm: null, baroKpa: 100 },
        golf,
      ).findings,
    ).toEqual([{ id: 'idle_high', severity: 'info' }]));

  it('a hold above the range is overboost', () =>
    expect(
      assessBoost(
        { idleMapKpa: 100, idleRpm: 820, holdMapKpa: 175, holdMaxRpm: 2500, baroKpa: 100 },
        golf,
      ).findings.map((f) => f.id),
    ).toEqual(['overboost_hold']));

  it('the per-profile range decides: +6 kPa is low on the Golf, fine on the Passat', () => {
    const input = {
      idleMapKpa: 100,
      idleRpm: 850,
      holdMapKpa: 106,
      holdMaxRpm: 2500,
      baroKpa: 100,
    };
    expect(assessBoost(input, golf).findings.map((f) => f.id)).toEqual(['no_boost_hold']);
    expect(assessBoost(input, passat).findings.map((f) => f.id)).toEqual(['ok']);
  });

  it('an idle finding and a hold finding are both reported', () =>
    expect(
      assessBoost(
        { idleMapKpa: 118, idleRpm: 820, holdMapKpa: 106, holdMaxRpm: 2500, baroKpa: 100 },
        golf,
      ).findings.map((f) => f.id),
    ).toEqual(['idle_high', 'no_boost_hold']));

  it('a missing idle MAP is insufficient, never a verdict', () => {
    const r = assessBoost(
      { idleMapKpa: null, idleRpm: 820, holdMapKpa: 125, holdMaxRpm: 2500, baroKpa: 100 },
      golf,
    );
    expect(r.findings).toEqual([{ id: 'insufficient', severity: 'info' }]);
    expect(r.idleDeltaKpa).toBeNull();
    expect(r.holdDeltaKpa).toBe(25); // the reading is kept, just not judged
    expect(r.notes.join(' ')).toContain('not enough data');
  });

  it('a missing hold MAP (NO DATA mid-procedure) judges the idle part only', () => {
    const r = assessBoost(
      { idleMapKpa: 100, idleRpm: 820, holdMapKpa: null, holdMaxRpm: 2500, baroKpa: 100 },
      golf,
    );
    expect(r.findings).toEqual([{ id: 'ok', severity: 'ok' }]);
    expect(r.holdDeltaKpa).toBeNull();
    expect(r.notes.join(' ')).toContain('hold part not judged');
  });

  it('a hold without rpm is not judged', () => {
    const r = assessBoost(
      { idleMapKpa: 100, idleRpm: 820, holdMapKpa: 104, holdMaxRpm: null, baroKpa: 100 },
      golf,
    );
    expect(r.findings.map((f) => f.id)).toEqual(['ok']);
    expect(r.notes.join(' ')).toContain('hold part not judged');
  });

  it('the hold-not-reached note names the max rpm', () =>
    expect(
      assessBoost(
        { idleMapKpa: 100, idleRpm: 820, holdMapKpa: 101, holdMaxRpm: 1500, baroKpa: 100 },
        golf,
      ).notes.join(' '),
    ).toContain('rev hold not reached (max 1500 rpm)'));

  it('reports deltas against the baro and a measured baro is not assumed', () => {
    const r = assessBoost(
      { idleMapKpa: 103, idleRpm: 820, holdMapKpa: 130, holdMaxRpm: 2500, baroKpa: 98 },
      golf,
    );
    expect(r).toMatchObject({ idleDeltaKpa: 5, holdDeltaKpa: 32, baroAssumed: false });
    expect(r.notes.join(' ')).not.toContain('baro assumed');
  });

  it('an unconfirmed range is said in the notes but does not cap the findings', () => {
    const r = assessBoost(
      { idleMapKpa: 100, idleRpm: 820, holdMapKpa: 104, holdMaxRpm: 2500, baroKpa: 100 },
      golf,
    );
    expect(golf.confirmed).toBeUndefined();
    expect(r.notes.join(' ')).toContain('expected range not yet confirmed on this car');
    expect(r.findings).toEqual([{ id: 'no_boost_hold', severity: 'warn' }]);
    const confirmed: BoostRange = {
      ...golf,
      confirmed: { on: '2026-12-01', source: 'on-car' },
    };
    expect(
      assessBoost(
        { idleMapKpa: 100, idleRpm: 820, holdMapKpa: 104, holdMaxRpm: 2500, baroKpa: 100 },
        confirmed,
      ).notes.join(' '),
    ).not.toContain('not yet confirmed');
  });
});

describe('per-profile boost ranges', () => {
  it('Golf and Passat carry the initial ranges; the Punto (no turbo) has none', () => {
    expect(golf).toEqual({
      idleDeltaKpa: [-5, 15],
      holdDeltaKpa: [8, 60],
      holdRpm: 2500,
      minHoldRpm: 2200,
    });
    expect(passat).toEqual({
      idleDeltaKpa: [-5, 15],
      holdDeltaKpa: [5, 60],
      holdRpm: 2500,
      minHoldRpm: 2200,
    });
    expect(getVehicleProfile('fiat-punto-2008-12').boost).toBeUndefined();
    expect(getVehicleProfile('generic').boost).toBeUndefined();
  });
});
