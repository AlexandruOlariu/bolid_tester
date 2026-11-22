# Plan 20 — Accessibility pass

**Size:** M (1–1½ days) · **Depends on:** plan 10 (component-test harness) for the automated
check; can start without it · **Roadmap:** v0.5 "Accessibility pass"

## Goal

Every control has an accessible name and role, text scales with the OS setting without breaking
layouts, every colour pair in both themes meets WCAG AA, motion respects the reduce-motion setting,
and the shared gauge/value primitives read in a sensible order with TalkBack / VoiceOver. A test
fails CI when a pressable without a name is introduced.

## Why (measured 2026-11-08)

| Inventory                                    | Count                                                                                                                        |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `onPress` handlers in `src/**/*.tsx`         | 145 (36 files)                                                                                                               |
| `accessibilityLabel`                         | 7 (ChartsScreen 1, MoreScreen 2, HintCard 1, Gauge 1, StatusBadge 1, ValueCard 1)                                            |
| `accessibilityRole`                          | 7 · `accessibilityHint` 0 · `accessibilityState` 0                                                                           |
| `allowFontScaling` / `maxFontSizeMultiplier` | 0 · `AccessibilityInfo` 0                                                                                                    |
| Pressable kinds                              | `<Button …onPress>` ×63, `<XStack …onPress>` ×2, plus `Card`/`XStack` rows with `onPress` in VehicleSelect, More, HintCard   |
| Icon-only `circular` buttons                 | 4 (DashboardScreen reorder/visibility ×3, ErrorLogScreen delete ×1) — no text child, no label                                |
| Hard-coded hex colours in `src/`             | 23 distinct values across 22 files (`#2bb673` ×34 incl. `#2BB673`, `#8B949E` ×16, `#f85149`/`#F85149` ×15, `#d29922` ×14, …) |

Tamagui `Button` with a text child gets an accessible name from its text, so most of the 63 buttons
are fine; the real gaps are icon-only buttons, pressable `Card`/`XStack` rows, segmented `Seg`
groups with no group/selected state, and the hard-coded colours that ignore the light theme.

### Contrast (WCAG 2.1, computed)

| Colour                                          | Used for                                 | on `#0D1117` (dark bg)            | on `#161B22` (dark card) | on `#FFFFFF` (light bg) |
| ----------------------------------------------- | ---------------------------------------- | --------------------------------- | ------------------------ | ----------------------- |
| `#2bb673` accent                                | tab tint, borders, icons, Gauge arc      | 7.25 AA                           | 6.62 AA                  | **2.61 FAIL**           |
| `#8B949E` inactive grey                         | tab inactive, icons, status              | 6.15 AA                           | 5.62 AA                  | 3.08 large-only         |
| `#E3B341` amber                                 | connecting status                        | 9.72 AA                           | 8.89 AA                  | **1.95 FAIL**           |
| `#F85149` red                                   | error status, DTC codes                  | 5.65 AA                           | 5.16 AA                  | 3.35 large-only         |
| `#d29922` warning                               | error-log severity, chart series         | 7.50 AA                           | 6.85 AA                  | **2.52 FAIL**           |
| `#4c9df3` blue                                  | hint icon, chart series                  | 6.69 AA                           | 6.12 AA                  | **2.83 FAIL**           |
| `#a371f7` purple                                | fatal severity                           | 5.64 AA                           | 5.16 AA                  | 3.35 large-only         |
| `#d9342b`                                       | (red variant)                            | 4.03 large-only                   | 3.69 large-only          | 4.69 AA                 |
| `#484F58` placeholder                           | `placeholderColor` token (dark)          | **2.28 FAIL**                     | **2.09 FAIL**            | 8.28 AA                 |
| `#3a3a3a`                                       | Gauge track                              | 1.66 (decorative)                 | —                        | 11.37                   |
| white text on `#2bb673`                         | AppSplash title, StatusBadge-style fills | **2.61 FAIL** (black on it: 8.04) |                          |                         |
| white text on `#E3B341` / `#F85149` / `#8B949E` | status fills                             | **1.95 / 3.35 / 3.08**            |                          |                         |

Conclusions: the dark theme passes except `placeholderColor` and white-on-fill text; the light
theme fails for every accent used as text or icon. `tamagui.config.ts` only overrides `dark`, so
the light theme is the stock Tamagui light palette with our hard-coded hex on top.

## Read first

- `tamagui.config.ts` (`darkBrand`, no light override), `src/app/_layout.tsx` (`ACCENT`, `INACTIVE`,
  `NAV`), `src/shared/ui/{Gauge,ValueCard,StatusBadge,Screen,AppSplash,RootErrorBoundary}.tsx`.
- `src/features/settings/ui/SettingsScreen.tsx` (`Seg` = `Button size="$2"`, 13 instances),
  `src/features/error-log/ui/ErrorLogScreen.tsx` (`Chip`, icon-only delete), `DashboardScreen.tsx`
  (three `circular` icon buttons), `VehicleSelectScreen.tsx` / `MoreScreen.tsx` / `HintCard.tsx`
  (pressable cards/rows), `ConnectionScreen.tsx` (`STATUS_CONFIG` colours).
- Tamagui v3 size tokens (`node_modules/@tamagui/themes/dist/esm/v3-tokens.mjs`): `$2` = 28 px,
  `$3` = 36, `$4` / `$true` = 44. Button height = the size token (`@tamagui/get-button-sized`).
- The `grep` inventory commands above — re-run them at the start and at the end.

## Design

### 1. Theme tokens instead of hex

`tamagui.config.ts`: add brand/semantic tokens to **both** themes and stop importing hex into
components.

```ts
const brand = { accent: '#2bb673', accentOnDark: '#2bb673', accentOnLight: '#1E7F52' }; // #1E7F52 on #FFF = 4.6 AA
const semanticDark  = { statusOk: '#3fb950', statusWarn: '#E3B341', statusError: '#F85149', statusInfo: '#58a6ff', statusFatal: '#a371f7', muted: '#8B949E', placeholderColor: '#6E7681' /* 4.7 AA on #0D1117 */ };
const semanticLight = { statusOk: '#1A7F37', statusWarn: '#9A6700', statusError: '#CF222E', statusInfo: '#0969DA', statusFatal: '#8250DF', muted: '#57606A', placeholderColor: '#6E7781' };
themes: { ...base, dark: { ...base.dark, ...darkBrand, ...semanticDark, accent: brand.accentOnDark },
                   light: { ...base.light, ...semanticLight, accent: brand.accentOnLight } }
```

Verify every new light value ≥ 4.5 on `#FFFFFF` and every dark value ≥ 4.5 on `#0D1117` with the
script in `scripts/contrast-check.mjs` (add it; it reads `tamagui.config.ts` via a tiny regex
extractor or a JSON mirror `src/shared/ui/palette.json` that the config imports — prefer the JSON
mirror so the script and the app share one source). Components then use `$accent`, `$statusError`,
`$muted` … (`color="$statusError"`), and `useTheme()` for places that need a raw string (SVG
strokes in `Gauge`, `AppLogo` badge, chart series, lucide `color` props):
`const t = useTheme(); <Icon color={t.accent.val} />`.

`_layout.tsx`: `ACCENT`/`INACTIVE`/`NAV` derive from `useTheme()` inside `RootLayout` (it already
reads the scheme). Chart series palette becomes `[t.accent.val, t.statusInfo.val, t.statusWarn.val,
t.statusError.val]`. `dtcReport.ts` (HTML export) keeps its own inline CSS — out of scope, it is
not on-screen UI.

White text on coloured fills: `StatusBadge` switches to dark text (`color="$background"` of the
dark theme = `#0D1117`, 8+ contrast on every fill) or uses the `*8` tokens with `$color` — pick
dark text. `AppSplash` title/subtitle: `#0D1117` on the brand green (8.04).

### 2. Names, roles, states on every control

Rules (write them into `docs/accessibility.md`):

- Icon-only `Button` (`circular`, `icon=` with no text child) **must** have `accessibilityLabel`.
  Dashboard: `Move ${label} up` / `… down` / `Hide ${label}` | `Show ${label}`; ErrorLog delete:
  `Delete error: ${e.source}`; MoreScreen chevrons are decorative (`accessibilityElementsHidden`).
- Pressable `Card` / `XStack` rows get `accessibilityRole="button"` + `accessibilityLabel`
  (VehicleSelect: `${p.name}. ${protocol}. ${active ? 'Selected' : 'Not selected'}`;
  HintCard dismiss already labelled; MoreScreen already labelled).
- Segmented groups (`Seg`, `Chip`, the theme/poll/timeout rows): each option gets
  `accessibilityRole="radio"` and `accessibilityState={{ selected: active, checked: active }}`; the
  group container gets `accessibilityRole="radiogroup"` and a label (`Adapter source`). Implement
  once in a shared `src/shared/ui/SegmentedControl.tsx` (`options: { value, label }[]`, `value`,
  `onChange`, `label`) and replace the ad-hoc `Seg`/`Chip` copies (Settings ×13, ErrorLog chips,
  SettingsScreen AI section).
- Toggles that are two `Seg` buttons (`On`/`Off`) become Tamagui `Switch` with
  `accessibilityRole="switch"` and `accessibilityState={{ checked }}` + a visible label (Enabled,
  Auto-reconnect).
- Every `Input` gets `accessibilityLabel` (Server URL, Model, MAC address, Custom DTCs, capture note).
- `Screen` title `H2` gets `accessibilityRole="header"`; section titles (`Text fontWeight="800"
fontSize="$5"`) become a shared `SectionTitle` with `accessibilityRole="header"`.
- Live values: `ValueCard` and `Gauge` are already `accessible` with labels; add
  `accessibilityLiveRegion="polite"` **only** on the Faults readiness/MIL panel and the connection
  `StatusHero` (not on 1 Hz live values — screen readers would never stop talking).
- Decorative SVG (`AppLogo`): `accessibilityElementsHidden` + `importantForAccessibility="no"`
  except in the splash where the title carries the name.

### 3. Touch targets ≥ 44 pt

`Seg` is `size="$2"` → 28 px tall; `Chip` and the dashboard `circular size="$2"` buttons are 28 px.
Policy: interactive controls use `size="$3"` minimum (36 px) **plus** `hitSlop={8}` (reaches 52 px),
or `size="$4"` (44 px). `SegmentedControl` renders `size="$3"` + `hitSlop`. Icon buttons:
`size="$3"` + `hitSlop={8}`. Add an ESLint rule? Not available for Tamagui props — rely on the UI
test below (it inspects `hitSlop`/height is not possible in RNTL) and a code-review checklist
line.

### 4. Dynamic type

- Do not disable scaling globally. Policy: body/labels scale freely; display numbers
  (`Gauge` value `fontSize="$9"`, `ValueCard` value `$8`, Splash title) get
  `maxFontSizeMultiplier={1.3}` so tiles don't overflow; `numberOfLines` already set where needed.
  Tamagui `Text` forwards RN props, so `maxFontSizeMultiplier` works unchanged.
- `ValueCard` `minWidth={150}` + `flex={1}` wraps; verify at 200 % font scale (Android: Settings →
  Display → Font size largest + Display size) that gauges keep their arc and the Live grid wraps to
  one column. Fix with `flexBasis="48%"` → `"100%"` under `useWindowDimensions().fontScale > 1.5`.
- Tab bar labels: `tabBarLabelStyle.fontSize: 10` — allow scaling (remove the fixed size or set
  `allowFontScaling: true` with `maxFontSizeMultiplier: 1.5` in `screenOptions`).

### 5. Reduced motion

`src/shared/lib/useReducedMotion.ts`: `AccessibilityInfo.isReduceMotionEnabled()` +
`addEventListener('reduceMotionChanged')`, returns boolean. `AppSplash`: skip the pulse loop and
the scale interpolation when enabled (fade still runs; `FADE_MS` → 150). Tamagui `pressStyle`
scale (`VehicleSelectScreen` `scale: 0.99`) → omit the scale when reduced motion.

### 6. Automated check (plan 10 harness)

`src/features/__a11y__/tabScreens.a11y.test.tsx` (ui project): render each of the seven tab
screens with the simulator session connected (reuse `connectionService.connect()` in mock mode),
then:

```ts
const pressables = screen
  .UNSAFE_getAllByProps({ accessibilityRole: 'button' })
  .concat(screen.UNSAFE_queryAllByProps({ onPress: expect.any(Function) }));
for (const p of pressables) expect(accessibleName(p)).not.toBe(''); // accessibilityLabel, or text content of children
```

Implement `accessibleName(node)` in `test/a11y.ts` (walks `props.accessibilityLabel`, then
`children` strings). Also assert no `Text` child of a `Button` is empty and every `Input` has a
label. Add `jest-expo`'s `toBeAccessible`? Not available — keep the custom walker.

## Steps

1. `palette.json` + `tamagui.config.ts` light/dark semantic tokens; `scripts/contrast-check.mjs`
   wired into `npm run ci` (fails under 4.5 for text tokens, 3.0 for `*Fill`/decorative tokens).
2. Replace hex in the 22 files with tokens / `useTheme()`; delete the constants in `_layout.tsx`.
3. `SegmentedControl.tsx`, `SectionTitle.tsx`; migrate Settings, ErrorLog, AI section, theme/poll
   rows; Switch for On/Off pairs.
4. Labels on icon buttons, pressable rows, inputs; roles/states; live regions.
5. Touch-target sizes + `hitSlop`; dynamic-type multipliers; tab label scaling.
6. `useReducedMotion` + AppSplash/pressStyle.
7. `tabScreens.a11y.test.tsx`; `docs/accessibility.md`; `npm run ci`.

## Tests

- `scripts/contrast-check.mjs` exits non-zero on a failing pair (unit-test the ratio function in
  `src/shared/lib/contrast.test.ts` — put `contrastRatio(hexA, hexB)` in `src/shared/lib/contrast.ts`
  and have the script import the compiled logic or duplicate the 10-line formula with a shared
  fixture: `contrastRatio('#FFFFFF', '#0D1117')` ≈ 18.9, `('#2bb673', '#FFFFFF')` ≈ 2.61).
- `useReducedMotion` logic: pure `shouldAnimate(reduceMotion: boolean)` trivial; skip.
- `tabScreens.a11y.test.tsx` as above; `SegmentedControl.test.tsx`: renders radios with
  `accessibilityState.selected` on the active one; `onChange` fires with the value.

## Docs

- New `docs/accessibility.md`: rules 1–6, the contrast table, how to run the check, the review
  checklist line ("new control → name, role, state, ≥ 44 pt").
- `docs/features/settings.md`, `docs/features/live-data.md`: SegmentedControl / live-region notes.
- `docs/architecture.md` § UI: palette tokens are the only colour source.

## Acceptance

- [ ] `grep -rnE "#[0-9A-Fa-f]{6}\b" src --include=*.tsx` returns only `palette.json`-adjacent
      files (`tamagui.config.ts`) and `dtcReport.ts`.
- [ ] `node scripts/contrast-check.mjs` passes; flipping a light token to `#2bb673` fails it.
- [ ] TalkBack on the Android emulator: every Settings segment announces "radio button, selected /
      not selected"; dashboard reorder buttons announce "Move RPM up"; Vehicle cards announce name,
      protocol and selection state.
- [ ] Font size largest + display size largest: Live, Faults, Settings scroll without clipped text;
      gauges remain circular.
- [ ] Reduce motion on: splash shows no pulse; cards don't scale on press.
- [ ] `tabScreens.a11y.test.tsx` fails when a label is removed from a dashboard icon button
      (prove once); `npm run ci` green.

## Out of scope

Translating labels (plan 11 — write them through `t()` once it lands); tablet layouts (plan 21);
the HTML report's inline colours.
