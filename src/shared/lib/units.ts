/** Display-time unit conversion. obd-core keeps every decoded value in SI/metric (km/h, °C, km, kPa,
 *  L/100km) — this layer converts a value+unit pair to the user's chosen system only when rendering,
 *  so the canonical data model never changes. Pure and dependency-free, so it is unit-tested in
 *  isolation. Unknown units pass through untouched. See docs/features/settings.md. */

export type UnitSystem = 'metric' | 'imperial';

export interface Measure {
  value: number | null;
  unit: string;
}

/** Litres-per-100km ↔ US MPG constant: mpg = 235.214583 / (L/100km). */
const L100_TO_MPG_US = 235.214583;

/** One conversion: metric unit → { imperial unit, transform }. A transform returning null means the
 *  input maps to an undefined imperial value (e.g. 0 L/100km → infinite MPG), rendered as "—". */
interface Conversion {
  unit: string;
  fn: (v: number) => number | null;
}

const CONVERSIONS: Record<string, Conversion> = {
  'km/h': { unit: 'mph', fn: (v) => v / 1.609344 },
  '°C': { unit: '°F', fn: (v) => v * 1.8 + 32 },
  km: { unit: 'mi', fn: (v) => v / 1.609344 },
  kPa: { unit: 'psi', fn: (v) => v / 6.894757 },
  bar: { unit: 'psi', fn: (v) => v * 14.503774 },
  // Fuel economy: lower L/100km is better but higher MPG is better, so this is a reciprocal, not a
  // scale. Zero/negative consumption has no finite MPG.
  'L/100km': { unit: 'mpg', fn: (v) => (v > 0 ? L100_TO_MPG_US / v : null) },
};

/** Convert a value+unit pair to the given system. Metric is the identity. Imperial converts the units
 *  in `CONVERSIONS`; anything else (rpm, %, V, g/s, L/h, °, …) passes through unchanged. A null value
 *  keeps the (possibly relabelled) unit so headers/gauges still show the right label with no reading. */
export function convert(value: number | null, unit: string, system: UnitSystem): Measure {
  if (system === 'metric') return { value, unit };
  const c = CONVERSIONS[unit];
  if (!c) return { value, unit };
  if (value === null) return { value: null, unit: c.unit };
  return { value: c.fn(value), unit: c.unit };
}

/** Convenience for the common "just the number" case, keeping the caller's own unit label. */
export function convertValue(value: number | null, unit: string, system: UnitSystem): number | null {
  return convert(value, unit, system).value;
}

/** The imperial label for a metric unit (or the same unit when there is no conversion). Handy for
 *  static labels (gauge captions) where the numeric conversion happens separately. */
export function displayUnit(unit: string, system: UnitSystem): string {
  if (system === 'metric') return unit;
  return CONVERSIONS[unit]?.unit ?? unit;
}
