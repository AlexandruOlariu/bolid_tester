import { config as baseConfig } from '@tamagui/config/v3';
import { createTamagui } from 'tamagui';

// Brand palette — dark techy automotive feel
const darkBrand = {
  background:        '#0D1117',
  backgroundStrong:  '#010409',
  backgroundHover:   '#161B22',
  backgroundFocus:   '#161B22',
  backgroundPress:   '#1C2128',
  borderColor:       '#30363D',
  borderColorHover:  '#484F58',
  borderColorFocus:  '#484F58',
  borderColorPress:  '#484F58',
  color:             '#E6EDF3',
  colorHover:        '#F0F6FF',
  colorPress:        '#F0F6FF',
  colorFocus:        '#F0F6FF',
  placeholderColor:  '#484F58',
};

const themes = baseConfig.themes as Record<string, Record<string, string>>;

export const tamaguiConfig = createTamagui({
  ...baseConfig,
  themes: {
    ...themes,
    dark: { ...themes.dark, ...darkBrand },
  },
});

export type AppTamaguiConfig = typeof tamaguiConfig;

declare module 'tamagui' {
  // eslint-disable-next-line @typescript-eslint/no-empty-interface
  interface TamaguiCustomConfig extends AppTamaguiConfig {}
}

export default tamaguiConfig;
