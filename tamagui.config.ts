import { config as baseConfig } from '@tamagui/config/v3';
import { Platform } from 'react-native';
import { createTamagui } from 'tamagui';
import { monoFontFamily } from './src/shared/ui/monoFont';
import palette from './src/shared/ui/palette.json';

// Brand palette — dark techy automotive feel. Overrides the base `dark` theme's tokens.
const darkBrand = {
  background: '#0D1117',
  backgroundStrong: '#010409',
  backgroundHover: '#161B22',
  backgroundFocus: '#161B22',
  backgroundPress: '#1C2128',
  borderColor: '#30363D',
  borderColorHover: '#484F58',
  borderColorFocus: '#484F58',
  borderColorPress: '#484F58',
  color: '#E6EDF3',
  colorHover: '#F0F6FF',
  colorPress: '#F0F6FF',
  colorFocus: '#F0F6FF',
};

/** Semantic colour tokens (plan 20) from `src/shared/ui/palette.json`, the one colour source:
 *  `$accent`, `$muted`, `$statusOk|Warn|Error|Info|Fatal`, `$placeholderColor`, `$gaugeTrack` and
 *  `$onFill` (text on a status fill). Every value meets WCAG AA on its theme's surfaces —
 *  `npm run check:contrast` fails CI otherwise. */
function semantic(scheme: 'dark' | 'light') {
  const t = palette.themes[scheme];
  return { ...t.text, ...t.graphic, onFill: t.onFill };
}
const SEMANTIC = { dark: semantic('dark'), light: semantic('light') };
type Semantic = (typeof SEMANTIC)['dark'];

/** Merge the semantic tokens into **every** light / dark theme — sub-themes (`dark_alt2`,
 *  `dark_green`, component themes like `dark_Button`) included — so `$accent` resolves wherever a
 *  component sits. `alt2` (secondary text everywhere) gets the muted colour: the stock greys are
 *  #626262 on dark (3.1:1) and #808080 on light (3.9:1), both under AA. The mapped return type keeps
 *  each literal theme key (see the note on `createTamagui` below). */
function withSemantic<T extends Record<string, object>>(
  themes: T,
): { [K in keyof T]: T[K] & Semantic } {
  const out: Record<string, object> = {};
  for (const [name, theme] of Object.entries(themes)) {
    const scheme = name.startsWith('light') ? 'light' : 'dark';
    const alt2 = name === `${scheme}_alt2` ? { color: SEMANTIC[scheme].muted } : null;
    out[name] = { ...theme, ...SEMANTIC[scheme], ...alt2 };
  }
  return out as { [K in keyof T]: T[K] & Semantic };
}

// NOTE: spread the base themes WITHOUT widening to a Record — keeping the literal theme keys
// (light, dark, *_alt2, *_red, …) is what lets `theme="alt2"|"red"|…` typecheck. A
// `Record<string, …>` cast here erases those keys and collapses ThemeName to just "dark".
export const tamaguiConfig = createTamagui({
  ...baseConfig,
  themes: withSemantic({
    ...baseConfig.themes,
    dark: { ...baseConfig.themes.dark, ...darkBrand },
  }),
  // `$mono` ships a CSS fallback stack, which iOS / Android cannot resolve (plan 09): one installed
  // family per platform instead, the web keeping the stack.
  fonts: {
    ...baseConfig.fonts,
    mono: { ...baseConfig.fonts.mono, family: monoFontFamily(Platform.OS) },
  },
  // Every Button is one accessibility element (plan 20), as React Native's `Pressable` is by
  // default: TalkBack / VoiceOver focus the button itself and read its label or text, instead of
  // landing on the text inside it, which has no action.
  defaultProps: { Button: { accessible: true } },
});

export type AppTamaguiConfig = typeof tamaguiConfig;

declare module 'tamagui' {
  // eslint-disable-next-line @typescript-eslint/no-empty-interface
  interface TamaguiCustomConfig extends AppTamaguiConfig {}
}

export default tamaguiConfig;
