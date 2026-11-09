/** App identity read from app.json at bundle time. `expo.version` is kept equal to package.json's
 *  `version` by scripts/check-version-sync.mjs (docs/release.md), and with `runtimeVersion.policy:
 *  appVersion` it is also the OTA runtime version: an over-the-air update only reaches installs
 *  whose native build has the same version. */
import appConfig from '../../../app.json';

export const APP_NAME: string = appConfig.expo.name;
export const APP_VERSION: string = appConfig.expo.version;

/** The build number, when `app.json` carries one in `expo.extra.build` (Settings → About shows it
 *  only then); null otherwise. CI stamps `versionCode` into the native build, not here. */
const extra = (appConfig.expo as { extra?: { build?: unknown; feedbackEmail?: unknown } }).extra;
export const APP_BUILD: string | null =
  typeof extra?.build === 'string' || typeof extra?.build === 'number' ? String(extra.build) : null;

/** The project documentation (Settings → About). */
export const DOCS_URL = 'https://github.com/AlexandruOlariu/bolid_tester/tree/HEAD/docs';

/** The published privacy policy (docs/privacy-policy.md; Settings → About shows the same text). */
export const PRIVACY_POLICY_URL =
  'https://github.com/AlexandruOlariu/bolid_tester/blob/HEAD/docs/privacy-policy.md';

/** Where **Report a problem → Email** sends its draft: `expo.extra.feedbackEmail` in app.json, when
 *  the maintainer sets one; null otherwise, and the Email button is hidden (plan 32). Not set in the
 *  repository — the GitHub issue and the share sheet are the default routes. */
export const FEEDBACK_EMAIL: string | null =
  typeof extra?.feedbackEmail === 'string' && extra.feedbackEmail.includes('@')
    ? extra.feedbackEmail
    : null;
