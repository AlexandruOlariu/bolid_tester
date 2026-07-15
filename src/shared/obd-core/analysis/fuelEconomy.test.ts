import {
  fuelConstants,
  fuelRateFromMaf,
  instantFuelEconomy,
  fuelEconomyFromValues,
  averageFuelEconomy,
  tripFuelAverage,
  FUEL_ECONOMY_PIDS,
  STANDSTILL_KMH,
  type FuelFlowSample,
} from './fuelEconomy';

describe('fuelConstants', () => {
  it('returns per-fuel stoichiometry and density', () => {
    expect(fuelConstants('petrol').afr).toBeCloseTo(14.7);
    expect(fuelConstants('diesel').densityGramsPerLitre).toBe(832);
  });

  it('falls back to petrol-cycle numbers for hybrid/other', () => {
    expect(fuelConstants('hybrid')).toEqual(fuelConstants('petrol'));
    expect(fuelConstants('other')).toEqual(fuelConstants('petrol'));
  });
});

describe('fuelRateFromMaf', () => {
  it('derives L/h from MAF for petrol (idle ~ a few L/h)', () => {
    // 3 g/s air, petrol: fuel g/s = 3/14.7 = 0.2041; L/s = 0.2041/745; ×3600 ≈ 0.986 L/h
    expect(fuelRateFromMaf(3, 'petrol')).toBeCloseTo(0.986, 2);
  });

  it('diesel burns denser fuel at a leaner AFR, so more mass but fewer litres per gram', () => {
    const petrol = fuelRateFromMaf(10, 'petrol');
    const diesel = fuelRateFromMaf(10, 'diesel');
    expect(diesel).toBeLessThan(petrol); // higher density + AFR → fewer litres
  });

  it('is zero at zero air flow', () => {
    expect(fuelRateFromMaf(0, 'petrol')).toBe(0);
  });
});

describe('instantFuelEconomy', () => {
  it('prefers the fuel-rate PID over the MAF estimate', () => {
    const r = instantFuelEconomy({ fuel: 'diesel', fuelRateLh: 4, mafGramsPerSec: 99, speedKmh: 100 });
    expect(r).not.toBeNull();
    expect(r!.source).toBe('fuel-rate');
    expect(r!.litresPerHour).toBe(4);
    // 4 L/h at 100 km/h = 4 L/100km
    expect(r!.litresPer100km).toBeCloseTo(4, 5);
  });

  it('falls back to MAF when the fuel-rate PID is absent', () => {
    const r = instantFuelEconomy({ fuel: 'petrol', mafGramsPerSec: 10, speedKmh: 80 });
    expect(r!.source).toBe('maf');
    expect(r!.litresPer100km).toBeGreaterThan(0);
  });

  it('reports L/h only (null L/100km) at a standstill — no divide-by-zero', () => {
    const r = instantFuelEconomy({ fuel: 'petrol', fuelRateLh: 1.2, speedKmh: 0 });
    expect(r!.litresPerHour).toBe(1.2);
    expect(r!.litresPer100km).toBeNull();
  });

  it('treats sub-threshold creep as standstill', () => {
    const r = instantFuelEconomy({ fuel: 'petrol', fuelRateLh: 1, speedKmh: STANDSTILL_KMH - 0.01 });
    expect(r!.litresPer100km).toBeNull();
  });

  it('returns null when neither fuel path is available', () => {
    expect(instantFuelEconomy({ fuel: 'petrol', speedKmh: 50 })).toBeNull();
    expect(instantFuelEconomy({ fuel: 'petrol', fuelRateLh: null, mafGramsPerSec: null })).toBeNull();
  });

  it('ignores negative sentinel readings', () => {
    const r = instantFuelEconomy({ fuel: 'petrol', fuelRateLh: -1, mafGramsPerSec: 5, speedKmh: 50 });
    expect(r!.source).toBe('maf');
  });
});

describe('fuelEconomyFromValues', () => {
  it('pulls the needed PIDs out of a decoded snapshot', () => {
    const r = fuelEconomyFromValues({ '015E': 5, '010D': 100 }, 'diesel');
    expect(r!.source).toBe('fuel-rate');
    expect(r!.litresPer100km).toBeCloseTo(5, 5);
  });

  it('exposes the exact PIDs it consumes', () => {
    expect(FUEL_ECONOMY_PIDS).toEqual(['015E', '0110', '010D']);
  });
});

describe('averageFuelEconomy', () => {
  it('integrates flow to litres and speed to km over the window', () => {
    // constant 6 L/h and 60 km/h for 1 hour → 6 L over 60 km → 10 L/100km
    const samples: FuelFlowSample[] = [
      { t: 0, litresPerHour: 6, speedKmh: 60 },
      { t: 3_600_000, litresPerHour: 6, speedKmh: 60 },
    ];
    const avg = averageFuelEconomy(samples);
    expect(avg.litres).toBeCloseTo(6, 5);
    expect(avg.km).toBeCloseTo(60, 5);
    expect(avg.litresPer100km).toBeCloseTo(10, 5);
    expect(avg.litresPerHour).toBeCloseTo(6, 5);
  });

  it('returns null economy when distance is ~0 (idled the whole window)', () => {
    const avg = averageFuelEconomy([
      { t: 0, litresPerHour: 1, speedKmh: 0 },
      { t: 3_600_000, litresPerHour: 1, speedKmh: 0 },
    ]);
    expect(avg.km).toBe(0);
    expect(avg.litresPer100km).toBeNull();
    expect(avg.litresPerHour).toBeCloseTo(1, 5);
  });

  it('skips non-monotonic / zero-length steps and handles an empty window', () => {
    expect(averageFuelEconomy([]).litresPerHour).toBeNull();
    const avg = averageFuelEconomy([
      { t: 1000, litresPerHour: 5, speedKmh: 50 },
      { t: 1000, litresPerHour: 5, speedKmh: 50 }, // dt = 0, ignored
    ]);
    expect(avg.litres).toBe(0);
  });
});

describe('tripFuelAverage', () => {
  it('derives per-sample flow then integrates over the trip', () => {
    const samples = [
      { t: 0, values: { '015E': 6, '010D': 60 } },
      { t: 3_600_000, values: { '015E': 6, '010D': 60 } },
    ];
    const avg = tripFuelAverage(samples, 'diesel');
    expect(avg.litresPer100km).toBeCloseTo(10, 5);
  });

  it('yields an empty average when no sample carries a fuel PID', () => {
    const avg = tripFuelAverage([{ t: 0, values: { '010D': 50 } }], 'petrol');
    expect(avg.litresPerHour).toBeNull();
  });
});
