/** Pure notification logic: derive diagnostic/connection events via edge detection, and filter
 *  events through user prefs + quiet hours. The OS call (expo-notifications) lives in the feature
 *  layer; this module decides *what* to notify. See docs/features/notifications.md. */

export type NotifCategory = 'alert' | 'connection' | 'diagnostic' | 'trip' | 'maintenance';
export type NotifSeverity = 'info' | 'warn' | 'critical';

export interface NotifEvent {
  id: string; // stable id for dedupe
  category: NotifCategory;
  severity: NotifSeverity;
  title: string;
  body?: string;
  ts: number;
}

export interface NotifPrefs {
  categories: Record<NotifCategory, boolean>;
  muted?: boolean;
  /** Quiet hours in local minutes-from-midnight; suppresses non-critical. May wrap past midnight. */
  quietHours?: { startMin: number; endMin: number };
}

/** A reduced view of the session used for diagnostic edge detection. */
export interface DiagSnapshot {
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  milOn: boolean;
  dtcCount: number;
}

/** Compare previous vs current diagnostic snapshot and emit events on rising edges only. */
export function deriveDiagnosticEvents(
  prev: DiagSnapshot | null,
  cur: DiagSnapshot,
  now: number = Date.now(),
): NotifEvent[] {
  const events: NotifEvent[] = [];
  if (!prev) return events; // first observation establishes a baseline, no notification

  if (prev.status !== 'connected' && cur.status === 'connected')
    events.push({ id: `conn-${now}`, category: 'connection', severity: 'info', title: 'Adapter connected', ts: now });
  if (prev.status === 'connected' && (cur.status === 'disconnected' || cur.status === 'error'))
    events.push({ id: `disc-${now}`, category: 'connection', severity: 'warn', title: 'Adapter disconnected', ts: now });

  if (!prev.milOn && cur.milOn)
    events.push({ id: `mil-${now}`, category: 'diagnostic', severity: 'warn', title: 'Check-engine light on', ts: now });

  if (cur.dtcCount > prev.dtcCount)
    events.push({
      id: `dtc-${now}`,
      category: 'diagnostic',
      severity: 'warn',
      title: 'New fault code',
      body: `${cur.dtcCount} stored code(s)`,
      ts: now,
    });

  return events;
}

export function isQuietHours(prefs: NotifPrefs, date: Date): boolean {
  const q = prefs.quietHours;
  if (!q) return false;
  const min = date.getHours() * 60 + date.getMinutes();
  if (q.startMin <= q.endMin) return min >= q.startMin && min < q.endMin;
  return min >= q.startMin || min < q.endMin; // wraps past midnight
}

/** Apply mute, category toggles, and quiet hours (which suppress all but `critical`). Dedupes by id. */
export function filterNotifications(
  events: NotifEvent[],
  prefs: NotifPrefs,
  now: Date = new Date(),
): NotifEvent[] {
  if (prefs.muted) return [];
  const quiet = isQuietHours(prefs, now);
  const seen = new Set<string>();
  const out: NotifEvent[] = [];
  for (const e of events) {
    if (prefs.categories[e.category] === false) continue;
    if (quiet && e.severity !== 'critical') continue;
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    out.push(e);
  }
  return out;
}

export interface MaintenanceReminder {
  id: string;
  title: string;
  dueDate?: number; // epoch ms
  dueMileageKm?: number;
  leadDays?: number;
  leadKm?: number;
  done?: boolean;
}

/** Which reminders are due now, given the date and (optional) current mileage. */
export function dueReminders(
  reminders: MaintenanceReminder[],
  now: number = Date.now(),
  mileageKm?: number,
): MaintenanceReminder[] {
  const DAY = 86_400_000;
  return reminders.filter((r) => {
    if (r.done) return false;
    const byDate = r.dueDate !== undefined && now >= r.dueDate - (r.leadDays ?? 0) * DAY;
    const byMileage =
      r.dueMileageKm !== undefined &&
      mileageKm !== undefined &&
      mileageKm >= r.dueMileageKm - (r.leadKm ?? 0);
    return byDate || byMileage;
  });
}
