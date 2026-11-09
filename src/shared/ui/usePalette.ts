import { useTheme } from 'tamagui';
import palette from './palette.json';

/** A semantic colour (plan 20): the meaning, not the hex. Feature maps (status → colour) store a
 *  `Tone` and resolve it with `usePalette()`, so both themes get a colour that passes WCAG AA. */
export type Tone =
  | 'accent'
  | 'muted'
  | 'statusOk'
  | 'statusWarn'
  | 'statusError'
  | 'statusInfo'
  | 'statusFatal';

/** Raw colour strings of the current theme, for the places a token cannot go: lucide icon `color`,
 *  react-native-svg strokes / fills and React Navigation options. */
export interface PaletteColors extends Record<Tone, string> {
  gaugeTrack: string;
  /** Text on a status / accent fill. */
  onFill: string;
  placeholderColor: string;
  /** Body text, screen background and hairline borders of the theme. */
  color: string;
  background: string;
  borderColor: string;
}

const DARK = palette.themes.dark;
const FALLBACK: PaletteColors = {
  ...DARK.text,
  ...DARK.graphic,
  onFill: DARK.onFill,
  color: DARK.chrome.text,
  background: DARK.surfaces[0],
  borderColor: DARK.chrome.border,
};

const KEYS = Object.keys(FALLBACK) as (keyof PaletteColors)[];

/** The current theme's palette as plain strings. Outside a Tamagui theme (or for a key a theme
 *  lacks) it falls back to the dark palette. */
export function usePalette(): PaletteColors {
  const theme = useTheme() as unknown as Record<string, { val?: unknown } | undefined>;
  const out = {} as PaletteColors;
  for (const key of KEYS) {
    const val = theme[key]?.val;
    out[key] = typeof val === 'string' ? val : FALLBACK[key];
  }
  return out;
}
