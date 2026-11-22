#!/usr/bin/env node
/** Applies plugins/withReleaseSigning.js to a fixture of the `android/app/build.gradle` that this Expo
 *  SDK's prebuild generates (scripts/fixtures/app-build.gradle) and asserts the replacements. Runs in
 *  `npm run check:release`, `npm run ci` and the CI `verify` job. Exit code 1 on any failure.
 *
 *  Refresh the fixture after an Expo SDK upgrade: remove the plugin from app.json, run
 *  `npx expo prebuild --platform android --clean --no-install`, copy android/app/build.gradle over the
 *  fixture, put the plugin back and prebuild again. */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const plugin = require(join(root, 'plugins', 'withReleaseSigning.js'));
const { applyReleaseSigning, RELEASE_SIGNING_MARKER } = plugin;
const fixture = readFileSync(join(root, 'scripts', 'fixtures', 'app-build.gradle'), 'utf8');

const RELEASE_REF =
  'signingConfig System.getenv("BOLID_KEYSTORE_PATH") ? signingConfigs.release : signingConfigs.debug';

let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (e) {
    failures++;
    console.error(`  FAIL ${name}\n       ${e instanceof Error ? e.message : String(e)}`);
  }
}
function assert(cond, message) {
  if (!cond) throw new Error(message);
}
function count(haystack, needle) {
  return haystack.split(needle).length - 1;
}
function throws(fn, pattern) {
  try {
    fn();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    assert(pattern.test(msg), `threw, but "${msg}" does not match ${pattern}`);
    return;
  }
  throw new Error('expected an error, none was thrown');
}

/** The `buildTypes { … }` section up to its `release {` block, and the release block itself. */
function buildTypeBlocks(gradle) {
  const bt = gradle.indexOf('buildTypes {');
  const relStart = gradle.indexOf('release {', bt);
  return {
    debug: gradle.slice(bt, relStart),
    release: gradle.slice(relStart, gradle.indexOf('\n        }', relStart)),
  };
}

console.log(
  'check-signing-plugin: plugins/withReleaseSigning.js against scripts/fixtures/app-build.gradle',
);

await check('fixture is an unmodified Expo template (debug-signed release, versionCode 1)', () => {
  assert(!fixture.includes(RELEASE_SIGNING_MARKER), 'fixture already contains the plugin marker');
  assert(
    buildTypeBlocks(fixture).release.includes('signingConfig signingConfigs.debug'),
    'fixture release build type does not use signingConfigs.debug',
  );
  assert(/versionCode 1\b/.test(fixture), 'fixture has no `versionCode 1`');
});

const noEnv = applyReleaseSigning(fixture, {});

await check('1. adds an env-driven release signing config', () => {
  assert(noEnv.includes(RELEASE_SIGNING_MARKER), 'marker missing');
  assert(noEnv.includes('if (System.getenv("BOLID_KEYSTORE_PATH")) {'), 'no env guard');
  for (const name of ['BOLID_KEYSTORE_PASSWORD', 'BOLID_KEY_ALIAS', 'BOLID_KEY_PASSWORD']) {
    assert(noEnv.includes(`System.getenv("${name}")`), `${name} not read from the environment`);
  }
  assert(
    /release \{\s*\n\s*def ksFile = file\(System\.getenv\("BOLID_KEYSTORE_PATH"\)\)/.test(noEnv),
    'release signing config does not load the keystore from BOLID_KEYSTORE_PATH',
  );
  assert(
    noEnv.includes('throw new GradleException("BOLID_KEYSTORE_PATH is set but no keystore'),
    'a missing keystore file does not fail the build',
  );
  assert(noEnv.includes("storeFile file('debug.keystore')"), 'debug signing config was removed');
});

await check(
  '2. release build type uses the release key only when BOLID_KEYSTORE_PATH is set',
  () => {
    const { debug, release } = buildTypeBlocks(noEnv);
    assert(release.includes(RELEASE_REF), `release build type was not rewired:\n${release}`);
    assert(
      !/signingConfig signingConfigs\.debug\s*\n/.test(release),
      'release still hard-codes the debug key',
    );
    assert(
      debug.includes('signingConfig signingConfigs.debug'),
      'debug build type lost the debug key',
    );
  },
);

await check('3. versionCode follows BOLID_VERSION_CODE, and stays 1 without it', () => {
  assert(/versionCode 1\b/.test(noEnv), 'versionCode changed without BOLID_VERSION_CODE');
  const ci = applyReleaseSigning(fixture, { BOLID_VERSION_CODE: '137' });
  assert(/versionCode 137\b/.test(ci), 'versionCode was not set to 137');
  assert(count(ci, 'versionCode ') === 1, 'more than one versionCode line');
  assert(/versionName "[^"]+"/.test(ci), 'versionName line lost');
});

await check('no secret value or keystore path is written into the gradle file', () => {
  const secret = 'hunter2-should-never-appear';
  const out = applyReleaseSigning(fixture, {
    BOLID_KEYSTORE_PATH: '/tmp/release.keystore',
    BOLID_KEYSTORE_PASSWORD: secret,
    BOLID_KEY_ALIAS: secret,
    BOLID_KEY_PASSWORD: secret,
  });
  assert(!out.includes(secret), 'a secret leaked into build.gradle');
  assert(!out.includes('/tmp/release.keystore'), 'the keystore path was baked into build.gradle');
});

await check('idempotent: applying twice changes nothing', () => {
  const once = applyReleaseSigning(fixture, { BOLID_VERSION_CODE: '5' });
  const twice = applyReleaseSigning(once, { BOLID_VERSION_CODE: '5' });
  assert(once === twice, 'second application changed the file');
  assert(count(twice, RELEASE_SIGNING_MARKER) === 1, 'marker inserted more than once');
  assert(count(twice, RELEASE_REF) === 1, 'release reference rewritten more than once');
});

await check('rejects a malformed BOLID_VERSION_CODE', () => {
  throws(() => applyReleaseSigning(fixture, { BOLID_VERSION_CODE: '12abc' }), /BOLID_VERSION_CODE/);
  throws(() => applyReleaseSigning(fixture, { BOLID_VERSION_CODE: '0' }), /BOLID_VERSION_CODE/);
});

await check('fails loudly when the Expo template changes shape', () => {
  throws(() => applyReleaseSigning('android {\n}\n', {}), /signingConfigs/);
  const noDebugRef = fixture.replace(
    /(buildTypes \{[\s\S]*?release \{[\s\S]*?)signingConfig signingConfigs\.debug/,
    '$1',
  );
  throws(() => applyReleaseSigning(noDebugRef, {}), /release build type/);
});

await check('the registered appBuildGradle mod applies the same transform', async () => {
  // Driven through the real expo/config-plugins mod chain — no android/ folder needed.
  const saved = process.env.BOLID_VERSION_CODE;
  delete process.env.BOLID_VERSION_CODE;
  try {
    const config = plugin({ name: 'Bolid Tester', slug: 'bolid-tester' });
    const mod = config.mods?.android?.appBuildGradle;
    assert(typeof mod === 'function', 'no android.appBuildGradle mod registered');
    const result = await mod({
      ...config,
      modResults: { path: 'android/app/build.gradle', language: 'groovy', contents: fixture },
      modRequest: {
        platform: 'android',
        modName: 'appBuildGradle',
        projectRoot: root,
        introspect: false,
      },
    });
    assert(result.modResults.contents === noEnv, 'mod output differs from applyReleaseSigning()');
  } finally {
    if (saved !== undefined) process.env.BOLID_VERSION_CODE = saved;
  }
});

await check('BOLID_VERSION_CODE at prebuild also sets expo android.versionCode', () => {
  const saved = process.env.BOLID_VERSION_CODE;
  process.env.BOLID_VERSION_CODE = '42';
  try {
    const config = plugin({
      name: 'Bolid Tester',
      slug: 'bolid-tester',
      android: { package: 'x' },
    });
    assert(
      config.android.versionCode === 42,
      `android.versionCode is ${config.android.versionCode}`,
    );
    assert(config.android.package === 'x', 'other android config was dropped');
  } finally {
    if (saved === undefined) delete process.env.BOLID_VERSION_CODE;
    else process.env.BOLID_VERSION_CODE = saved;
  }
});

if (failures > 0) {
  console.error(`check-signing-plugin: ${failures} check(s) failed`);
  process.exit(1);
}
console.log('check-signing-plugin: all checks passed');
