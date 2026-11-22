/** Whether the app runs in a browser (the Expo web build, plan 28) rather than on a phone.
 *
 *  Equivalent to `Platform.OS === 'web'` for this app — react-native-web renders into a real DOM, and
 *  React Native has no `document` — but pure, so shared services that run in the Node test project
 *  (persistence, file export, the keystore wrapper) can ask without importing `react-native`. Tests
 *  flip it by defining a fake `globalThis.document`. */
export function isWebRuntime(): boolean {
  const doc = (globalThis as { document?: { createElement?: unknown } }).document;
  return !!doc && typeof doc.createElement === 'function';
}
