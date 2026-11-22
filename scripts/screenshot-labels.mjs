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
const onboarding = ns('onboarding');
const liveCharts = ns('liveCharts');
const batteryHealth = ns('batteryHealth');
const maintenance = ns('maintenance');

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
  CHART_HINT_DISMISS: onboarding.hint.dismissA11y.replace('{{title}}', liveCharts.hint.title),
  BATTERY_CAPTURE: batteryHealth.capture,
  MAINT_ODO_LABEL: maintenance.odometer,
  MAINT_ODO_PLACEHOLDER: maintenance.odometerPlaceholder,
  MAINT_SAVE: maintenance.save,
  MAINT_LOG_SERVICE: maintenance.logService,
  MAINT_AIR_FILTER: maintenance.item['air-filter'],
  MAINT_CABIN_FILTER: maintenance.item['cabin-filter'],
};
// Already regular expressions: "Log “{{name}}” today" matches whichever item is selected.
const [logBefore, logAfter] = maintenance.logToday.split('{{name}}');
const regex = {
  MAINT_LOG_TODAY: `${escape(logBefore)}.*${escape(logAfter)}`,
};
// Every non-ASCII character becomes `.` (any character): on Windows the JVM decodes Maestro's `-e`
// arguments with the ANSI code page, which has no `ș` / `ț` (comma below), so "Dezvoltator și
// simulator" reached the flow as "Dezvoltator ?i simulator" and matched nothing.
const ascii = (re) => re.replace(/[^\x00-\x7f]/g, '.');
for (const [key, value] of Object.entries(env)) console.log(`${key}=${ascii(escape(value))}`);
for (const [key, value] of Object.entries(regex)) console.log(`${key}=${ascii(value)}`);
