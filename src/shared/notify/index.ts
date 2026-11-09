/** Thin, dependency-tolerant wrapper around expo-notifications. The decision of *whether* to notify
 *  is pure (obd-core/analysis/notifications); this just delivers. Safe no-op when the native module
 *  or permission is unavailable (tests, web). Lives in shared so features don't depend on each other.
 *
 *  The native module is loaded via a variable specifier so this file type-checks with or without the
 *  optional dependency installed; install it on a dev machine with `npx expo install`. */
import { NotifPrefs, NotifEvent, filterNotifications } from '@/shared/obd-core';
import { logError } from '@/shared/state/errorLogStore';

const NOTIFICATIONS_MODULE = 'expo-notifications';

type ModuleLoader = () => Promise<any>;
const defaultLoader: ModuleLoader = () => import(NOTIFICATIONS_MODULE);
let moduleLoader: ModuleLoader = defaultLoader;

/** Test seam: replace how expo-notifications is loaded (Jest cannot run the dynamic import); pass
 *  nothing to restore the real loader. */
export function setNotificationsModuleLoader(loader?: ModuleLoader): void {
  moduleLoader = loader ?? defaultLoader;
}

/** Load expo-notifications, or null when it is simply not installed (tests / web). A missing module is
 *  an expected no-op and must NOT be logged; only a present-but-failing API call is a real failure. */
async function loadNotifications(): Promise<any> {
  try {
    return await moduleLoader();
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
    logError({
      source: 'notifications',
      error: e,
      severity: 'warning',
      context: { category: event.category },
    });
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

/** The OS notification permission as the app shows it: `denied` means the system will not prompt
 *  again (iOS asks exactly once; a denial is fixed only in the Settings app), `unknown` that it is
 *  undetermined or cannot be read. */
export type NotificationPermission = 'unknown' | 'granted' | 'denied';

interface PermissionResponse {
  status?: string;
  granted?: boolean;
  canAskAgain?: boolean;
}

function toPermission(res: PermissionResponse | undefined): NotificationPermission {
  if (!res) return 'unknown';
  if (res.granted || res.status === 'granted') return 'granted';
  if (res.status === 'denied' && res.canAskAgain !== true) return 'denied';
  return 'unknown';
}

/** Read the live permission without ever showing a system prompt (plan 09). */
export async function readNotificationPermission(): Promise<NotificationPermission> {
  const Notifications = await loadNotifications();
  if (!Notifications) return 'unknown';
  try {
    return toPermission(await Notifications.getPermissionsAsync());
  } catch (e) {
    logError({ source: 'notifications/permission', error: e, severity: 'warning' });
    return 'unknown';
  }
}

/** Ask for permission — at most one system prompt (plan 09): already granted resolves true and a
 *  permission the OS will not ask for again resolves false, both without calling
 *  `requestPermissionsAsync` (which on iOS would silently do nothing). iOS asks for alerts and
 *  sounds only; the app sets no badge. */
export async function requestNotificationPermission(): Promise<boolean> {
  const Notifications = await loadNotifications();
  if (!Notifications) return false;
  try {
    const current = toPermission(await Notifications.getPermissionsAsync());
    if (current !== 'unknown') return current === 'granted';
    const res = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowSound: true, allowBadge: false },
    });
    return toPermission(res) === 'granted';
  } catch (e) {
    logError({ source: 'notifications/permission', error: e, severity: 'warning' });
    return false;
  }
}
