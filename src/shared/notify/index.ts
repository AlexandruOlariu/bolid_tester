/** Thin, dependency-tolerant wrapper around expo-notifications. The decision of *whether* to notify
 *  is pure (obd-core/analysis/notifications); this just delivers. Safe no-op when the native module
 *  or permission is unavailable (tests, web). Lives in shared so features don't depend on each other.
 *
 *  The native module is loaded via a variable specifier so this file type-checks with or without the
 *  optional dependency installed; install it on a dev machine with `npx expo install`. */
import { NotifPrefs, NotifEvent, filterNotifications } from '@/shared/obd-core';
import { logError } from '@/shared/state/errorLogStore';

const NOTIFICATIONS_MODULE = 'expo-notifications';

/** Load expo-notifications, or null when it is simply not installed (tests / web). A missing module is
 *  an expected no-op and must NOT be logged; only a present-but-failing API call is a real failure. */
async function loadNotifications(): Promise<any> {
  try {
    return await import(NOTIFICATIONS_MODULE);
  } catch {
    return null;
  }
}

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
  const Notifications = await loadNotifications();
  if (!Notifications) return;
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title: out.title, body: out.body ?? '' },
      trigger: null,
    });
  } catch (e) {
    logError({ source: 'notifications', error: e, severity: 'warning', context: { category: event.category } });
  }
}

/** Schedule a date-based local notification (used by maintenance reminders). Returns an id or null. */
export async function scheduleAt(title: string, body: string, date: Date): Promise<string | null> {
  const Notifications = await loadNotifications();
  if (!Notifications) return null;
  try {
    return await Notifications.scheduleNotificationAsync({
      content: { title, body },
      trigger: { type: 'date', date },
    });
  } catch (e) {
    logError({ source: 'notifications/schedule', error: e, severity: 'warning' });
    return null;
  }
}

export async function requestNotificationPermission(): Promise<boolean> {
  const Notifications = await loadNotifications();
  if (!Notifications) return false;
  try {
    const { status } = await Notifications.requestPermissionsAsync();
    return status === 'granted';
  } catch (e) {
    logError({ source: 'notifications/permission', error: e, severity: 'warning' });
    return false;
  }
}
