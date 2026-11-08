/** App identity read from app.json at bundle time. `expo.version` is kept equal to package.json's
 *  `version` by scripts/check-version-sync.mjs (docs/release.md), and with `runtimeVersion.policy:
 *  appVersion` it is also the OTA runtime version: an over-the-air update only reaches installs
 *  whose native build has the same version. */
import appConfig from '../../../app.json';

export const APP_NAME: string = appConfig.expo.name;
export const APP_VERSION: string = appConfig.expo.version;
