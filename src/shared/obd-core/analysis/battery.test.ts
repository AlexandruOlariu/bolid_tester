import { analyzeBattery, socFromResting, VSample } from './battery';

function series(vs: number[], step = 200): VSample[] {
  return vs.map((v, i) => ({ t: 1000 + i * step, v }));
}

describe('battery analysis', () => {
  it('estimates state of charge from resting voltage', () => {
    expect(socFromResting(12.6)).toBe(100);
    expect(socFromResting(12.2)).toBe(50);
    expect(socFromResting(11.8)).toBe(0);
    expect(socFromResting(10)).toBe(0); // clamped
  });

  it('reads a healthy start: resting → crank dip → charging', () => {
    const r = analyzeBattery(series([12.5, 12.5, 10.4, 12.0, 14.1, 14.2, 14.1]));
    expect(r.restingV).toBeCloseTo(12.5, 1);
    expect(r.crankingDipV).toBeCloseTo(10.4, 1);
    expect(r.chargingV).toBeCloseTo(14.1, 1);
    expect(r.verdict).toBe('good');
  });

  it('flags a weak battery from a deep cranking dip', () => {
    const r = analyzeBattery(series([12.3, 8.5, 11.0, 13.9, 13.9]));
    expect(r.crankingDipV).toBeCloseTo(8.5, 1);
    expect(r.verdict).toBe('weak');
  });

  it('falls back to SoC when there is no crank/charge', () => {
    const r = analyzeBattery(series([12.2, 12.2, 12.2]));
    expect(r.crankingDipV).toBeNull();
    expect(r.chargingV).toBeNull();
    expect(r.socPct).toBe(50);
    expect(r.verdict).toBe('fair');
  });

  it('warns on a low charging voltage', () => {
    const r = analyzeBattery(series([12.6, 13.3, 13.3]));
    expect(r.chargingV).toBeCloseTo(13.3, 1);
    expect(r.notes.some((n) => /weak alternator/i.test(n))).toBe(true);
  });

  it('handles an empty capture', () => {
    expect(analyzeBattery([]).verdict).toBe('unknown');
  });

  it('classifies a charging-only capture from the alternator voltage', () => {
    const r = analyzeBattery(series([14.1, 14.2, 14.1]));
    expect(r.restingV).toBeNull();
    expect(r.crankingDipV).toBeNull();
    expect(r.chargingV).toBeCloseTo(14.1, 1);
    expect(r.verdict).toBe('good');
  });
});
