/** Pure fuel-economy math over live PIDs. No React/RN deps, so it is unit-tested in isolation.
 *
 *  Values are kept **canonical/SI** here (L/h and L/100km); imperial display conversions (MPG, etc.)
 *  live in the UI layer (`shared/lib/units.ts`). Two data paths, in order of preference:
 *
 *   1. **Fuel-rate PID `015E`** (litres/hour) when the ECU supports it — the direct, accurate figure.
 *   2. **MAF `0110` (g/s) + fuel type** — derive fuel mass flow from air mass flow and the fuel's
 *      stoichiometric air-fuel ratio, then a volume flow from its density. The classic OBD2 estimate.
 *
 *  Instantaneous L/100km needs speed (`010D`); at a standstill it is undefined (division by zero), so
 *  we report fuel **flow** (L/h) only. See docs/features/live-data.md. */

/** Mirrors `Fuel` in shared/vehicles/types.ts (kept structural so obd-core stays vehicle-agnostic). */
export type FuelType = 'diesel' | 'petrol' | 'lpg' | 'hybrid' | 'other';

export interface FuelConstants {
  /** Stoichiometric air-fuel ratio, by mass. */
  afr: number;
  /** Fuel density in grams per litre (typical pump values at ~15 °C). */
  densityGramsPerLitre: number;
}

/** Per-fuel stoichiometry + density. Hybrid and "other" fall back to petrol-cycle numbers. */
const FUEL_CONSTANTS: Record<FuelType, FuelConstants> = {
  petrol: { afr: 14.7, densityGramsPerLitre: 745 },
  diesel: { afr: 14.5, densityGramsPerLitre: 832 },
  lpg: { afr: 15.6, densityGramsPerLitre: 535 },
  hybrid: { afr: 14.7, densityGramsPerLitre: 745 },
  other: { afr: 14.7, densityGramsPerLitre: 745 },
};

export function fuelConstants(fuel: FuelType): FuelConstants {
  return FUEL_CONSTANTS[fuel] ?? FUEL_CONSTANTS.other;
}

/** The PIDs this analysis can consume, most-preferred first. A dashboard registers these so the
 *  poll loop reads what the fuel card needs (any subset the ECU actually supports is enough). */
export const FUEL_ECONOMY_PIDS = ['015E', '0110', '010D'] as const;

/** Below this speed (km/h) we treat the car as standing still: L/100km is undefined, report L/h. */
export const STANDSTILL_KMH = 0.5;

/** Fuel mass flow ÷ AFR gives fuel mass flow; ÷ density gives volume; ×3600 gives L/h. */
export function fuelRateFromMaf(mafGramsPerSec: number, fuel: FuelType): number {
  const { afr, densityGramsPerLitre } = fuelConstants(fuel);
  const fuelGramsPerSec = mafGramsPerSec / afr;
  const litresPerSec = fuelGramsPerSec / densityGramsPerLitre;
  return litresPerSec * 3600;
}

export interface FuelEconomyInput {
  fuel: FuelType;
  /** Engine fuel rate in L/h (PID `015E`) when supported; preferred over the MAF estimate. */
  fuelRateLh?: number | null;
  /** Mass air flow in g/s (PID `0110`); used to derive fuel rate when `015E` is absent. */
  mafGramsPerSec?: number | null;
  /** Vehicle speed in km/h (PID `010D`); needed for L/100km. */
  speedKmh?: number | null;
}

export interface FuelEconomyResult {
  /** Fuel flow in litres per hour (always defined when a result is returned). */
  litresPerHour: number;
  /** Instantaneous consumption in L/100km, or null when standing still. */
  litresPer100km: number | null;
  /** Which data path produced the figure. */
  source: 'fuel-rate' | 'maf';
}

/** Instantaneous economy from one set of PID readings, or null when neither fuel path is available. */
export function instantFuelEconomy(input: FuelEconomyInput): FuelEconomyResult | null {
  let litresPerHour: number;
  let source: 'fuel-rate' | 'maf';
  if (input.fuelRateLh != null && input.fuelRateLh >= 0) {
    litresPerHour = input.fuelRateLh;
    source = 'fuel-rate';
  } else if (input.mafGramsPerSec != null && input.mafGramsPerSec >= 0) {
    litresPerHour = fuelRateFromMaf(input.mafGramsPerSec, input.fuel);
    source = 'maf';
  } else {
    return null;
  }
  const speed = input.speedKmh;
  const litresPer100km =
    speed != null && speed > STANDSTILL_KMH ? (litresPerHour / speed) * 100 : null;
  return { litresPerHour, litresPer100km, source };
}

/** Convenience: pull the needed PIDs out of a decoded snapshot (`Record<pid, number|null>`). */
export function fuelEconomyFromValues(
  values: Record<string, number | null | undefined>,
  fuel: FuelType,
): FuelEconomyResult | null {
  return instantFuelEconomy({
    fuel,
    fuelRateLh: values['015E'] ?? null,
    mafGramsPerSec: values['0110'] ?? null,
    speedKmh: values['010D'] ?? null,
  });
}

export interface FuelFlowSample {
  t: number; // epoch ms
  /** Fuel flow at this instant, in L/h. */
  litresPerHour: number;
  /** Speed at this instant in km/h, or null. */
  speedKmh: number | null;
}

export interface FuelAverage {
  /** Total fuel consumed over the window, in litres (trapezoidal integration of flow over time). */
  litres: number;
  /** Distance covered over the window, in km (trapezoidal integration of speed over time). */
  km: number;
  /** Average consumption in L/100km, or null when distance is ~0 (idled the whole window). */
  litresPer100km: number | null;
  /** Average fuel flow in L/h over the elapsed time, or null for a zero-length window. */
  litresPerHour: number | null;
}

/** Windowed average: integrate fuel flow (→ litres) and speed (→ km) over the sample timeline. */
export function averageFuelEconomy(samples: FuelFlowSample[]): FuelAverage {
  let litres = 0;
  let km = 0;
  let elapsedH = 0;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    const dtH = (b.t - a.t) / 3_600_000;
    if (dtH <= 0) continue;
    litres += ((a.litresPerHour + b.litresPerHour) / 2) * dtH;
    elapsedH += dtH;
    if (a.speedKmh != null && b.speedKmh != null) {
      km += ((a.speedKmh + b.speedKmh) / 2) * dtH;
    }
  }
  const litresPer100km = km > 0 ? (litres / km) * 100 : null;
  const litresPerHour = elapsedH > 0 ? litres / elapsedH : null;
  return { litres, km, litresPer100km, litresPerHour };
}

/** Fuel average directly from trip samples: derive per-sample flow (via `015E`/`0110`) then integrate. */
export function tripFuelAverage(
  samples: { t: number; values: Record<string, number | null> }[],
  fuel: FuelType,
): FuelAverage {
  const flow: FuelFlowSample[] = [];
  for (const s of samples) {
    const r = fuelEconomyFromValues(s.values, fuel);
    if (r) flow.push({ t: s.t, litresPerHour: r.litresPerHour, speedKmh: s.values['010D'] ?? null });
  }
  return averageFuelEconomy(flow);
}
