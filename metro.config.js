// Expo Metro config. SVG transformer could be added here later if we ship SVG assets.
// `getSentryExpoConfig` is Expo's default config plus debug ids in the bundle and its source map, so
// release-build stack traces can be matched to uploaded source maps (opt-in crash reports, plan 31;
// docs/release.md). It adds no runtime behaviour: nothing is sent unless the user opts in.
// Web Replay stays out of the web bundle (no session recording, ever).
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getSentryExpoConfig(__dirname, { includeWebReplay: false });

module.exports = config;
