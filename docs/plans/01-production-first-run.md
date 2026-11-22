# Plan 01 — Production defaults and first-run

**Size:** S (½ day) · **Depends on:** nothing · **Roadmap:** v0.2 "Production first-run"

## Goal

A fresh install behaves like a product: the Connect tab offers the real Bluetooth adapter, the
simulator is an explicit opt-in that is always visibly flagged, no fake fault is injected, and a
three-step first-run card walks the user from "pick car" to "read faults". Existing installs keep
whatever they already chose.

## Why

`src/shared/state/settingsStore.ts` ships `adapterSource: 'mock'`, `simulatedVehicleId:
'golf-plus-2009-20tdi'` and `injectedDtcs: ['P0299']`. A new user taps "Connect to simulator", sees
a fake Golf with a fake turbo fault, and has no idea none of it is their car.

## Read first

- `src/shared/state/settingsStore.ts` — defaults, `persist` options (`name: 'bolid.settings'`,
  `version: 1`, `partialize`, `merge`, `onRehydrateStorage`).
- `src/features/connection/ui/ConnectionScreen.tsx` — the `adapterSource === 'mock'` branch and the
  `HintCard id="connect-basics"`.
- `src/features/onboarding/model/onboardingStore.ts`, `src/features/onboarding/ui/HintCard.tsx`.
- `src/features/settings/ui/SettingsScreen.tsx` — "Adapter source", "Simulated vehicle", "Injected
  DTCs" sections (`Seg`, `SegGroup`, `SectionLabel` helpers).
- `src/app/_layout.tsx` — where `EngineHost` is mounted; the banner mounts beside it.
- `src/features/fault-codes/model/dtcStore.ts` — add `lastReadAt`.
- `docs/features/settings.md`, `docs/features/connection.md`, `docs/phase2-mobile-app.md` (step 1
  says "Simulator (default)").

## Design

### Defaults and migration (`settingsStore.ts`)

```ts
// new defaults
adapterSource: 'ble',
simulatedVehicleId: 'golf-plus-2009-20tdi',   // unchanged
injectedDtcs: [],                              // was ['P0299']
```

Bump `version: 2` and add a pure, exported migration so it is unit-testable:

```ts
/** v1 → v2: production defaults. Existing blobs keep their explicit adapterSource (a tester who chose
 *  the simulator must not be flipped under them); only *missing* fields get the new defaults. */
export function migrateSettings(persisted: unknown, fromVersion: number): Partial<SettingsState> {
  const p = (persisted ?? {}) as Partial<SettingsState>;
  if (fromVersion < 2) {
    return { ...p, adapterSource: p.adapterSource ?? 'ble', injectedDtcs: p.injectedDtcs ?? [] };
  }
  return p;
}
```

Wire it: `migrate: (persisted, version) => migrateSettings(persisted, version)`. Keep the existing
`merge` (deep-merges `ai`).

### Simulator banner

New `src/features/connection/ui/SimulatorBanner.tsx`, exported from
`src/features/connection/index.ts`:

- Renders only when `useSettingsStore((s) => s.adapterSource) === 'mock'`.
- One line, full width, amber (`backgroundColor="$yellow3"`, `borderBottomColor="$yellow7"`):
  `Simulator mode · emulating {simulatedVehicleId}` and a right-aligned chromeless button
  **Use real adapter** that calls `setAdapterSource('ble')` and, if `useSessionStore` status is
  `connected`, first calls `connectionService.disconnect()` (a simulator session must not survive the
  switch).
- `accessibilityRole="alert"`, `accessibilityLabel="Simulator mode is on. Readings are not from a real car."`
- Mount in `src/app/_layout.tsx` directly above `<Tabs …>` inside `RootErrorBoundary`, so it sits
  under the header on every screen. Do not put it inside `Screen` — hidden routes would miss it.

### First-run card

New `src/features/onboarding/model/firstRun.ts` (pure, tested):

```ts
export interface FirstRunInput {
  selectedProfileId: string;
  connectionStatus: 'disconnected' | 'connecting' | 'initializing' | 'connected' | 'error';
  dtcLastReadAt: number | null;
}
export interface FirstRunStep {
  id: 'vehicle' | 'connect' | 'faults';
  title: string;
  hint: string;
  done: boolean;
  route: string;
}
export function firstRunSteps(i: FirstRunInput): FirstRunStep[]; // 3 steps, done flags derived
export function firstRunComplete(i: FirstRunInput): boolean; // all three done
```

Rules: `vehicle` is done when `selectedProfileId !== 'generic'` **or** the user tapped "Use
Auto / Generic" (store that as a dismissed hint id `first-run-generic-ok`); `connect` is done when
`connectionStatus === 'connected'`; `faults` is done when `dtcLastReadAt !== null`.

New `src/features/onboarding/ui/FirstRunCard.tsx`: a `Card` listing the three steps with a check
icon when done and a chevron that `router.push(step.route)` (`/vehicle`, `/` (Connect), `/faults`).
Uses `HintCard`'s dismiss affordance with `id="first-run"`; auto-dismisses (calls `dismiss`) the
first time `firstRunComplete` is true. Replace the `connect-basics` `HintCard` on `ConnectionScreen`
with `<FirstRunCard />`.

`dtcStore.ts`: add `lastReadAt: number | null` (initial `null`); `set(r)` sets
`lastReadAt: Date.now()`. Not persisted (dtcStore is in-memory) — the first-run card is about this
install's first session; once dismissed it stays dismissed via `onboardingStore`.

### Connect-screen copy (mock branch)

Keep the existing panel but make the escape hatch explicit: add a `Button` **Use a real adapter**
(`setAdapterSource('ble')`) next to **Connect to simulator**, and change the panel text to
"Simulator mode is on — readings are not from a real car. Emulating: …".

### Settings copy

Rename the segments: `Simulator (no car)` / `Real adapter (Bluetooth)`. Under the group add a
`Paragraph theme="alt2" fontSize="$1"`: "The simulator emulates a real ECU so every screen works
with no hardware. A banner stays visible while it is on." Add to "Injected DTCs" a fourth segment
**Custom…** that reveals an `Input` accepting comma-separated codes (`/^[PCBU][0-9A-F]{4}$/i` each,
uppercased, invalid ones ignored) — QA needs arbitrary codes once plan 05 lands.

## Steps

1. `settingsStore.ts`: defaults, `version: 2`, `migrateSettings`, wire `migrate`.
2. `dtcStore.ts`: `lastReadAt`.
3. `onboarding/model/firstRun.ts` + `firstRun.test.ts`; `onboarding/ui/FirstRunCard.tsx`; export
   both from `src/features/onboarding/index.ts`.
4. `connection/ui/SimulatorBanner.tsx`; export; mount in `_layout.tsx`.
5. `ConnectionScreen.tsx`: swap the hint for `FirstRunCard`, add **Use a real adapter**, copy.
6. `SettingsScreen.tsx`: segment labels, helper copy, **Custom…** DTC input.
7. Docs (below). `npm run format`, `npm run ci`.

## Simulator

No protocol changes. The simulator is still selected from Settings; the banner is the only new
simulator-facing UI.

## Tests

- `src/shared/state/settingsStore.test.ts` (new; the store is node-safe — `persistStorage.test.ts`
  and `secureApiKey.test.ts` already import these modules):
  - fresh state has `adapterSource === 'ble'` and `injectedDtcs` empty;
  - `migrateSettings({ adapterSource: 'mock', injectedDtcs: ['P0299'] }, 1)` keeps both;
  - `migrateSettings({ theme: 'dark' }, 1)` yields `adapterSource 'ble'`, `injectedDtcs []`;
  - `migrateSettings(x, 2)` is identity.
- `src/features/onboarding/model/firstRun.test.ts`: all-false input → 0 done; generic + connected +
  read → `vehicle` false, others true; `firstRunComplete` true only when all done.
- Existing suites must stay green (`DiagnosticSession.test.ts` etc. do not read settings defaults).

## Docs

- `docs/features/settings.md`: "Adapter source — default **Real adapter (Bluetooth)**; Simulator is
  opt-in and shows a persistent banner"; document **Custom…** DTC injection; persist version 2 +
  migration rule.
- `docs/features/connection.md`: new "First run" section (three steps, where state comes from) and
  "Simulator banner".
- New `docs/features/onboarding.md` (UI: `HintCard`, `FirstRunCard` · model: `onboardingStore`
  dismissed ids incl. `first-run`, `first-run-generic-ok`, `charts-gestures` · Behavior · Acceptance).
- `docs/phase2-mobile-app.md` step 1: Simulator is no longer the default.
- Root `README.md` "Running the app": same.

## Acceptance

- [ ] Clear app data (or fresh install) → Connect tab shows **Scan for adapters** and the first-run
      card; no banner.
- [ ] Settings → **Simulator (no car)** → amber banner visible on Connect, Live, Faults, More and a
      hidden route such as `/history`; **Use real adapter** on the banner switches back and
      disconnects a live simulator session.
- [ ] With the simulator and **Injected DTCs: None**, Faults shows no codes; **Custom…** `P0135`
      shows `P0135`.
- [ ] A persisted v1 settings file with `adapterSource: 'mock'` still opens in simulator mode after
      upgrade (write the JSON by hand into the app's document dir, or trust the unit test).
- [ ] Completing pick-car → connect → read faults auto-dismisses the first-run card; it does not
      return after restart.
- [ ] `npm run ci` green; tests added as listed.

## Out of scope

Moving dev controls into a collapsed Developer section (plan 07); component tests of the new UI
(plan 10).
