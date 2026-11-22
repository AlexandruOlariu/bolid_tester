# Accessibility

How the app stays usable with TalkBack / VoiceOver, large text, Reduce motion and both colour
themes ([plan 20](./plans/20-accessibility-pass.md)). The rules below are enforced where a machine
can check them (the contrast check, the screen sweep test) and by review where it cannot.

**Review checklist line:** _new control → name, role, state, ≥ 44 pt; new colour → a palette token._

## 1. Colour: palette tokens only

`src/shared/ui/palette.json` is the **only colour source for on-screen UI**. `tamagui.config.ts`
merges each theme's `text`, `graphic` and `onFill` entries into **every** light / dark theme
(sub-themes such as `dark_alt2`, `dark_green` and component themes included), so these tokens
resolve anywhere:

| Token                   | Use                                                    | Dark      | Light     |
| ----------------------- | ------------------------------------------------------ | --------- | --------- |
| `$accent`               | brand accent as text / icon / border, tab tint         | `#2bb673` | `#1E7F52` |
| `$muted`                | secondary icons, inactive tab, `theme="alt2"` text     | `#8B949E` | `#57606A` |
| `$statusOk`             | good / passed / "distances agree"                      | `#3fb950` | `#1A7F37` |
| `$statusWarn`           | attention, connecting, warnings, experimental badges   | `#E3B341` | `#9A6700` |
| `$statusError`          | errors, DTC codes, MIL on, failed                      | `#F85149` | `#CF222E` |
| `$statusInfo`           | information, hints, chart series 2                     | `#58a6ff` | `#0969DA` |
| `$statusFatal`          | fatal error-log entries                                | `#a371f7` | `#8250DF` |
| `$placeholderColor`     | input placeholders                                     | `#7D8590` | `#656D76` |
| `$gaugeTrack` (graphic) | the gauge's unfilled arc                               | `#6E7681` | `#868E96` |
| `$onFill`               | text on a status / accent fill (StatusBadge, severity) | `#0D1117` | `#FFFFFF` |

- In Tamagui props use the token: `color="$statusError"`, `borderLeftColor="$accent"`.
- Where a raw string is needed — lucide icon `color`, react-native-svg strokes and fills, chart
  series — use `usePalette()` (`src/shared/ui/usePalette.ts`), e.g.
  `<Bug color={usePalette().accent} />`. Feature maps store a `Tone` (`'statusWarn'`, …), not
  a hex.
- An icon inside a themed `Button` is passed as an **element without a colour**
  (`icon={<Download size={16} />}`): Tamagui gives it the button's own text colour. A function
  (`icon={() => <X color="#fff" />}`) bypasses the theme — don't.
- Tamagui's scale colours `$red10` / `$green10` / `$orange10` / `$blue10` / `$yellow10` miss 4.5:1
  on the light background (3.4–4.4); use the semantic tokens for text instead — also when a token
  name is built at runtime (the scan-diff `Badge` takes a `statusWarn | statusError | statusOk`
  tone, not a scale colour name).
- **Status pills are a semantic fill with `$onFill` text**, never white / black on a scale fill
  (white on `$green8` / `$blue8` / `$red8` is 2.4:1 on light, black on dark `$yellow8` 3.3:1):
  `StatusBadge`, `VerificationBadge`, `UnlockBadge` (its neutral "No unlock needed" keeps `$color`
  on `$gray6`), the known-adapter chip in the connection list and the fault-code detail badge.
- React Navigation (header, tab bar) sits outside the Tamagui theme and reads `palette.json`'s
  `chrome` block and the tab tints directly (`src/app/_layout.tsx`).
- `brand` holds the fixed logo / splash artwork, the same in both themes: the splash title and
  subtitle are ink `#0D1117` on the brand green (7.25:1; white on it was 2.61:1), both fully opaque
  (ink at half opacity over the green is about 2.4:1, so the subtitle no longer pulses).
- Out of scope: the HTML / PDF exports (`dtcReport.ts`, `reportHtml.ts`, `vehicleReport.ts`) keep
  their inline CSS (`SEVERITY_COLOR` there is the export's palette; the Report screen's preview
  maps the severity to a `Tone` instead), and obd-core's map colour ramp (`analysis/track.ts`, `TRACK_PALETTE`) stays a
  pure data ramp whose meaning the legend text carries.

### The contrast check

`npm run check:contrast` (`scripts/contrast-check.mjs`, part of `npm run ci` and the CI `verify`
job) reads `palette.json` and fails when:

- a `text` token is under **4.5:1** on any of its theme's `surfaces` (screen, then card);
- a `graphic` token is under **3:1** (WCAG 1.4.11, non-text contrast);
- `onFill` is under 4.5:1 on a text token used as a fill (every text token but the placeholder);
- the header text or a tab tint is under 4.5:1 on the bar (`chrome.background`);
- the splash title and subtitle (`brand.ink` on `brand.green`, both at full opacity) are under
  4.5:1.

The WCAG formula and the rules live in `src/shared/lib/contrast.ts` (unit-tested in
`contrast.test.ts`: `contrastRatio('#FFFFFF', '#0D1117')` ≈ 18.9, `('#2bb673', '#FFFFFF')` ≈ 2.61);
the script transpiles that same file. `--verbose` prints every pair; `--palette <file>` checks
another file — flipping the light accent back to `#2bb673` fails four pairs.

Current ratios (lowest per token, both surfaces): dark — accent 6.62, muted 5.62, ok 6.81, warn
8.89, error 5.16, info 6.85, fatal 5.16, placeholder 4.64, gauge track 3.77; light — accent 4.69,
muted 6.02, ok 4.78, warn 4.58, error 5.04, info 4.89, fatal 4.75, placeholder 4.94, gauge track
3.13. Before plan 20 the light theme failed for every accent used as text (`#2bb673` 2.61, amber
1.95, `#d29922` 2.52, `#4c9df3` 2.83) and the dark placeholder was 2.28.

## 2. Names, roles, states

- **Every Tamagui `Button` is one accessibility element**: `tamagui.config.ts` sets
  `defaultProps: { Button: { accessible: true } }`, as React Native's `Pressable` does by default.
  The screen reader focuses the button and reads its label or text, not the text inside it.
- **Icon-only buttons** (`circular`, `icon=` and no text) **must** have `accessibilityLabel`:
  Live → Customize `Move RPM up` / `Move RPM down` / `Hide RPM` | `Show RPM`; Error log
  `Delete error: <source>`; the follow-up **Send the question**.
- **Pressable `Card` / `XStack` rows** get `accessible`, `accessibilityRole="button"` and an
  `accessibilityLabel`. Vehicle cards read `<name>. <protocol>. Selected | Not selected` with
  `accessibilityState.selected`; a card with buttons inside (garage: Edit / Export / Delete;
  built-in: Share as starting profile) also offers them as `accessibilityActions`, because
  VoiceOver does not reach controls inside an accessibility element. More rows, timeline rows and
  first-run steps are labelled the same way. Expand / collapse rows (Module scan results, Coding
  car backups) also carry `accessibilityState.expanded`. Decorative chevrons (`›`, `ChevronRight`) are hidden
  (`accessibilityElementsHidden` + `importantForAccessibility="no"`).
- **Single choice → `SegmentedControl`** (`src/shared/ui/SegmentedControl.tsx`: `label`,
  `options: { value, label, accessibilityLabel? }[]`, `value`, `onChange`, `vertical?`): the group
  is a `radiogroup` with a spoken name, each option a `radio` with `accessibilityState.selected` and
  `.checked`, so TalkBack says "radio button, selected". Used by Settings (theme, poll interval,
  AI provider, structured output, timeout, adapter source, simulated vehicle, injected DTCs), the
  error-log severity filter, History and Trips car filters, the trip-map colouring and the
  vehicle editor (fuel, base profile — `vertical`). Terse labels get a spoken one (`15s` →
  "15 seconds", `250 ms` → "250 milliseconds").
- **Several choices** (History event kinds, Charts' panel picker) are `checkbox` buttons with
  `accessibilityState.checked`.
- **Views of one screen** (Live: Dashboard | All sensors) are `tab`s with `selected`.
- **On / off → a switch**, never two On / Off buttons: `LabeledSwitch` (visible label + switch) or
  `AccessibleSwitch` (`src/shared/ui/LabeledSwitch.tsx`) adds what Tamagui's native `Switch` leaves
  out — `accessible`, `role="switch"`, a required name and `accessibilityState.checked` /
  `.disabled` — plus an 8 dp hit slop. Each Alerts rule (`Alert <rule>`); Settings' AI **Enabled**, **Send anonymous crash reports**
  (switching on still asks first; the switch stays off until **Turn on**), **Auto-reconnect** and
  **Recognise my cars by VIN**; the Notifications categories; the unlock switches of Coding,
  Adaptations and Routines; Coding bit switches; Extended PIDs' log switches; the drive-cycle
  coach; seed-key "Only for this car"; the feedback "Keep VIN and adapter address".
- **Every `Input` / `TextArea` has `accessibilityLabel`** — a placeholder is not a name (it goes
  once the field has text): AI server URL, AI model, API key, flow name, Wi-Fi host / port, MAC
  address, custom DTCs, odometer, VIN, scan search, history filter, car name / year / notes, …
- **Headings**: the `Screen` title (`H2`) has `accessibilityRole="header"`; section titles use
  `SectionTitle` (`src/shared/ui/SectionTitle.tsx`, the former inline `fontWeight="800"
fontSize="$5"` text) or the section labels of Settings / More / Backup, all `header`.
- **Live regions** — `accessibilityLiveRegion="polite"` only where a change matters and is rare:
  the connection `StatusHero` ("OBD2 adapter: Connected") and the Faults readiness / MIL panel
  (one element: "Readiness. Check-engine light (MIL) on. 3 of 5 monitors complete. 2 stored fault
  codes."). **Never** on the 1 Hz live values — the screen reader would never stop talking.
  `ValueCard` and `Gauge` are single elements (`text`, `progressbar` with
  `accessibilityValue`) read on focus.
- **Decorative art**: `AppLogo` is hidden from accessibility everywhere (the header title and the
  splash text carry the name); the splash spinner is labelled "Loading your saved data".

## 3. Touch targets ≥ 44 pt

Tamagui v3 sizes: `$2` = 28 dp, `$3` = 36, `$4` = 44. Interactive controls are `size="$3"` with
`hitSlop={HIT_SLOP}` (8 dp → 52 dp, exported from `src/shared/ui`) or `size="$4"`. No `Button`
in `src/` is `size="$1"` / `"$2"`, or `size="$3"` without the slop; pressable icon rows (hint /
first-run dismiss) pad `$2` plus the slop, first-run steps are at least 44 dp tall. No lint rule
can see Tamagui sizes and Testing Library cannot measure height, so
`src/shared/ui/touchTargets.test.ts` parses the source and fails on a Tamagui `Button` that breaks
the rule (a `Button` with a `{...spread}` is skipped). Other pressables stay the review checklist's
"≥ 44 pt"; the `SegmentedControl` test asserts its options' size and slop.

## 4. Dynamic type

Text scales with the OS font size; nothing disables scaling globally.

- Display numbers are capped so tiles keep their shape: `Gauge` value and unit, `ValueCard` value
  (also `numberOfLines={1}`), the fuel-economy number and the splash title / subtitle use
  `maxFontSizeMultiplier={1.3}`.
- Every `Input` is capped at 1.5× (`tamagui.config.ts` `defaultProps`): Tamagui inputs have a
  fixed height, so larger text was clipped top and bottom.
- Label / value rows wrap instead of overflowing: Info's rows put a long value (VIN, protocol) on
  its own line, and the Faults readiness header moves the MIL state under the title.
- Above font scale 1.5 (`LARGE_TEXT_FONT_SCALE`, `src/shared/ui/ValueCard.tsx`) every `ValueCard`
  goes full width, one per row — Live's Dashboard and All sensors views, Faults, Battery, DPF … —
  and so do All sensors' injection tiles; the tablet's Live card column computes one card per row.
- Tab-bar labels scale (a custom `tabBarLabel`, 11 pt, capped at 1.5×, keeping React Navigation's
  spacing when the label sits beside the icon) and the header title is
  capped at 1.5× (`src/app/_layout.tsx`).

## 5. Reduced motion

`useReducedMotion()` (`src/shared/ui/useReducedMotion.ts`) reads
`AccessibilityInfo.isReduceMotionEnabled()` and follows `reduceMotionChanged`. With it on:

- `AppSplash` skips the looping logo pulse; the fade-out still runs, shortened from 380 ms to
  150 ms. (The subtitle never animates: it stays fully opaque for contrast.)
- Vehicle cards drop the 0.99 press scale (opacity feedback stays).

## 6. Automated checks

- `test/a11y.ts` — `a11yProblems(root)` walks a rendered tree and returns one plain-English line
  per problem: a pressable with no name (label or text), no role, or that is not an accessibility
  element; a text input without `accessibilityLabel`; a switch / radio / checkbox without a checked
  state or a name. `test/a11y/a11yWalker.test.tsx` proves each rule fires.
- `test/a11y/screens.a11y.test.tsx` — renders **every route in `src/app`** (a new route is picked
  up automatically) disconnected and on the simulator with stored codes, plus the states that only
  exist after a tap or with data (Live → Customize, Settings → Developer & simulator (its own page) with the
  simulator source and custom DTCs, an error-log entry), and expects no problems. Removing the label
  from a dashboard icon button fails it.
- `src/shared/ui/touchTargets.test.ts` — every Tamagui `Button` in `src/` is `$4`, or `$3` with
  `hitSlop` (§ 3).
- `src/shared/ui/SegmentedControl.test.tsx` (radios, selection, `onChange`, size and slop,
  switches), `useReducedMotion.test.tsx` (the hook; the splash with and without Reduce motion),
  `src/shared/lib/contrast.test.ts`, and per-screen assertions in the Settings, Live and Vehicle
  tests (`getByRole('radio' | 'switch' | 'button', { name })`).

Run: `npm run check:contrast`, `npm run test:ui -- --testPathPattern a11y`.

## Manual check (TalkBack / large text)

Not automatable; do it before a release on an Android emulator:

1. TalkBack on: every Settings segment says "radio button, selected / not selected"; the dashboard
   reorder buttons say "Move RPM up"; vehicle cards say name, protocol and selection state.
2. Settings → Display → Font size largest + Display size largest: Live, Faults and Settings scroll
   without clipped text; gauges stay circular; the Live cards are one per row.
3. Settings → Accessibility → Remove animations: the splash shows no pulse; cards don't shrink on
   press.

### Results — 2026-11-22 (emulator `Sere_API36`, Android 16, 1080 × 2400, release APK)

Run over adb (`settings put system font_scale 2.0` + `wm density 560`, i.e. font size and display
size at their largest, then reset), opening Connect, Vehicle, Live, Faults, Info, Settings and More
by deep link with the simulator connected (Golf profile, two stored codes):

- **Fixed in this pass:** Info's label / value rows ran the value off the card (VIN, calibration
  ID, protocol, adapter cut at the right edge) — the row now wraps and the value shrinks
  (`VehicleInfoScreen` `Row`); Live's fuel-economy title ("Fuel economy (fuel-rate)") wrapped under
  `numberOfLines={1}` with its second line clipped — it now wraps freely; every `Input` (More's
  search, maintenance odometer, custom DTCs …) clipped its text at 2× because Tamagui inputs have a
  fixed height — `tamagui.config.ts` `defaultProps` now caps Input scaling at 1.5×
  (`src/shared/ui/inputFontScale.test.tsx`).
- **Accepted:** at both maxima, tab-bar labels and two-up buttons ellipsize ("Co…", "Dashbo…",
  "Add fro…") and the simulator strip shows only the start of its text next to **Use real
  adapter**; each keeps its full accessible name. Faults, Settings, Vehicle and More wrap and scroll
  without clipping; gauges stay circular.
- **TalkBack (by hierarchy, not by ear):** TalkBack is installed on the image but was not turned on —
  driving the app by adb with TalkBack's gestures is not reliable. Instead `uiautomator dump` on the
  same seven screens, top and three scrolls down, at font scale 1.0: every clickable / checkable
  element and text field has a text or content description (0 unlabelled of 92). Settings segments
  are `RadioButton`s with the right `checked` state, toggles are `Switch`es, vehicle cards read
  name, protocol and "Selected / Not selected". Step 1's spoken output and step 3 (Remove
  animations) still need a person.
- **Simulator banner (plans 01 / 07):** with the simulator on, the strip is on all seven tabs and
  on hidden routes (battery, maintenance, …); **Use real adapter** removes it everywhere.
