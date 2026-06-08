import { config as baseConfig } from '@tamagui/config/v3';
import { createTamagui } from 'tamagui';

/** App design system. Starts from Tamagui's v3 preset (tokens, themes, shorthands). */
export const tamaguiConfig = createTamagui(baseConfig);

export type AppTamaguiConfig = typeof tamaguiConfig;

declare module 'tamagui' {
  // eslint-disable-next-line @typescript-eslint/no-empty-interface
  interface TamaguiCustomConfig extends AppTamaguiConfig {}
}

export default tamaguiConfig;
