/** Thin, dependency-tolerant wrapper around expo-notifications. The decision of *whether* to notify
 *  is pure (obd-core/analysis/notifications); this just delivers. Safe no-op when the native module
 *  or permission is unavailable (tests, web). Lives in shared so features don't depend on each other.
 *
 *  The native module is loaded via a variable specifier so this file type-checks with or without the
 *  optional dependency installed; install it on a dev machine with `npx expo install`. */
import { NotifPrefs, NotifEvent, filterNotifications } from '@/shared/obd-core';

const NOTIFICATIONS_MODULE = 'expo-notifications';

let prefs: NotifPrefs = {
  categories: { alert: true, connection: true, diagnostic: true, trip: true, maintenance: true },
};

export function setNotifPrefs(p: NotifPrefs): void {
  prefs = p;
}

export function getNotifPrefs(): NotifPrefs {
  return prefs;
}

/** Deliver a single event through the user's prefs/quiet-hours filter. */
export async function notify(ev: Omit<NotifEvent, 'id' | 'ts'> & { id?: string }): Promise<void> {
  const event: NotifEvent = {
    id: ev.id ?? `${ev.category}-${Date.now()}`,
    ts: Date.now(),
    category: ev.category,
    severity: ev.severity,
    title: ev.title,
    body: ev.body,
  };
  const [out] = filterNotifications([event], prefs);
  if (!out) return;
  try {
    const Notifications = await import(NOTIFICATIONS_MODULE);
    await Notifications.scheduleNotificationAsync({
      content: { title: out.title, body: out.body ?? '' },
      trigger: null,
    });
  } catch {
    // expo-notifications unavailable — no-op.
  }
}

/** Schedule a date-based local notification (used by maintenance reminders). Returns an id or null. */
export async function scheduleAt(title: string, body: string, date: Date): Promise<string | null> {
  try {
    const Notifications = await import(NOTIFICATIONS_MODULE);
    return await Notifications.scheduleNotificationAsync({
      content: { title, body },
      trigger: { type: 'date', date },
    });
  } catch {
    return null;
  }
}

export async function requestNotificationPermission(): Promise<boolean> {
  try {
    const Notifications = await import(NOTIFICATIONS_MODULE);
    const { status } = await Notifications.requestPermissionsAsync();
    return status === 'granted';
  } catch {
    return false;
  }
}
