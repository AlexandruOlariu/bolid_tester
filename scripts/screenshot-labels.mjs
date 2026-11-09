#!/usr/bin/env node
/** The labels .maestro/screenshots.yaml taps, in one language, as `KEY=value` lines for Maestro's
 *  `-e` (plan 30; used by scripts/screenshots.sh). Read from the app's own locale files, so the
 *  flow follows copy changes; regex-escaped because Maestro's `tapOn` text is a regular expression.
 *
 *    node scripts/screenshot-labels.mjs ro */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const lang = process.argv[2] ?? 'en';
const ns = (name) =>
  JSON.parse(
    readFileSync(join(ROOT, 'src', 'shared', 'i18n', 'locales', lang, `${name}.json`), 'utf8'),
  );

const common = ns('common');
const settings = ns('settings');
const connection = ns('connection');
const vehicleSelect = ns('vehicleSelect');
const inspection = ns('inspection');
const moduleScan = ns('moduleScan');

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const env = {
  // Settings → General → Language shows endonyms, the same in every language.
  LANG_BUTTON: lang === 'ro' ? 'Română' : 'English',
  TAB_SETTINGS: common.nav.settings,
  TAB_CONNECT: common.nav.connect,
  DEV_TITLE: settings.dev.title,
  SIM_SOURCE: settings.dev.source.mock,
  CUSTOM_DTCS: settings.dev.custom,
  CUSTOM_PLACEHOLDER: settings.dev.customPlaceholder,
  CONNECT_SIM: connection.mock.connect,
  PROFILES_TITLE: vehicleSelect.profiles.title,
  RUN_INSPECTION: inspection.run,
  SCAN_ALL: moduleScan.scanAll,
};
for (const [key, value] of Object.entries(env)) console.log(`${key}=${escape(value)}`);
