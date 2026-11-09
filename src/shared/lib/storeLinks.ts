/** Store links (plan 30): where **Settings → About → Rate this app** sends the user, and the public
 *  listing URLs the README badges point at. Pure: the identifiers come from app.json through
 *  `appInfo.ts`. */

export interface StoreIds {
  /** `expo.android.package`, e.g. `com.bolidtester.app`. */
  androidPackage: string;
  /** The numeric App Store id (App Store Connect → App Information → Apple ID), or null until the
   *  owner has created the app record and set `expo.extra.appStoreId`. */
  appStoreId: string | null;
}

/** The app's public Google Play page. */
export function playStoreUrl(androidPackage: string): string {
  return `https://play.google.com/store/apps/details?id=${encodeURIComponent(androidPackage)}`;
}

/** The app's public App Store page, or null without an App Store id. */
export function appStoreUrl(appStoreId: string | null): string | null {
  return appStoreId && /^\d+$/.test(appStoreId)
    ? `https://apps.apple.com/app/id${appStoreId}`
    : null;
}

export interface RateLinks {
  /** The store app's own URL scheme (opens the store app on the review page). */
  primary: string;
  /** The web page, for when the store app is missing (an emulator without Play, a de-Googled
   *  phone). */
  fallback: string;
}

/** What **Rate this app** opens on `os` (React Native's `Platform.OS`), or null when there is
 *  nothing to rate — the web build, or iOS before the App Store id exists — and the button is
 *  hidden. */
export function rateAppLinks(os: string, ids: StoreIds): RateLinks | null {
  if (os === 'android') {
    return {
      primary: `market://details?id=${encodeURIComponent(ids.androidPackage)}`,
      fallback: playStoreUrl(ids.androidPackage),
    };
  }
  if (os === 'ios') {
    const web = appStoreUrl(ids.appStoreId);
    if (!web) return null;
    return {
      primary: `itms-apps://apps.apple.com/app/id${ids.appStoreId}?action=write-review`,
      fallback: `${web}?action=write-review`,
    };
  }
  return null;
}
