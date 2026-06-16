/** Pure maintenance-logbook math: service items, log entries, and "what's due" computation from an
 *  odometer + dates. No persistence here (the feature layer stores entries via expo-file-system). The
 *  odometer is NOT a standard OBD2 PID (it lives on the cluster), so mileage is user-entered, with an
 *  optional projection from average usage. See docs/features/maintenance-log.md. */

export interface ServiceItem {
  id: string;
  name: string;
  intervalKm?: number;
  intervalMonths?: number;
  note?: string;
}

export interface LogEntry {
  id: string;
  itemId: string;
  date: number; // epoch ms the service was performed
  odoKm: number; // odometer at the time
  note?: string;
}

export type DueStatus = 'ok' | 'soon' | 'overdue' | 'unknown';

export interface DueInfo {
  itemId: string;
  name: string;
  status: DueStatus;
  dueInKm: number | null; // negative ⇒ overdue by that many km
  dueInDays: number | null; // negative ⇒ overdue by that many days
  lastOdoKm: number | null;
  lastDate: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_MS = 30 * DAY_MS;

/** A sensible default catalogue, biased toward diesel ownership (timing belt, fuel filter, DPF). */
export const DEFAULT_SERVICE_ITEMS: ServiceItem[] = [
  { id: 'engine-oil', name: 'Engine oil & filter', intervalKm: 15000, intervalMonths: 12 },
  { id: 'fuel-filter', name: 'Fuel filter (diesel)', intervalKm: 30000, intervalMonths: 24 },
  { id: 'air-filter', name: 'Air filter', intervalKm: 60000, intervalMonths: 48 },
  { id: 'cabin-filter', name: 'Cabin/pollen filter', intervalKm: 30000, intervalMonths: 12 },
  { id: 'timing-belt', name: 'Timing belt + water pump', intervalKm: 120000, intervalMonths: 120 },
  { id: 'brake-fluid', name: 'Brake fluid', intervalMonths: 24 },
  { id: 'coolant', name: 'Coolant', intervalMonths: 60 },
  { id: 'dpf-check', name: 'DPF inspection', intervalKm: 40000, intervalMonths: 24 },
];

/** Most recent log entry for an item, or null. */
export function lastEntryFor(entries: LogEntry[], itemId: string): LogEntry | null {
  let best: LogEntry | null = null;
  for (const e of entries) {
    if (e.itemId !== itemId) continue;
    if (!best || e.date > best.date) best = e;
  }
  return best;
}

export interface CurrentState {
  odoKm: number | null;
  now?: number; // epoch ms; defaults to Date.now()
}

/** Threshold for "soon": within 10 % of the km interval, or within 30 days of the time interval. */
function statusFromRemaining(dueInKm: number | null, dueInDays: number | null, item: ServiceItem): DueStatus {
  const kmSoon = item.intervalKm ? Math.max(500, item.intervalKm * 0.1) : 0;
  const overdue = (dueInKm != null && dueInKm < 0) || (dueInDays != null && dueInDays < 0);
  if (overdue) return 'overdue';
  const soon = (dueInKm != null && dueInKm <= kmSoon) || (dueInDays != null && dueInDays <= 30);
  if (soon) return 'soon';
  if (dueInKm == null && dueInDays == null) return 'unknown';
  return 'ok';
}

/** Compute due status for one item given its last entry and the current odometer/date. */
export function dueStatus(item: ServiceItem, last: LogEntry | null, current: CurrentState): DueInfo {
  const now = current.now ?? Date.now();
  let dueInKm: number | null = null;
  let dueInDays: number | null = null;

  if (last) {
    if (item.intervalKm && current.odoKm != null) {
      dueInKm = last.odoKm + item.intervalKm - current.odoKm;
    }
    if (item.intervalMonths) {
      const dueDate = last.date + item.intervalMonths * MONTH_MS;
      dueInDays = Math.round((dueDate - now) / DAY_MS);
    }
  }

  return {
    itemId: item.id,
    name: item.name,
    status: last ? statusFromRemaining(dueInKm, dueInDays, item) : 'unknown',
    dueInKm,
    dueInDays,
    lastOdoKm: last?.odoKm ?? null,
    lastDate: last?.date ?? null,
  };
}

/** Due status for every item in a catalogue. */
export function computeDue(items: ServiceItem[], entries: LogEntry[], current: CurrentState): DueInfo[] {
  return items.map((it) => dueStatus(it, lastEntryFor(entries, it.id), current));
}

/** Project today's odometer from the last known reading and an average yearly distance (km/yr).
 *  Approximate — used only to pre-fill the odometer field, never to claim an exact mileage. */
export function projectOdometer(lastOdoKm: number, lastDate: number, kmPerYear: number, now = Date.now()): number {
  const years = Math.max(0, (now - lastDate) / (365 * DAY_MS));
  return Math.round(lastOdoKm + years * kmPerYear);
}
