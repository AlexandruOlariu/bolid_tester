/** Decode Mode 01 PID 01 — "monitor status since DTCs cleared" (MIL, DTC count, readiness monitors).
 *  See docs/obd2-reference.md and docs/features/fault-codes.md. */

export interface Monitor {
  id: string;
  name: string;
  supported: boolean;
  complete: boolean;
}

export interface MonitorStatus {
  milOn: boolean;
  dtcCount: number;
  ignition: 'spark' | 'compression';
  monitors: Monitor[];
}

// Continuous monitors live in byte B: bit n = supported, bit n+4 = incomplete.
const CONTINUOUS = [
  { id: 'misfire', name: 'Misfire', sup: 0, inc: 4 },
  { id: 'fuel', name: 'Fuel system', sup: 1, inc: 5 },
  { id: 'components', name: 'Components', sup: 2, inc: 6 },
];

// Non-continuous monitors: byte C = supported, byte D = incomplete (names differ by ignition type).
const SPARK_MONITORS = [
  'Catalyst',
  'Heated catalyst',
  'Evaporative system',
  'Secondary air system',
  'A/C refrigerant',
  'Oxygen sensor',
  'Oxygen sensor heater',
  'EGR system',
];
const COMPRESSION_MONITORS = [
  'NMHC catalyst',
  'NOx/SCR monitor',
  '',
  'Boost pressure',
  '',
  'Exhaust gas sensor',
  'PM filter',
  'EGR/VVT system',
];

export function decodeMonitorStatus(data: number[]): MonitorStatus {
  const a = data[0] ?? 0;
  const b = data[1] ?? 0;
  const c = data[2] ?? 0;
  const d = data[3] ?? 0;

  const ignition: MonitorStatus['ignition'] = (b & 0x08) !== 0 ? 'compression' : 'spark';
  const monitors: Monitor[] = [];

  for (const m of CONTINUOUS) {
    const supported = (b & (1 << m.sup)) !== 0;
    const incomplete = (b & (1 << m.inc)) !== 0;
    monitors.push({ id: m.id, name: m.name, supported, complete: supported && !incomplete });
  }

  const names = ignition === 'compression' ? COMPRESSION_MONITORS : SPARK_MONITORS;
  for (let i = 0; i < 8; i++) {
    if (!names[i]) continue; // reserved slot
    const supported = (c & (1 << i)) !== 0;
    const incomplete = (d & (1 << i)) !== 0;
    monitors.push({ id: `nc${i}`, name: names[i], supported, complete: supported && !incomplete });
  }

  return { milOn: (a & 0x80) !== 0, dtcCount: a & 0x7f, ignition, monitors };
}
