/** The iOS build configuration (plan 09, docs/phase2-mobile-app.md → iOS). A missing usage string
 *  crashes the app the moment iOS would show the prompt, and a stray Always-location or background
 *  claim draws an App Review rejection, so the keys are pinned here. */
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..', '..', '..');
const readJson = (file: string) => JSON.parse(readFileSync(join(root, file), 'utf8'));

type Plugin = string | [string, Record<string, unknown>];
const expo = readJson('app.json').expo;
const eas = readJson('eas.json');

function pluginOptions(name: string): Record<string, unknown> | undefined {
  const entry = (expo.plugins as Plugin[]).find((p) => (Array.isArray(p) ? p[0] : p) === name);
  if (entry === undefined) return undefined;
  return Array.isArray(entry) ? entry[1] : {};
}

const LOCATION_TEXT =
  'Bolid Tester records a GPS track alongside OBD2 data while you record a trip.';

describe('iOS app config (app.json)', () => {
  it('has a bundle id and a build number seed', () => {
    expect(expo.ios.bundleIdentifier).toBe('com.bolidtester.app');
    expect(expo.ios.buildNumber).toBe('1');
  });

  it('declares every usage string the app can trigger, each a full sentence', () => {
    const plist = expo.ios.infoPlist;
    for (const key of [
      'NSBluetoothAlwaysUsageDescription',
      'NSBluetoothPeripheralUsageDescription',
      'NSLocationWhenInUseUsageDescription',
      'NSLocalNetworkUsageDescription',
    ]) {
      expect(typeof plist[key]).toBe('string');
      expect(plist[key]).toMatch(/^Bolid Tester .+\.$/);
    }
    expect(plist.NSLocationWhenInUseUsageDescription).toBe(LOCATION_TEXT);
  });

  it('answers the export-compliance question (exempt HTTPS only)', () => {
    expect(expo.ios.infoPlist.ITSAppUsesNonExemptEncryption).toBe(false);
  });

  it('asks for when-in-use location only: no Always, motion or background strings', () => {
    const loc = pluginOptions('expo-location');
    expect(loc).toBeDefined();
    expect(loc?.locationWhenInUsePermission).toBe(LOCATION_TEXT);
    expect(loc?.locationAlwaysAndWhenInUsePermission).toBe(false);
    expect(loc?.locationAlwaysPermission).toBe(false);
    expect(loc?.motionUsagePermission).toBe(false);
    expect(loc?.isIosBackgroundLocationEnabled).toBe(false);
    expect(loc?.isAndroidBackgroundLocationEnabled).toBe(false);
    const plist = expo.ios.infoPlist;
    expect(plist.NSLocationAlwaysUsageDescription).toBeUndefined();
    expect(plist.NSLocationAlwaysAndWhenInUseUsageDescription).toBeUndefined();
    expect(expo.ios.infoPlist.UIBackgroundModes).toBeUndefined();
  });

  it('configures local notifications and keeps BLE out of the background', () => {
    expect(pluginOptions('expo-notifications')).toEqual({ color: '#2bb673' });
    expect(pluginOptions('react-native-ble-plx')?.isBackgroundEnabled).toBe(false);
  });

  it('keeps the release-signing plugin last, after the iOS plugins', () => {
    const names = (expo.plugins as Plugin[]).map((p) => (Array.isArray(p) ? p[0] : p));
    expect(names[names.length - 1]).toBe('./plugins/withReleaseSigning');
  });
});

describe('iOS EAS profiles (eas.json)', () => {
  it('keeps the build number on EAS and auto-increments production builds', () => {
    expect(eas.cli.appVersionSource).toBe('remote');
    expect(eas.build.production.autoIncrement).toBe(true);
    expect(eas.build.production.channel).toBe('production');
  });

  it('builds internal iOS profiles for real devices, not the simulator', () => {
    expect(eas.build.preview.distribution).toBe('internal');
    expect(eas.build.preview.ios).toEqual({ simulator: false });
    expect(eas.build.development.ios).toEqual({ simulator: false });
  });

  it('has an iOS submit profile', () => {
    expect(eas.submit.production.ios).toBeDefined();
  });
});
