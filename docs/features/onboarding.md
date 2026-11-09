# Feature: onboarding

First-run guidance: dismissible hints and the three-step "Getting started" card on the Connect tab.
No screen of its own — its components are embedded in other features' screens.

## UI

- **`HintCard`** — a dismissible tip (`id`, `title`, body). Renders nothing once its `id` has been
  dismissed; the dismissal persists across launches. Used by the Live charts screen
  (`charts-gestures`).
- **`FirstRunCard`** — on the Connect tab ([connection](./connection.md#first-run)). Lists three
  steps, each with a check icon when done and a chevron that routes to the step's screen:
  1. **Pick your car** → `/vehicle`, with a **Use Auto / Generic** button for owners whose car has no
     profile;
  2. **Connect the adapter** → `/` (Connect);
  3. **Read fault codes** → `/faults`.

  It has its own dismiss button and dismisses itself when it sees the last open step get done.
  Only that change dismisses it: after Settings → **Show hints again** it returns even when every
  step is already done this session (all three ticked) and stays until the user closes it.

## model

- **`onboardingStore`** (Zustand, persisted as `bolid.onboarding`, version 1; lives in
  `src/shared/state/onboardingStore.ts` since the plan 07 review so Settings' **Show hints again**
  reads it without a feature → feature import; the slice's `index.ts` re-exports it): the **set
  of dismissed hint ids**, not per-hint booleans, so a new hint needs no migration (an unknown id is simply "not
  yet dismissed"). `dismiss(id)` is idempotent; `reset()` clears all. Known ids:
  - `first-run` — the whole first-run card (manual dismiss or auto-dismiss on completion);
  - `first-run-generic-ok` — the user accepted the Auto / Generic profile, so step 1 counts as done;
  - `charts-gestures` — the chart tap / pinch / pan hint.
  - `connect-basics` — legacy id of the old Connect-tab hint, replaced by the first-run card; a
    persisted dismissal is harmless.
- **`firstRun.ts`** (pure, unit-tested): `firstRunSteps(input)` returns the three steps with `done`
  flags derived from `{ selectedProfileId, genericAccepted, connectionStatus, dtcLastReadAt }`;
  `firstRunComplete(input)` is true only when all three are done.

## Behavior

- Step state comes from live stores: `vehicleStore.selectedProfileId` (done when not `'generic'`,
  or `first-run-generic-ok` dismissed), `sessionStore.status === 'connected'`, and
  `dtcStore.lastReadAt !== null` (stamped by every successful fault read from a live session —
  `dtcService.readAll()` resolves `null` with no session and the hook then calls `clearResults()`,
  which does not stamp; in-memory, so it reflects this session).
- When the last open step gets done (the card renders with incomplete steps, then complete), the
  card dismisses `first-run` and stays hidden after a restart; until then a user can dismiss it
  manually at any point. It is the transition that dismisses, not the done steps: once `reset()`
  clears `first-run`, the card renders again with whatever steps are done (possibly all three).

## Acceptance

- A fresh install shows the first-run card on the Connect tab with no step done.
- Picking a profile (or tapping **Use Auto / Generic**), connecting, and reading faults ticks each
  step; the third tick auto-dismisses the card, and it does not return after a restart.
- A dismissed hint never reappears unless `reset()` is called; then the first-run card shows again
  even if every step is already done this session.
