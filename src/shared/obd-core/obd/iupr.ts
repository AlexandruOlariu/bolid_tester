/** IUPR — In-Use Performance Ratios (Mode 09 PID 08 spark / PID 0B compression). For each
 *  monitor: how often it COMPLETED vs how often the driving CONDITIONS for it were met. Great
 *  used-car signal: a healthy, driven car accumulates counts; near-zero general denominators on
 *  an old car mean the memory was recently cleared. */

export interface IuprMonitor {
  name: string;
  completions: number;
  conditions: number;
  /** completions / conditions, or null when conditions = 0. */
  ratio: number | null;
}

export interface IuprReport {
  variant: 'spark' | 'compression';
  /** OBD monitoring conditions encountered (general denominator). */
  obdConditions: number;
  ignitionCycles: number;
  monitors: IuprMonitor[];
}

const SPARK_MONITORS = [
  'Catalyst bank 1',
  'Catalyst bank 2',
  'O2 sensor bank 1',
  'O2 sensor bank 2',
  'EGR / VVT',
  'Secondary air',
  'Evap system',
];

const COMPRESSION_MONITORS = [
  'NMHC catalyst',
  'NOx catalyst',
  'NOx adsorber',
  'PM filter',
  'Exhaust gas sensor',
  'EGR / VVT',
  'Boost pressure',
];

/** Decode the data items after [0x49, 0x08|0x0B, count]: 2-byte big-endian counters, first two
 *  being OBDCOND and IGNCNTR, then completion/condition pairs. Tolerates short lists. */
export function decodeIupr(bytes: number[]): IuprReport | null {
  if (bytes.length < 3 || bytes[0] !== 0x49) return null;
  const pid = bytes[1];
  const variant = pid === 0x08 ? 'spark' : pid === 0x0b ? 'compression' : null;
  if (!variant) return null;
  const names = variant === 'spark' ? SPARK_MONITORS : COMPRESSION_MONITORS;
  const items: number[] = [];
  for (let i = 3; i + 1 < bytes.length; i += 2) items.push(bytes[i] * 256 + bytes[i + 1]);
  if (items.length < 2) return null;
  const [obdConditions, ignitionCycles, ...rest] = items;
  const monitors: IuprMonitor[] = [];
  for (let i = 0; i + 1 < rest.length && monitors.length < names.length; i += 2) {
    const completions = rest[i];
    const conditions = rest[i + 1];
    monitors.push({
      name: names[monitors.length],
      completions,
      conditions,
      ratio: conditions > 0 ? Math.round((completions / conditions) * 100) / 100 : null,
    });
  }
  return { variant, obdConditions, ignitionCycles, monitors };
}
