# Plan 10 — Component tests and an end-to-end smoke flow

**Size:** M (1–1½ days) · **Depends on:** plan 01 (first-run UI is the first thing to test) ·
**Roadmap:** v0.5 "Component + e2e tests"

## Goal

The test pyramid gains a UI layer: React Native Testing Library renders the seven tab screens
against the real zustand stores and the simulator-backed session; a Maestro flow drives the debug
APK through connect → read faults → clear. CI runs the component tests on every push; the e2e flow
runs nightly / on demand.

## Why

`jest.config.js` is `preset: 'ts-jest', testEnvironment: 'node', testMatch: ['**/*.test.ts']`. All
504 tests are pure logic. A screen can stop rendering and only `tsc` would notice.

## Read first

- `jest.config.js`, `tsconfig.json`, `tsconfig.app.json`, `babel.config.js`, `package.json`.
- `src/app/_layout.tsx`, `tamagui.config.ts`.
- The seven tab screens and the hooks they use: `ConnectionScreen`, `VehicleSelectScreen`,
  `DashboardScreen`, `FaultCodesScreen`, `VehicleInfoScreen`, `SettingsScreen`, `MoreScreen`.
- `src/features/connection/api/connectionService.ts` (how the mock session is created — tests can
  call `connect()` in mock mode for real).
- Native-module import sites: `grep -rn "await import('expo-" src` and `react-native-ble-plx` usages.

## Design

### Jest: two projects

```js
// jest.config.js
const alias = { '^@/(.*)$': '<rootDir>/src/$1' };
module.exports = {
  projects: [
    {
      displayName: 'core',
      preset: 'ts-jest',
      testEnvironment: 'node',
      roots: ['<rootDir>/src'],
      testMatch: ['**/*.test.ts'],
      moduleFileExtensions: ['ts', 'js', 'json'],
      moduleNameMapper: alias,
      clearMocks: true,
    },
    {
      displayName: 'ui',
      preset: 'jest-expo',
      roots: ['<rootDir>/src'],
      testMatch: ['**/*.test.tsx'],
      moduleNameMapper: alias,
      setupFilesAfterEnv: ['<rootDir>/jest.setup.ui.ts'],
      transformIgnorePatterns: [
        'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|expo-modules-core|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|react-native-svg|react-native-safe-area-context|react-native-screens|tamagui|@tamagui/.*|lucide-react-native|zustand)/)',
      ],
      clearMocks: true,
    },
  ],
};
```

Dev dependencies (pin to the SDK): `jest-expo@~56.0.0`, `@testing-library/react-native@^13`,
`react-test-renderer@19.2.3` (must equal the `react` version). Scripts: `"test": "jest"`,
`"test:core": "jest --selectProjects core"`, `"test:ui": "jest --selectProjects ui"`. `npm run ci`
unchanged (runs both). `tsconfig.app.json`: add `"jest"` to `types` so `.test.tsx` files typecheck
in `typecheck:app` (they are included by `src/**/*.tsx`).

### `jest.setup.ui.ts`

- `jest.mock('react-native-ble-plx', () => ({ BleManager: jest.fn(() => ({ state: jest.fn(async () => 'PoweredOn'), onStateChange: jest.fn(() => ({ remove: jest.fn() })), startDeviceScan: jest.fn(), stopDeviceScan: jest.fn(), destroy: jest.fn() })), State: { PoweredOn: 'PoweredOn', PoweredOff: 'PoweredOff', Unauthorized: 'Unauthorized', Unsupported: 'Unsupported', Unknown: 'Unknown' } }))`.
- Virtual mocks for the tolerant imports so they resolve deterministically: `expo-file-system`
  (in-memory `Map` for `writeAsStringAsync`/`readAsStringAsync`/`deleteAsync`, `documentDirectory:
'file:///test/'`), `expo-sharing` (`isAvailableAsync: async () => false`), `expo-notifications`,
  `expo-haptics`, `expo-location`, `expo-secure-store` (in-memory), `expo-updates` (`isEnabled: false`).
  Use `jest.mock(name, factory, { virtual: true })` only where the package is not installed.
- `expo-router`: `jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, replace: mockPush, back: jest.fn() }), router: { push: mockPush }, useLocalSearchParams: () => ({}), Tabs: … }))` with `mockPush` exported from a `test/mocks/router.ts` so tests can assert navigation.
- `test/renderWithProviders.tsx`:
  ```tsx
  export function renderWithProviders(ui: React.ReactElement) {
    return render(
      <TamaguiProvider config={config} defaultTheme="dark">
        <Theme name="dark">{ui}</Theme>
      </TamaguiProvider>,
    );
  }
  ```
- Store reset helper `test/resetStores.ts`: `beforeEach` sets every zustand store back to its initial
  state (`useSettingsStore.setState(initial, true)` …) and clears `fileStateStorage` mocks.

Fallback if Tamagui fails under jest-expo (common pain points: `react-native-reanimated`, web
shims): add `moduleNameMapper` entries mapping `^tamagui$` and `^@tamagui/(.*)$` to
`test/shims/tamagui.tsx`, a thin shim exporting the used primitives as RN `View`/`Text`/`Pressable`
wrappers. Record which path was taken in `docs/testing.md`.

### First component tests (one file per tab screen)

| Test file                                                 | Cases                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `features/connection/ui/ConnectionScreen.test.tsx`        | mock source → renders **Connect to simulator** and the first-run card; BLE source → **Scan for adapters**; error in `sessionStore` → error panel text; pressing connect in mock mode reaches `status 'connected'` (real `connectionService.connect()` against `MockTransport`, `await waitFor`). |
| `features/vehicle-select/ui/VehicleSelectScreen.test.tsx` | lists 4 built-ins; tapping Golf selects it and navigates to `/dashboard`; VIN suggestion card appears when `sessionStore.info.vin` matches.                                                                                                                                                      |
| `features/live-data/ui/DashboardScreen.test.tsx`          | not connected → prompt; with `liveDataStore.values` seeded → RPM gauge value visible with its km/h · °C labels.                                                                                                                                                                                  |
| `features/fault-codes/ui/FaultCodesScreen.test.tsx`       | `dtcStore` with two stored codes → rows + descriptions; readiness panel MIL text; Guide toggle expands.                                                                                                                                                                                          |
| `features/vehicle-info/ui/VehicleInfoScreen.test.tsx`     | protocol label, VIN, supported-PID count from `sessionStore.info`.                                                                                                                                                                                                                               |
| `features/settings/ui/SettingsScreen.test.tsx`            | adapter-source segment updates the store; theme segment; Developer section collapsed (after plan 07).                                                                                                                                                                                            |
| `features/more/ui/MoreScreen.test.tsx`                    | every entry renders; tapping Error log pushes `/error-log`; search filters (after plan 07).                                                                                                                                                                                                      |

Keep each under ~150 lines; prefer `getByRole('button', { name })` / `getByText`; add
`accessibilityLabel`s where a control is otherwise unreachable (this doubles as the start of the
accessibility pass).

### Maestro smoke flow

`.maestro/simulator-smoke.yaml`:

```yaml
appId: com.bolidtester.app
---
- launchApp: { clearState: true }
- tapOn: 'Settings'
- tapOn: 'Developer & simulator' # after plan 07; before it: skip this line
- tapOn: 'Simulator (no car)'
- tapOn: 'P0299'
- tapOn: 'Connect'
- tapOn: 'Connect to simulator'
- assertVisible: 'Connected'
- tapOn: 'Faults'
- assertVisible: 'P0299'
- tapOn: 'Clear codes' # use the real button label from FaultCodesScreen (verify)
- tapOn: 'Clear' # the Alert confirm
- assertVisible: 'None'
```

Local run: `maestro test .maestro/simulator-smoke.yaml` against a running emulator with the debug
build installed (`npm run android`). CI: `.github/workflows/e2e.yml` on `workflow_dispatch` and a
nightly cron, using `reactivecircus/android-emulator-runner@v2` (API 34, x86_64), building the debug
APK (`./gradlew assembleDebug` after prebuild — add a `--no-daemon`), installing it, then running
Maestro. Mark the job non-required.

## Steps

1. Install deps; split `jest.config.js`; `jest.setup.ui.ts`; `test/` helpers; make one trivial
   `.test.tsx` pass (`renders Screen title`).
2. Tab-screen tests in the table order; fix any real rendering bugs found (log them in the PR).
3. `tsconfig.app.json` types; `npm run ci`.
4. Maestro flow + `e2e.yml`.
5. `docs/testing.md`: "Component tests" and "End-to-end" sections (how to run, how to mock a native
   module, the Tamagui decision).

## Acceptance

- [ ] `npm run test:ui` runs ≥ 7 suites green; `npm test` runs both projects; CI time increase
      under 2 minutes.
- [ ] Deleting a `Tabs.Screen` title or breaking a store import makes a UI test fail (prove once).
- [ ] `maestro test` passes locally on the emulator; `e2e.yml` runs on dispatch. (Moved to
      **Owner actions** below when the plan landed.)
- [ ] `docs/testing.md` updated.

## Owner actions

Added when the plan landed: the Maestro flow (`.maestro/simulator-smoke.yaml`) and the workflow
(`.github/workflows/e2e.yml`) are written, YAML-valid and checked label by label against the source,
but neither has run. The implementing session could not install the Maestro CLI (no external
downloads) or push the branch to dispatch the workflow. Everything else in this plan is shipped.

Procedure (owner, dev workstation with the Android emulator):

1. Install the Maestro CLI ([install guide](https://docs.maestro.dev/getting-started/installing-maestro))
   and check `maestro --version`.
2. Boot the AVD, then install a build: `npm run prebuild:android` and `npm run android` with
   `npm start` running, or a release APK (see the `android-apk` skill), which embeds the bundle.
3. Run `maestro test .maestro/simulator-smoke.yaml`. Watch the two risky steps listed in
   [testing.md → End-to-end](../testing.md#end-to-end): the bare `Connect` tab taps, and the
   `(?i)clear` confirm matching the dialog button rather than **Clear codes**.
4. Push the branch and run `e2e.yml` from the Actions tab (**Run workflow**); check the JUnit
   artifact.
5. With the results: fix any label or timing mismatch in the flow, tick the acceptance item above,
   drop "first Maestro run pending (owner)" from the roadmap row and the plans README, and change the
   **Status** paragraph in `docs/testing.md` to record the first green run.
