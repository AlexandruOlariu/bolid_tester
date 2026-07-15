/** Thin, dependency-tolerant wrapper around expo-updates (EAS Update / OTA). JS-only fixes ship
 *  without an APK rebuild. Loaded via a variable specifier so the app type-checks and tests with or
 *  without the native module present — same idiom as `shared/notify`. Safe no-op in Expo Go / web /
 *  tests, and whenever updates are disabled (e.g. a dev client). */
import { logError } from '@/shared/state/errorLogStore';

const UPDATES_MODULE = 'expo-updates';

export type UpdateCheck = 'available' | 'up-to-date' | 'unavailable';

/** Load expo-updates, or null when it is simply not installed. A missing module is an expected no-op
 *  and must NOT be logged; only a present-but-failing API call is a real failure. */
async function loadUpdates(): Promise<any> {
  try {
    return await import(UPDATES_MODULE);
  } catch {
    return null;
  }
}

/** Ask the update server whether a newer JS bundle is available for this runtime version. */
export async function checkForUpdate(): Promise<UpdateCheck> {
  const Updates = await loadUpdates();
  // `isEnabled` is false in Expo Go, dev clients, and when no updates URL is configured.
  if (!Updates || Updates.isEnabled === false) return 'unavailable';
  try {
    const result = await Updates.checkForUpdateAsync();
    return result?.isAvailable ? 'available' : 'up-to-date';
  } catch (e) {
    logError({ source: 'updates/check', error: e, severity: 'warning' });
    return 'unavailable';
  }
}

/** Fetch the available update and reload into it. Returns false when nothing was applied. */
export async function fetchAndReload(): Promise<boolean> {
  const Updates = await loadUpdates();
  if (!Updates || Updates.isEnabled === false) return false;
  try {
    const fetched = await Updates.fetchUpdateAsync();
    if (!fetched?.isNew) return false;
    await Updates.reloadAsync();
    return true;
  } catch (e) {
    logError({ source: 'updates/fetch', error: e, severity: 'warning' });
    return false;
  }
}
