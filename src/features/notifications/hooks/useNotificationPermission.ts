import { useCallback, useEffect } from 'react';
import { Linking, Platform } from 'react-native';
import {
  readNotificationPermission,
  requestNotificationPermission,
  type NotificationPermission,
} from '@/shared/notify';
import { logError } from '@/shared/state/errorLogStore';
import { useNotificationsStore } from '../model/notificationsStore';

export interface NotificationPermissionApi {
  permission: NotificationPermission;
  /** Show the system prompt (once; see `requestNotificationPermission`) and store the result. */
  request: () => Promise<void>;
  /** False on web: the browser has no app-settings page to open, and react-native-web's `Linking`
   *  has no `openSettings` (calling it throws). The screen shows browser wording instead. */
  canOpenSettings: boolean;
  /** The app's page in the system Settings — the only fix once iOS has a denial on record.
   *  A no-op where `canOpenSettings` is false. */
  openSettings: () => void;
}

/** The live OS notification permission (plan 09): read on mount without prompting, so a permission
 *  granted or revoked outside the app shows correctly; never persisted. */
export function useNotificationPermission(): NotificationPermissionApi {
  const permission = useNotificationsStore((s) => s.permission);
  const setPermission = useNotificationsStore((s) => s.setPermission);

  useEffect(() => {
    let live = true;
    void readNotificationPermission().then((p) => {
      if (live) setPermission(p);
    });
    return () => {
      live = false;
    };
  }, [setPermission]);

  const request = useCallback(async () => {
    const granted = await requestNotificationPermission();
    setPermission(granted ? 'granted' : await readNotificationPermission());
  }, [setPermission]);

  const canOpenSettings = Platform.OS !== 'web' && typeof Linking.openSettings === 'function';

  const openSettings = useCallback(() => {
    if (Platform.OS === 'web' || typeof Linking.openSettings !== 'function') return;
    Linking.openSettings().catch((e: unknown) =>
      logError({ source: 'notifications/settings', error: e, severity: 'warning' }),
    );
  }, []);

  return { permission, request, canOpenSettings, openSettings };
}
