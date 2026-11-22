/** The monospace font family per platform (plan 09). React Native on iOS and Android takes ONE
 *  installed family name, not a CSS fallback stack: Tamagui's v3 `$mono` token ships the web stack
 *  (`"ui-monospace", "SFMono-Regular", …`), which iOS does not recognise, so hex dumps, the sniffer
 *  table and the coding bytes fell back to the proportional system font. `tamagui.config.ts`
 *  overrides `$mono` with this, and the screens that set a raw `fontFamily` use it too. Pure (no
 *  React Native import) so the core project tests it. */

/** The browser stack (Tamagui's own `$mono` family), kept for the web build. */
export const WEB_MONO_STACK =
  '"ui-monospace", "SFMono-Regular", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

/** `Menlo` ships with every iOS version the app supports; `monospace` is Android's generic alias. */
export function monoFontFamily(os: string): string {
  if (os === 'ios') return 'Menlo';
  if (os === 'android') return 'monospace';
  return WEB_MONO_STACK;
}
