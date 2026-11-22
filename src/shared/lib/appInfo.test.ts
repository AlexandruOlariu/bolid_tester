import { readFileSync } from 'fs';
import { join } from 'path';
import { APP_NAME, APP_VERSION, FEEDBACK_EMAIL, PRIVACY_POLICY_URL } from './appInfo';

const root = join(__dirname, '..', '..', '..');
const readJson = (file: string) => JSON.parse(readFileSync(join(root, file), 'utf8'));

describe('appInfo', () => {
  it('exposes the app.json name and version', () => {
    expect(APP_NAME).toBe('Bolid Tester');
    expect(APP_VERSION).toBe(readJson('app.json').expo.version);
  });

  it('app.json expo.version equals package.json version (one version, docs/release.md)', () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(APP_VERSION).toBe(readJson('package.json').version);
  });

  it('OTA updates are pinned to the app version and never checked silently at launch', () => {
    const expo = readJson('app.json').expo;
    expect(expo.runtimeVersion).toEqual({ policy: 'appVersion' });
    expect(expo.updates.checkAutomatically).toBe('ON_ERROR_RECOVERY');
    expect(expo.updates.requestHeaders['expo-channel-name']).toBe('production');
    expect(expo.plugins).toContain('./plugins/withReleaseSigning');
  });

  it('EAS build profiles publish to their own update channels', () => {
    const eas = readJson('eas.json');
    expect(eas.build.preview.channel).toBe('preview');
    expect(eas.build.production.channel).toBe('production');
  });

  it('ships no feedback email address (the Email button stays hidden) and links the policy', () => {
    expect(readJson('app.json').expo.extra?.feedbackEmail).toBeUndefined();
    expect(FEEDBACK_EMAIL).toBeNull();
    expect(PRIVACY_POLICY_URL).toMatch(/docs\/privacy-policy\.md$/);
  });
});
