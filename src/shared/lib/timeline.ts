/** The per-car timeline (plan 16): one chronological list that merges every source of "what happened
 *  to this car" — AI runs, fault-code checks, saved module scans, trips, maintenance entries, coding
 *  backups and generated reports. Pure: it imports nothing from state or features; the History
 *  slice's adapters (`features/history/api/timelineSources.ts`) turn each store's records into
 *  `TimelineItem`s and this module flattens, filters, dedupes, sorts and groups them by day.
 *  See docs/features/history.md. */

export type TimelineKind = 'ai' | 'dtc' | 'scan' | 'trip' | 'maintenance' | 'backup' | 'report';

/** Every kind, in the order the kind chips show them. */
export const TIMELINE_KINDS: readonly TimelineKind[] = [
  'ai',
  'dtc',
  'scan',
  'trip',
  'maintenance',
  'backup',
  'report',
];

export type TimelineTone = 'ok' | 'warn' | 'bad' | 'neutral';

/** A navigation target the UI resolves (`router.push({ pathname: route, params })`). */
export interface TimelineLink {
  route: string;
  params?: Record<string, string>;
}

export interface TimelineItem {
  /** `${kind}:${sourceId}` — unique across sources. */
  id: string;
  kind: TimelineKind;
  ts: number;
  /** The car's grouping key (`historyVehicleKey(...)`, computed by the adapter). */
  vehicleKey: string;
  /** Chip / row text for the car. */
  vehicleLabel: string;
  /** e.g. "Fault-code check", "Auto-scan · 2 faults", "Trip · 23.4 km". */
  title: string;
  /** One line of detail. */
  subtitle?: string;
  tone: TimelineTone;
  /** Where a tap goes. Absent for items the screen handles itself (AI report sheet, report
   *  re-share) or that have nowhere to go (a fault-code check). */
  link?: TimelineLink;
  /** The source record's id, for renderers that need the full object (AI report, report file). */
  sourceId: string;
}

export interface TimelineDay {
  /** Local calendar day, `YYYY-MM-DD`. */
  day: string;
  items: TimelineItem[];
}

export interface TimelineFilter {
  /** Only these kinds; absent or empty = every kind. */
  kinds?: TimelineKind[];
  /** Only this car; absent or `'all'` = every car. */
  vehicleKey?: string | 'all';
  /** Inclusive lower bound (epoch ms). */
  from?: number;
  /** Inclusive upper bound (epoch ms). */
  to?: number;
  /** Case-insensitive substring of the title or subtitle; blank = no text filter. */
  query?: string;
}

/** Build the unique item id of a source record. */
export function timelineId(kind: TimelineKind, sourceId: string): string {
  return `${kind}:${sourceId}`;
}

function matches(item: TimelineItem, f: TimelineFilter, query: string): boolean {
  if (f.kinds && f.kinds.length > 0 && !f.kinds.includes(item.kind)) return false;
  if (f.vehicleKey && f.vehicleKey !== 'all' && item.vehicleKey !== f.vehicleKey) return false;
  if (f.from !== undefined && item.ts < f.from) return false;
  if (f.to !== undefined && item.ts > f.to) return false;
  if (query) {
    const hay = `${item.title}\n${item.subtitle ?? ''}`.toLowerCase();
    if (!hay.includes(query)) return false;
  }
  return true;
}

/** Flatten the per-source lists, apply the filter, drop duplicate ids (the first one wins) and sort
 *  newest first (equal timestamps keep their input order). */
export function mergeTimeline(
  items: TimelineItem[][],
  filter: TimelineFilter = {},
): TimelineItem[] {
  const query = (filter.query ?? '').trim().toLowerCase();
  const seen = new Set<string>();
  const out: TimelineItem[] = [];
  for (const list of items) {
    for (const item of list) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      if (matches(item, filter, query)) out.push(item);
    }
  }
  // Array.prototype.sort is stable (ES2019+), so ties keep the source order.
  return out.sort((a, b) => b.ts - a.ts);
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** The local calendar day of a timestamp, `YYYY-MM-DD`. */
export function localDayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Group items by local calendar day: days newest first, items in each day newest first. */
export function groupByDay(items: TimelineItem[], _tz: 'local' = 'local'): TimelineDay[] {
  const byDay = new Map<string, TimelineItem[]>();
  for (const item of items) {
    const day = localDayKey(item.ts);
    const list = byDay.get(day);
    if (list) list.push(item);
    else byDay.set(day, [item]);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([day, list]) => ({ day, items: [...list].sort((a, b) => b.ts - a.ts) }));
}

/** How many items of each kind (every kind present, zero when absent). */
export function summarizeTimeline(items: TimelineItem[]): Record<TimelineKind, number> {
  const counts = Object.fromEntries(TIMELINE_KINDS.map((k) => [k, 0])) as Record<
    TimelineKind,
    number
  >;
  for (const item of items) counts[item.kind] += 1;
  return counts;
}
