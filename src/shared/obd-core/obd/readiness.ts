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
// Exported so the drive-cycle coach (./driveCycle) can be validated against the canonical name list.
export const SPARK_MONITOR_NAMES = [
  'Catalyst',
  'Heated catalyst',
  'Evaporative system',
  'Secondary air system',
  'A/C refrigerant',
  'Oxygen sensor',
  'Oxygen sensor heater',
  'EGR system',
];
export const COMPRESSION_MONITOR_NAMES = [
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

  const names = ignition === 'compression' ? COMPRESSION_MONITOR_NAMES : SPARK_MONITOR_NAMES;
  for (let i = 0; i < 8; i++) {
    if (!names[i]) continue; // reserved slot
    const supported = (c & (1 << i)) !== 0;
    const incomplete = (d & (1 << i)) !== 0;
    monitors.push({ id: `nc${i}`, name: names[i], supported, complete: supported && !incomplete });
  }

  return { milOn: (a & 0x80) !== 0, dtcCount: a & 0x7f, ignition, monitors };
}

export interface ReadinessDiff {
  /** Supported monitors that flipped incomplete → complete between `prev` and `next`. */
  becameReady: Monitor[];
  /** True only on the rising edge where the LAST remaining incomplete monitor just completed
   *  (prev had ≥1 incomplete supported monitor; next has none). */
  becameAllReady: boolean;
}

/** Edge-detect readiness progress between two reads. Pure — the drive-cycle coach (6b.9) uses it to
 *  fire a notification the moment a monitor completes, and once when the whole set is finally ready.
 *  With no previous read (first sample) nothing has "become" ready yet — it only sets the baseline.
 *  Monitors are matched by their stable `id`, so a monitor absent from `prev` is never reported. */
export function diffReadiness(prev: MonitorStatus | null, next: MonitorStatus): ReadinessDiff {
  const incomplete = (s: MonitorStatus) => s.monitors.filter((m) => m.supported && !m.complete);
  const nextIncompleteCount = incomplete(next).length;
  if (!prev) return { becameReady: [], becameAllReady: false };
  const prevIncompleteIds = new Set(incomplete(prev).map((m) => m.id));
  const becameReady = next.monitors.filter(
    (m) => m.supported && m.complete && prevIncompleteIds.has(m.id),
  );
  const becameAllReady = prevIncompleteIds.size > 0 && nextIncompleteCount === 0;
  return { becameReady, becameAllReady };
}
