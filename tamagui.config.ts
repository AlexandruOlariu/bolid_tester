import { config as baseConfig } from '@tamagui/config/v3';
import { Platform } from 'react-native';
import { createTamagui } from 'tamagui';
import { monoFontFamily } from './src/shared/ui/monoFont';

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
  placeholderColor: '#484F58',
};

// NOTE: spread the base themes WITHOUT widening to a Record — keeping the literal theme keys
// (light, dark, *_alt2, *_red, …) is what lets `theme="alt2"|"red"|…` typecheck. A
// `Record<string, …>` cast here erases those keys and collapses ThemeName to just "dark".
export const tamaguiConfig = createTamagui({
  ...baseConfig,
  themes: {
    ...baseConfig.themes,
    dark: { ...baseConfig.themes.dark, ...darkBrand },
  },
  // `$mono` ships a CSS fallback stack, which iOS / Android cannot resolve (plan 09): one installed
  // family per platform instead, the web keeping the stack.
  fonts: {
    ...baseConfig.fonts,
    mono: { ...baseConfig.fonts.mono, family: monoFontFamily(Platform.OS) },
  },
});

export type AppTamaguiConfig = typeof tamaguiConfig;

declare module 'tamagui' {
  // eslint-disable-next-line @typescript-eslint/no-empty-interface
  interface TamaguiCustomConfig extends AppTamaguiConfig {}
}

export default tamaguiConfig;
