#!/usr/bin/env node
/** The app version has one source of truth: package.json `version`, mirrored into app.json
 *  `expo.version` (which becomes the Android versionName and, through `runtimeVersion.policy:
 *  appVersion`, the OTA runtime version) and the package-lock.json root. See docs/release.md.
 *
 *    node scripts/check-version-sync.mjs              exit 1 if the three disagree
 *    node scripts/check-version-sync.mjs --tag v1.2.3 also require the tag to be v<version>
 *    node scripts/check-version-sync.mjs --write      copy package.json's version into app.json
 *
 *  `--write` runs from the npm `version` lifecycle script, so `npm version minor|patch` bumps
 *  package.json, package-lock.json and app.json in the same commit and tag. */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(join(root, file), 'utf8');
const SEMVER = /^\d+\.\d+\.\d+$/;

const args = process.argv.slice(2);
const tagIndex = args.indexOf('--tag');
const tag = tagIndex >= 0 ? args[tagIndex + 1] : undefined;
const write = args.includes('--write');

const pkgVersion = JSON.parse(read('package.json')).version;
const errors = [];
if (!SEMVER.test(pkgVersion ?? '')) {
  errors.push(`package.json version "${pkgVersion}" is not MAJOR.MINOR.PATCH`);
}

if (write && errors.length === 0) {
  const text = read('app.json');
  // Rewrite only the value of expo.version, keeping the file's formatting byte-for-byte otherwise.
  // `"runtimeVersion"` does not match: the key must be exactly "version".
  const updated = text.replace(/("version"\s*:\s*")[^"]*(")/, `$1${pkgVersion}$2`);
  if (JSON.parse(updated).expo?.version !== pkgVersion) {
    errors.push('could not update expo.version in app.json');
  } else if (updated !== text) {
    writeFileSync(join(root, 'app.json'), updated);
    console.log(`check-version-sync: app.json expo.version → ${pkgVersion}`);
  }
}

const appVersion = JSON.parse(read('app.json')).expo?.version;
if (appVersion !== pkgVersion) {
  errors.push(
    `app.json expo.version "${appVersion}" ≠ package.json version "${pkgVersion}" ` +
      '(run `node scripts/check-version-sync.mjs --write`)',
  );
}

let lockVersion;
try {
  const lock = JSON.parse(read('package-lock.json'));
  lockVersion = lock.packages?.['']?.version ?? lock.version;
} catch {
  lockVersion = undefined; // no lockfile: nothing to compare
}
if (lockVersion !== undefined && lockVersion !== pkgVersion) {
  errors.push(
    `package-lock.json version "${lockVersion}" ≠ package.json version "${pkgVersion}" (run \`npm install\`)`,
  );
}

if (tagIndex >= 0) {
  if (!tag) errors.push('--tag needs a value, e.g. --tag v0.2.0');
  else if (tag !== `v${pkgVersion}`) {
    errors.push(
      `tag "${tag}" does not match the app version v${pkgVersion} — release with \`npm version\``,
    );
  }
}

if (errors.length > 0) {
  for (const e of errors) console.error(`check-version-sync: ${e}`);
  process.exit(1);
}
console.log(`check-version-sync: ok — ${pkgVersion}${tag ? ` (tag ${tag})` : ''}`);
