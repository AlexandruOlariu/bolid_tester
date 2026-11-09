import { appStoreUrl, playStoreUrl, rateAppLinks } from './storeLinks';
import { ANDROID_PACKAGE, APP_STORE_ID } from './appInfo';

describe('store links (plan 30)', () => {
  it('Android: the Play Store app first, the web page as the fallback', () => {
    expect(
      rateAppLinks('android', { androidPackage: 'com.bolidtester.app', appStoreId: null }),
    ).toEqual({
      primary: 'market://details?id=com.bolidtester.app',
      fallback: 'https://play.google.com/store/apps/details?id=com.bolidtester.app',
    });
  });

  it('iOS: the App Store review page once the App Store id exists, nothing before', () => {
    expect(
      rateAppLinks('ios', { androidPackage: 'com.bolidtester.app', appStoreId: null }),
    ).toBeNull();
    expect(
      rateAppLinks('ios', { androidPackage: 'com.bolidtester.app', appStoreId: '1234567890' }),
    ).toEqual({
      primary: 'itms-apps://apps.apple.com/app/id1234567890?action=write-review',
      fallback: 'https://apps.apple.com/app/id1234567890?action=write-review',
    });
    expect(appStoreUrl('not-a-number')).toBeNull();
  });

  it('the web build has nothing to rate', () => {
    expect(
      rateAppLinks('web', { androidPackage: 'com.bolidtester.app', appStoreId: '1' }),
    ).toBeNull();
  });

  it('reads the identifiers from app.json', () => {
    expect(ANDROID_PACKAGE).toBe('com.bolidtester.app');
    expect(playStoreUrl(ANDROID_PACKAGE)).toBe(
      'https://play.google.com/store/apps/details?id=com.bolidtester.app',
    );
    // Null until the owner creates the App Store Connect record (store/README.md), then digits.
    expect(APP_STORE_ID === null || /^\d+$/.test(APP_STORE_ID)).toBe(true);
  });
});
