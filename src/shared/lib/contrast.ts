/** WCAG 2.1 contrast ratios and the palette check behind `npm run check:contrast` (plan 20,
 *  docs/accessibility.md). Pure: no imports, so scripts/contrast-check.mjs transpiles and runs this
 *  same file — one formula for the app's test and the CI script. */

/** Minimum ratio for text (WCAG 1.4.3 AA, normal size). */
export const TEXT_MIN_RATIO = 4.5;
/** Minimum ratio for graphics that carry meaning: icons, gauge tracks, chart lines (WCAG 1.4.11). */
export const GRAPHIC_MIN_RATIO = 3;

/** Parse `#RGB` or `#RRGGBB` into 0–255 channels; throws on anything else. */
export function parseHex(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`Not a hex colour: ${hex}`);
  const h =
    m[1].length === 3
      ? m[1]
          .split('')
          .map((c) => c + c)
          .join('')
      : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

/** WCAG relative luminance (0 = black, 1 = white). */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast ratio between two colours, 1 to 21 (order does not matter). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** One theme of `src/shared/ui/palette.json`. */
export interface ThemePalette {
  /** Backgrounds the tokens sit on: the screen first, then cards. */
  surfaces: string[];
  /** Tokens used as text (and as fills under `onFill` text): ≥ 4.5 on every surface. */
  text: Record<string, string>;
  /** Tokens used only as graphics: ≥ 3 on every surface. */
  graphic: Record<string, string>;
  /** Text colour on a status / accent fill (StatusBadge): ≥ 4.5 on every fillable text token. */
  onFill: string;
  /** Header and tab bar (outside the Tamagui theme): `text` ≥ 4.5 on `background`, and the tab
   *  tints (`text.accent`, `text.muted`) are checked against `background` too. */
  chrome?: { background: string; border: string; text: string };
}

export interface Palette {
  themes: Record<string, ThemePalette>;
  brand: { green: string; ink: string } & Record<string, string>;
}

export interface ContrastCheck {
  /** e.g. `light.text.accent on #FFFFFF`. */
  pair: string;
  ratio: number;
  min: number;
  pass: boolean;
}

/** Text tokens that are never a fill (so `onFill` is not checked against them). */
const NOT_A_FILL = new Set(['placeholderColor']);

/** Every pair the palette must satisfy, with its ratio. `failures()` keeps the failing ones. */
export function checkPalette(palette: Palette): ContrastCheck[] {
  const checks: ContrastCheck[] = [];
  const add = (pair: string, a: string, b: string, min: number) => {
    const ratio = contrastRatio(a, b);
    checks.push({ pair, ratio, min, pass: ratio >= min });
  };
  for (const [scheme, theme] of Object.entries(palette.themes)) {
    for (const surface of theme.surfaces) {
      for (const [name, colour] of Object.entries(theme.text)) {
        add(`${scheme}.text.${name} on ${surface}`, colour, surface, TEXT_MIN_RATIO);
      }
      for (const [name, colour] of Object.entries(theme.graphic)) {
        add(`${scheme}.graphic.${name} on ${surface}`, colour, surface, GRAPHIC_MIN_RATIO);
      }
    }
    if (theme.chrome) {
      const bg = theme.chrome.background;
      add(`${scheme}.chrome.text on ${bg}`, theme.chrome.text, bg, TEXT_MIN_RATIO);
      for (const tab of ['accent', 'muted']) {
        if (theme.text[tab])
          add(`${scheme}.text.${tab} (tab) on ${bg}`, theme.text[tab], bg, TEXT_MIN_RATIO);
      }
    }
    for (const [name, colour] of Object.entries(theme.text)) {
      if (NOT_A_FILL.has(name)) continue;
      add(`${scheme}.onFill on ${scheme}.text.${name}`, theme.onFill, colour, TEXT_MIN_RATIO);
    }
  }
  // The splash: brand-green screen with the title in ink.
  add('brand.ink on brand.green', palette.brand.ink, palette.brand.green, TEXT_MIN_RATIO);
  return checks;
}

export function failures(checks: ContrastCheck[]): ContrastCheck[] {
  return checks.filter((c) => !c.pass);
}
