# Plan 21 — Tablet and landscape layout

**Size:** M (1 day) · **Depends on:** nothing (plan 20's tokens make it cleaner) · **Roadmap:**
v0.5 "Tablet layout"

## Goal

On screens ≥ 768 dp wide the app uses the space: Live shows gauges beside the value grid and
Charts shows two panels side by side with charts that stretch to the available width; the tab bar
moves to a side rail; every scrollable screen caps its content width for readability; landscape on
phones degrades gracefully instead of stretching a 320 px chart in a 800 px column.

## Why (verified)

- `app.json` has `"orientation": "default"` — landscape is already allowed on every device, but no
  component reads the window size: `useWindowDimensions` 0 uses, `Dimensions.` 0, Tamagui media
  props (`$gtMd` …) 0.
- `ChartsScreen.tsx` hard-codes `const W = 320; const H = 120;` for the SVG and all gesture math
  (`msPerPx = windowMs / W`, `toScreen` maps to `W`). On a tablet the chart is a 320 px strip.
- `Screen.tsx` is a `ScrollView` with `padding: 16` and no `maxWidth`; `DashboardScreen` lays
  gauges in an `XStack flexWrap` and cards in another — fine on phones, sparse on tablets.
- `_layout.tsx` uses expo-router `Tabs` whose bundled bottom-tabs navigator supports
  `tabBarPosition: 'bottom' | 'left' | 'right' | 'top'`
  (`node_modules/expo-router/build/react-navigation/bottom-tabs/types.d.ts:181`).
- Tamagui v3 media queries exist in the config (`node_modules/@tamagui/config/dist/esm/media.mjs`):
  `sm: maxWidth 800`, `gtSm: minWidth 801`, `md: maxWidth 1020`, `gtMd: minWidth 1021`. There is no
  768 breakpoint; `gtSm` (≥ 801) is the closest, so this plan defines its own hook.

## Read first

- `src/shared/ui/Screen.tsx`, `src/app/_layout.tsx` (`Tabs screenOptions`), `tamagui.config.ts`.
- `src/features/live-data/ui/DashboardScreen.tsx` (`GAUGES`, `visible`, customise mode),
  `src/features/live-charts/ui/ChartsScreen.tsx` (`Panel`, `W`, `H`, `toScreen`, `PanResponder`),
  `src/features/live-charts/model/chartsStore.ts` (two default panels), `hooks/useChartSeries.ts`.
- `src/features/sensor-readings/ui/SensorReadingsScreen.tsx` or, after plan 07, `live-data/ui/SensorGroups.tsx`.
- `src/features/more/ui/MoreScreen.tsx`, `VehicleSelectScreen.tsx` (card lists that should become
  two columns).

## Design

### Breakpoint hook (`src/shared/ui/useLayoutClass.ts`)

```ts
export type LayoutClass = 'compact' | 'medium' | 'expanded';
export interface LayoutInfo {
  cls: LayoutClass;
  width: number;
  height: number;
  landscape: boolean;
  fontScale: number;
}
/** compact < 600 dp, medium 600–839, expanded ≥ 840 (Material 3 window-size classes). A phone in landscape is usually 'medium'. */
export function classify(width: number): LayoutClass; // pure, tested
export function useLayoutClass(): LayoutInfo; // useWindowDimensions() → classify
```

Two-pane layouts switch on `cls !== 'compact'`; the side rail on `cls === 'expanded'` **or**
(`medium` and `landscape`). Material's 600/840 split matches the directive's ≥ 768 intent better
than Tamagui's 800/1020; document the choice.

### Screen width cap

`Screen.tsx`: wrap children in `<YStack width="100%" maxWidth={cls === 'compact' ? undefined : 1100}
alignSelf="center">`; keep `padding: 16` on phones, `24` on medium/expanded. Add an optional
`wide?: boolean` prop for screens that want the full width (Charts, Dashboard, Sniffer table).

### Side rail

`_layout.tsx`: compute `rail = cls === 'expanded' || (cls === 'medium' && landscape)`; set
`screenOptions.tabBarPosition: rail ? 'left' : 'bottom'`, `tabBarVariant: rail ? 'material' : 'uikit'`
(verify the prop exists in the same `types.d.ts`; if not, omit), `tabBarShowLabel: true`,
`tabBarLabelPosition: rail ? 'below-icon' : 'beside-icon'`? — keep labels below icons on the rail.
Width is managed by the navigator. Header stays on top.

### Live (Dashboard)

- `compact`: unchanged.
- `medium`/`expanded`: `XStack` with a left column (`width={360}`) holding the gauges stacked
  vertically + the fuel-economy card, and a right column (`flex={1}`) with the value-card grid
  (`flexWrap`, `ValueCard` `flexBasis="31%"` on expanded, `"48%"` on medium). Customise mode lists
  items in the right column. `Gauge size` → 180 on expanded.
- After plan 07, the Dashboard | All sensors segment stays above both columns.

### Charts

- Make the panel width dynamic: `Panel` measures its container with `onLayout` (`setWidth(e.nativeEvent.layout.width)`),
  defaults to 320 until measured; `H` = `Math.round(width * 0.375)` capped at 220. Replace every
  `W`/`H` reference with the measured values (`toScreen(pts, w, h)`, `msPerPx = windowMs / w`).
  Keep the `PanResponder` reading width from a ref (`widthRef.current`) like the other live refs.
- `ChartsScreen`: on `compact` panels stack; otherwise render them in an `XStack flexWrap` with
  `flexBasis="49%"`. Add an **Add panel** button (`useChartsStore.setPanels`) that creates `p3`/`p4`
  with the next unused supported PID — tablets have room for four. Persisting panels is already
  in-memory only; leave it.
- CSV share and inspection are unchanged.

### Lists

`MoreScreen` sections and `VehicleSelectScreen` cards: on non-compact, two columns
(`XStack flexWrap`, item `flexBasis="49%"`). Faults: stored/pending/permanent sections side by side on
expanded (three columns) — optional, only if the row components already stretch.

### Landscape on phones (`medium` by width in landscape)

The two-pane rules above apply, which is what a landscape phone wants for Live (gauges left,
values right). Ensure `Screen` still scrolls vertically and the keyboard-avoiding inputs (Settings)
are reachable: wrap the Settings `Screen` content in `KeyboardAvoidingView` behaviour via
`automaticallyAdjustKeyboardInsets` on the `ScrollView` (iOS) — one prop in `Screen.tsx`.

## Steps

1. `useLayoutClass.ts` + `classify.test.ts`; `Screen.tsx` cap/padding/`wide`.
2. `_layout.tsx` side rail.
3. Dashboard two-pane; gauge size.
4. Charts measured width/height; wrap panels; Add panel.
5. More / Vehicle two-column.
6. Docs; `npm run ci`.

## Simulator

No protocol change. For manual checks use an Android tablet emulator profile (Pixel Tablet, 2560 ×
1600, 320 dpi → 1280 × 800 dp) and a phone profile rotated to landscape (Pixel 7: 915 × 412 dp
landscape → `medium`).

## Tests

- `classify.test.ts`: 360 → compact, 599 → compact, 600 → medium, 839 → medium, 840 → expanded,
  1280 → expanded.
- Charts geometry: extract `toScreen(pts, w, h)` to `live-charts/api/chartGeometry.ts` (pure) and
  test that x spans `[0, w]` and y spans `[0, h]` for a two-point series; `msPerPx(windowMs, w)`.
- Plan 10 UI tests: render `DashboardScreen` with a mocked `useWindowDimensions` returning
  `{ width: 1280 }` and assert the two-column test IDs (`testID="live-left"`, `live-right`) exist;
  with `{ width: 390 }` they do not.

## Docs

- `docs/features/live-data.md`, `docs/features/live-charts.md`: layout classes, measured chart
  width, Add panel.
- `docs/architecture.md` § UI: `useLayoutClass` and the Screen width cap.
- New short section in `docs/features/more.md` and `vehicle-select.md`: two-column grids.

## Acceptance

- [ ] Pixel Tablet emulator: tab bar is a left rail; Live shows gauges in a left column and cards in
      a grid; Charts shows two panels side by side, each ≥ 500 px wide, pinch/pan/tap still work.
- [ ] Pixel 7 landscape: Live is two-pane; portrait is unchanged from today.
- [ ] Settings on a phone in landscape: the Server URL input stays visible with the keyboard open.
- [ ] No horizontal scrolling anywhere; `Screen` content is centred with a visible margin on the
      tablet.
- [ ] `npm run ci` green; chart geometry tests pass.

## Out of scope

Foldables (hinge-aware layouts), multi-window on Android, a web/desktop target (roadmap v0.7).
