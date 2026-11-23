import {
  assessCooling,
  COLD_START_MAX_C,
  HOT_C,
  OVERHEAT_C,
  SLOW_WARMUP_MIN,
  THERMOSTAT_DRIVE_MIN,
  THERMOSTAT_OPEN_MAX_C,
  WARM_C,
  warmupCurve,
  type WarmupCurve,
} from './cooling';
import type { TripSample } from './trip';

const MIN = 60_000;

/** `minutes` per-minute coolant readings (minute 0 .. minutes-1), linear from `fromC` to `toC`. */
function ramp(fromC: number, toC: number, minutes: number): number[] {
  return Array.from({ length: minutes }, (_, i) => fromC + ((toC - fromC) * i) / (minutes - 1));
}

/** One sample per minute: coolant (0105) from `coolant` when given, speed (010D) constant. */
function trip(opts: { coolant?: number[]; speed: number; minutes?: number }): TripSample[] {
  const n = opts.coolant?.length ?? opts.minutes ?? 10;
  return Array.from({ length: n }, (_, i) => ({
    t: 1_700_000_000_000 + i * MIN,
    values: {
      ...(opts.coolant ? { '0105': opts.coolant[i] } : {}),
      '010D': opts.speed,
    },
  }));
}

const coldCurve = (over: Partial<WarmupCurve>): WarmupCurve => ({
  coldStart: true,
  startC: 20,
  warmupMin: 9,
  drivenMin: 20,
  maxC: 90,
  ...over,
});

describe('cooling', () => {
  it('a cold start that never warms in 20 min of driving is a stuck-open thermostat', () => {
    const curve = warmupCurve(trip({ coolant: ramp(15, 68, 20), speed: 50 }))!;
    expect(assessCooling(70, curve, 'diesel').findings).toContainEqual({
      id: 'thermostat_open',
      severity: 'warn',
    });
  });
  it('a normal warm-up in 9 min is ok', () => {
    const curve = warmupCurve(trip({ coolant: ramp(20, 90, 12), speed: 50 }))!;
    expect(curve.warmupMin).toBeCloseTo(9, 0);
    expect(assessCooling(90, curve, 'petrol').findings).toEqual([{ id: 'ok', severity: 'ok' }]);
  });
  it('no cold-start trip falls back to the current reading', () =>
    expect(
      assessCooling(
        108,
        warmupCurve(trip({ coolant: ramp(85, 90, 10), speed: 50 })),
        'petrol',
      ).findings.map((f) => f.id),
    ).toEqual(['hot_now', 'no_cold_trip']));
  it('a trip without coolant has no curve', () =>
    expect(warmupCurve(trip({ speed: 50 }))).toBeNull());

  it('exports the thresholds', () => {
    expect(COLD_START_MAX_C).toBe(40);
    expect(WARM_C).toBe(80);
    expect(THERMOSTAT_OPEN_MAX_C).toBe(75);
    expect(THERMOSTAT_DRIVE_MIN).toBe(15);
    expect(HOT_C).toBe(105);
    expect(OVERHEAT_C).toBe(115);
    expect(SLOW_WARMUP_MIN).toEqual({ petrol: 20, diesel: 25 });
  });

  describe('warmupCurve', () => {
    it('describes a cold start', () => {
      const curve = warmupCurve(trip({ coolant: ramp(20, 90, 12), speed: 50 }))!;
      expect(curve.coldStart).toBe(true);
      expect(curve.startC).toBe(20);
      expect(curve.maxC).toBe(90);
      expect(curve.drivenMin).toBe(11);
    });
    it('a trip that starts warm is not a cold start and has no warm-up time', () => {
      const curve = warmupCurve(trip({ coolant: ramp(85, 90, 10), speed: 50 }))!;
      expect(curve.coldStart).toBe(false);
      expect(curve.warmupMin).toBeNull();
    });
    it('never reaching 80 °C leaves warmupMin null', () =>
      expect(warmupCurve(trip({ coolant: ramp(15, 68, 20), speed: 50 }))!.warmupMin).toBeNull());
    it('drivenMin counts only the minutes with 010D above 0', () => {
      const samples = trip({ coolant: ramp(20, 90, 12), speed: 50 });
      for (const s of samples.slice(0, 6)) s.values['010D'] = 0;
      expect(warmupCurve(samples)!.drivenMin).toBe(5);
    });
    it('a trip that never moved has 0 driven minutes', () =>
      expect(warmupCurve(trip({ coolant: ramp(20, 90, 12), speed: 0 }))!.drivenMin).toBe(0));
    it('skips NO DATA coolant samples instead of reading them as 0 °C', () => {
      const samples = trip({ coolant: ramp(20, 90, 12), speed: 50 });
      samples[0].values['0105'] = null;
      const curve = warmupCurve(samples)!;
      expect(curve.startC).toBeCloseTo(26.4, 1);
      expect(curve.coldStart).toBe(true);
    });
    it('a trip whose coolant is all NO DATA has no curve', () => {
      const samples = trip({ coolant: ramp(20, 90, 5), speed: 50 });
      for (const s of samples) s.values['0105'] = null;
      expect(warmupCurve(samples)).toBeNull();
    });
    it('an empty trip has no curve', () => expect(warmupCurve([])).toBeNull());
  });

  describe('assessCooling', () => {
    it('115 °C now is overheat (critical)', () =>
      expect(assessCooling(115, coldCurve({}), 'petrol').findings).toEqual([
        { id: 'overheat_now', severity: 'critical' },
      ]));
    it('105 °C now is hot (warn)', () =>
      expect(assessCooling(105, coldCurve({}), 'petrol').findings).toEqual([
        { id: 'hot_now', severity: 'warn' },
      ]));
    it('no cold trip says it judged on the current reading only', () => {
      const r = assessCooling(90, null, 'petrol');
      expect(r.findings).toEqual([{ id: 'no_cold_trip', severity: 'info' }]);
      expect(r.notes).toContain(
        'No recorded trip started cold; judged on the current reading only.',
      );
    });
    it('a cold start driven under 15 min that never warmed is said, not called ok', () =>
      expect(
        assessCooling(70, coldCurve({ drivenMin: 14, maxC: 60, warmupMin: null }), 'petrol')
          .findings,
      ).toEqual([{ id: 'warmup_not_judged', severity: 'info' }]));
    it('a cold start that peaked between 75 and 80 °C is not judged, not ok', () =>
      expect(
        assessCooling(85, coldCurve({ drivenMin: 20, maxC: 78, warmupMin: null }), 'petrol')
          .findings,
      ).toEqual([{ id: 'warmup_not_judged', severity: 'info' }]));
    it('reaching 75 °C is not a stuck-open thermostat', () =>
      expect(
        assessCooling(75, coldCurve({ maxC: 75, warmupMin: null }), 'petrol').findings.map(
          (f) => f.id,
        ),
      ).not.toContain('thermostat_open'));
    it('a petrol warm-up over 20 min is slow', () =>
      expect(assessCooling(90, coldCurve({ warmupMin: 22 }), 'petrol').findings).toEqual([
        { id: 'slow_warmup', severity: 'info' },
      ]));
    it('a diesel gets 25 min before the warm-up is slow', () => {
      expect(assessCooling(90, coldCurve({ warmupMin: 22 }), 'diesel').findings).toEqual([
        { id: 'ok', severity: 'ok' },
      ]);
      expect(assessCooling(90, coldCurve({ warmupMin: 26 }), 'diesel').findings).toEqual([
        { id: 'slow_warmup', severity: 'info' },
      ]);
    });
    it('a trip that reached 115 °C is a critical trip overheat', () =>
      expect(assessCooling(90, coldCurve({ maxC: 116 }), 'petrol').findings).toEqual([
        { id: 'trip_overheat', severity: 'critical' },
      ]));
    it('a trip that reached 105 °C is a warn trip overheat', () =>
      expect(assessCooling(90, coldCurve({ maxC: 107 }), 'petrol').findings).toEqual([
        { id: 'trip_overheat', severity: 'warn' },
      ]));
    it('a warm-start trip still reports its overheat', () =>
      expect(
        assessCooling(
          90,
          { coldStart: false, startC: 85, warmupMin: null, drivenMin: 20, maxC: 112 },
          'petrol',
        ).findings.map((f) => f.id),
      ).toEqual(['no_cold_trip', 'trip_overheat']));
    it('no current reading and no cold trip: nothing judged, no finding, no "current reading only"', () => {
      const r = assessCooling(null, null, 'petrol');
      expect(r.findings).toEqual([]);
      expect(r.notes.join(' ')).toContain('No current coolant reading (0105)');
      expect(r.notes.join(' ')).toContain('cooling not judged');
      expect(r.notes.join(' ')).not.toContain('judged on the current reading only');
    });
  });
});
