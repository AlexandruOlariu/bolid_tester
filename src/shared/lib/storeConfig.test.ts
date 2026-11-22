/** Store release configuration (plan 30, store/README.md, docs/release.md → Store rollout): the
 *  `eas submit` profile, the gitignored credential path, the app.json store metadata, and the
 *  data-safety / privacy-label sheets — every answer row must cite code that exists, so a refactor
 *  that moves a network or storage touchpoint fails here until the sheets are re-read. */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..', '..', '..');
const read = (file: string) => readFileSync(join(root, file), 'utf8');
const readJson = (file: string) => JSON.parse(read(file));

const expo = readJson('app.json').expo;
const eas = readJson('eas.json');

/** The table rows of a Markdown file whose first cell is not the header / separator. */
function tableRows(md: string, heading: string): string[] {
  const start = md.indexOf(`## ${heading}`);
  if (start < 0) throw new Error(`no "## ${heading}" section`);
  const next = md.indexOf('\n## ', start + 3);
  const section = md.slice(start, next < 0 ? undefined : next);
  return section
    .split('\n')
    .filter((l) => l.startsWith('|'))
    .slice(2); // header + separator
}

/** Backticked repository paths in a string (`src/…`, `docs/…`, `app.json`, …). */
function citedPaths(text: string): string[] {
  return [...text.matchAll(/`((?:src|docs|scripts|store)\/[^`\s]+|app\.json|eas\.json)`/g)].map(
    (m) => m[1],
  );
}

describe('eas submit (plan 30)', () => {
  it('uploads Android to the internal track as a draft, with a gitignored service-account key', () => {
    const android = eas.submit.production.android;
    expect(android.track).toBe('internal');
    expect(android.releaseStatus).toBe('draft');
    expect(android.serviceAccountKeyPath).toMatch(/^\.\/secrets\/.+\.json$/);
    const ignored = read('.gitignore')
      .split(/\r?\n/)
      .map((l) => l.trim());
    expect(ignored).toContain('secrets/');
  });

  it('commits no Apple credentials (the owner passes them at submit time)', () => {
    const ios = eas.submit.production.ios as Record<string, unknown>;
    for (const key of ['appleId', 'ascAppId', 'appleTeamId', 'ascApiKeyPath']) {
      expect(ios[key]).toBeUndefined();
    }
  });
});

describe('app.json store metadata (plan 30)', () => {
  it('has a description and the project URL', () => {
    expect(typeof expo.description).toBe('string');
    expect(expo.description.length).toBeGreaterThan(40);
    expect(expo.githubUrl).toBe('https://github.com/AlexandruOlariu/bolid_tester');
  });

  it('keeps the package / bundle id the store records are created with', () => {
    expect(expo.android.package).toBe('com.bolidtester.app');
    expect(expo.ios.bundleIdentifier).toBe('com.bolidtester.app');
  });
});

describe('compliance sheets (store/compliance)', () => {
  const sheets: [string, string][] = [
    ['store/compliance/play-data-safety.md', 'Data types'],
    ['store/compliance/apple-privacy.md', 'Data types'],
  ];

  it.each(sheets)('%s: every answer row cites code that exists', (file, heading) => {
    const rows = tableRows(read(file), heading);
    expect(rows.length).toBeGreaterThanOrEqual(6);
    for (const row of rows) {
      const paths = citedPaths(row);
      expect({ row: row.slice(0, 60), cites: paths.length > 0 }).toEqual({
        row: row.slice(0, 60),
        cites: true,
      });
      for (const p of paths) {
        expect({ path: p, exists: existsSync(join(root, p)) }).toEqual({ path: p, exists: true });
      }
    }
  });

  it('agrees with the privacy policy on the optional crash reports and the local-only GPS', () => {
    const policy = read('docs/privacy-policy.md');
    expect(policy).toMatch(/Crash reports are off unless you turn on/);
    expect(policy).toMatch(/The GPS track is stored on the phone only/);
    const play = read('store/compliance/play-data-safety.md');
    expect(play).toMatch(/Location → Precise location\s*\|\s*\*\*No\*\*/);
    expect(play).toMatch(/Crash logs\s*\|\s*\*\*Yes\*\*, only when the user turns on/);
    const apple = read('store/compliance/apple-privacy.md');
    expect(apple).toMatch(/\*\*Tracking: No\.\*\*/);
  });

  it('agrees with app.json and the privacy policy on the automatic update check', () => {
    // ON_ERROR_RECOVERY: besides More → Check for updates, the update library checks by itself
    // when the app restarts after a start-up crash, so its installation id is not optional.
    expect(expo.updates.checkAutomatically).toBe('ON_ERROR_RECOVERY');
    expect(read('docs/privacy-policy.md')).toMatch(
      /the only automatic check happens when the app restarts after crashing\s+during start-up/,
    );
    for (const file of [
      'store/compliance/play-data-safety.md',
      'store/compliance/apple-privacy.md',
    ]) {
      const sheet = read(file);
      expect(sheet).toMatch(/restarts after crashing during start-up/);
      expect(sheet).not.toMatch(/only (when the user taps|on) More → Check for updates/);
    }
  });

  it('justifies every Android permission app.json declares', () => {
    const play = read('store/compliance/play-data-safety.md');
    for (const perm of expo.android.permissions as string[]) {
      expect(play).toContain(`\`${perm.replace('android.permission.', '')}\``);
    }
  });

  it('blocks the permissions that libraries merge in but the app never uses', () => {
    // SYSTEM_ALERT_WINDOW + external storage: Expo template / expo-file-system. USE_BIOMETRIC /
    // USE_FINGERPRINT: androidx.biometric via expo-secure-store (no `requireAuthentication`).
    // c2dm RECEIVE: firebase-messaging via expo-notifications (local notifications only, no push
    // token). Play flags these on review, so a dependency bump must not bring them back.
    const blocked = expo.android.blockedPermissions as string[];
    expect([...blocked].sort()).toEqual(
      [
        'android.permission.SYSTEM_ALERT_WINDOW',
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.WRITE_EXTERNAL_STORAGE',
        'android.permission.USE_BIOMETRIC',
        'android.permission.USE_FINGERPRINT',
        'com.google.android.c2dm.permission.RECEIVE',
      ].sort(),
    );
    // A permission cannot be both requested and blocked.
    for (const perm of expo.android.permissions as string[]) expect(blocked).not.toContain(perm);
    // The Play sheet lists what is blocked, so the reviewer answers match the built APK.
    const play = read('store/compliance/play-data-safety.md');
    for (const perm of blocked) {
      expect(play).toContain(`\`${perm.replace('android.permission.', '')}\``);
    }
  });

  it('never asks for biometrics or a push token, which the blocked permissions would break', () => {
    const offenders = [
      'requireAuthentication',
      'getExpoPushTokenAsync',
      'getDevicePushTokenAsync',
      'addPushTokenListener',
    ];
    const sources = ['src/shared/state/secureApiKey.ts', 'src/shared/notify/index.ts'];
    for (const file of sources) {
      const code = read(file);
      for (const name of offenders)
        expect({ file, name, used: code.includes(name) }).toEqual({
          file,
          name,
          used: false,
        });
    }
  });
});
