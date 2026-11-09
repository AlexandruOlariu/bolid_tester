/** Window-size classes for the tablet / landscape layout (plan 21). Pure — no React Native import —
 *  so the breakpoints are unit-tested under the `core` Jest project. The hook that feeds them from
 *  `useWindowDimensions()` is `useLayoutClass.ts`. See docs/architecture.md → "Layout classes".
 *
 *  The split is Material 3's window-size classes (compact < 600 dp, medium 600–839, expanded ≥ 840),
 *  not Tamagui's v3 media queries (`sm` ≤ 800, `gtSm` ≥ 801, `gtMd` ≥ 1021): there is no 768 edge in
 *  the Tamagui config, and Material's 600 dp edge already gives a 7-inch tablet in portrait and a
 *  small phone in landscape the two-pane layouts the roadmap's "≥ 768 dp" asks for. A large phone in
 *  landscape (Pixel 7: 915 × 412 dp) is "expanded" by width; a small one (~ 640–800 dp) "medium".
 *  The side rail also needs height (`railMinHeight`), so landscape phones keep the bottom bar.
 */

export type LayoutClass = 'compact' | 'medium' | 'expanded';

export interface LayoutInfo {
  cls: LayoutClass;
  width: number;
  height: number;
  landscape: boolean;
  fontScale: number;
}

/** Below this width (dp) the layout is a phone in portrait. */
export const MEDIUM_MIN_WIDTH = 600;
/** From this width (dp) the layout is a tablet (or a large phone in landscape). */
export const EXPANDED_MIN_WIDTH = 840;
/** The widest a `Screen`'s content column grows on medium / expanded windows (dp). */
export const CONTENT_MAX_WIDTH = 1100;

/** compact < 600 dp, medium 600–839, expanded ≥ 840 (Material 3 window-size classes). */
export function classify(width: number): LayoutClass {
  if (width >= EXPANDED_MIN_WIDTH) return 'expanded';
  if (width >= MEDIUM_MIN_WIDTH) return 'medium';
  return 'compact';
}

/** Build the full layout info from a window size (what `useLayoutClass` returns). */
export function layoutInfo(width: number, height: number, fontScale = 1): LayoutInfo {
  return { cls: classify(width), width, height, landscape: width > height, fontScale };
}

/** Two-pane layouts (Live gauges | values, Charts side by side, two-column card lists) switch on
 *  anything wider than a portrait phone. */
export function isTwoPane(info: Pick<LayoutInfo, 'cls'>): boolean {
  return info.cls !== 'compact';
}

/** Tabs shown on the side rail — the visible `Tabs.Screen` entries in `src/app/_layout.tsx` (Home,
 *  Vehicle, Live, Faults, Info, Settings, More). Keep in sync when a tab is added or removed. */
export const RAIL_TABS = 7;

/** The smallest window height (dp) whose side rail fits every tab. The navigator lays the rail out as
 *  a plain, non-scrolling column (expo-router's bundled `BottomTabBar`, `sideContent`), so tabs that
 *  do not fit run off the bottom and cannot be tapped. One `material` + `below-icon` item is ~56 dp of
 *  fixed chrome (6 + 6 margin, 10 + 10 padding, 24 icon) plus a ~13 dp label line that grows with the
 *  system font scale; the rail adds 6 + 6 padding, and the status / navigation bar insets take up to
 *  ~60 more. 7 tabs at font scale 1 → ~555 dp, so a phone on its side (360–430 dp tall) keeps the
 *  bottom bar; a tablet (≥ 600 dp tall in landscape) gets the rail. */
export function railMinHeight(fontScale = 1): number {
  return Math.round(RAIL_TABS * (56 + 13 * Math.max(1, fontScale)) + 72);
}

/** The tab bar becomes a side rail on a tablet, or on a medium window held in landscape — but only
 *  when the window is tall enough for every rail item (`railMinHeight`); otherwise it stays a bottom
 *  bar. A phone in landscape (Pixel 7: 915 × 412 dp, expanded by width) therefore keeps the bottom
 *  bar while still getting the two-pane screens. */
export function usesSideRail(
  info: Pick<LayoutInfo, 'cls' | 'landscape' | 'height' | 'fontScale'>,
): boolean {
  const wide = info.cls === 'expanded' || (info.cls === 'medium' && info.landscape);
  return wide && info.height >= railMinHeight(info.fontScale);
}
