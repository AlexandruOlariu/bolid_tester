# Plan 04 — Doc debt zero

**Size:** S (½ day) · **Depends on:** plans 01 and 03 write `onboarding.md` and `can-sniffer.md`
· **Roadmap:** v0.2 "Doc debt zero"

## Goal

Every slice under `src/features` has a spec in `docs/features`, the 1:1 rule is **enforced by a
test**, and the three stale overview docs (`phase2-mobile-app.md`, root `README.md`,
`docs/README.md`) describe the app as it is.

## Why

Five slices have no spec (`can-sniffer`, `engine-host`, `more`, `onboarding`, `sensor-readings`);
`docs/phase2-mobile-app.md` maps 7 features; the root README's feature table omits the whole
manufacturer tier. `docs/README.md` says "each `features/*.md` maps 1:1 to a feature slice" — make
that true and keep it true.

## Read first

- Any existing spec for the section skeleton, e.g. `docs/features/alerts.md` (UI / hooks / api /
  model / Behavior / Acceptance) and `docs/features/error-log.md`.
- `src/features/engine-host/EngineHost.tsx` and `pollPids.ts` (the spec describes these).
- `src/features/more/ui/MoreScreen.tsx`, `src/features/more/api/updates.ts`.
- `src/features/sensor-readings/ui/SensorReadingsScreen.tsx`.
- `docs/phase2-mobile-app.md`, root `README.md`, `docs/README.md`, `docs/architecture.md`.
- `src/shared/vehicles/vehicle-docs-sync.test.ts` — the pattern for the new enforcement test.

## Deliverables

### 1. Specs

| Spec                                                                  | Must cover                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/features/engine-host.md`                                        | Why it exists (finding F1); mounted once in `_layout.tsx`; the four engines (poll loop with period-not-gap timing and error dedup, alert evaluation + default-rule seeding, diagnostic/connection notifications fed by `dtcStore`, trip sampling); demand-driven PID union (`computePollPids`: registrations ∪ enabled alert-rule PIDs ∪ trip set); readiness coach every 30 s; the "only place allowed to read several feature stores" rule; Acceptance (one poll sweep per interval regardless of mounted screens; alerts fire without the Alerts screen; coach stops on disconnect). |
| `docs/features/more.md`                                               | The hub: sections and entries (after plan 07, grouped), `experimental` badge, search, "Check for updates" (`checkForUpdate` / `fetchAndReload` semantics, `unavailable` in dev clients); Acceptance (every hidden route in `_layout.tsx` is reachable from More or Info — list the two Info-linked ones).                                                                                                                                                                                                                                                                               |
| `docs/features/sensor-readings.md` **or** a section in `live-data.md` | Decide with plan 07: if plan 07 is scheduled next, write it as a "All sensors view" section of `docs/features/live-data.md` (groups: Engine, Temperatures, Air & boost, Fuel & injection, Electrical, Distance, Other; injection DIDs from `extendedPids` with `category: 'injection'`, CAN only). Otherwise a standalone spec. Either way, the enforcement test's alias map must reflect the choice.                                                                                                                                                                                   |
| `docs/features/onboarding.md`                                         | Written by plan 01 — verify it matches the shipped code.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `docs/features/can-sniffer.md`                                        | Written by plan 03 — verify.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

### 2. Enforcement test

New `src/shared/lib/featureDocsSync.test.ts` (inside the core tsconfig `include`):

```ts
const ALIASES: Record<string, string> = {
  inspection: 'used-car-inspection',
  maintenance: 'maintenance-log',
  'sensor-readings': 'live-data' /* if folded */,
};
const NO_SPEC_NEEDED = new Set<string>([]); // keep empty; add only with a comment why
// for each dir in src/features → docs/features/<alias ?? slug>.md exists
// for each docs/features/*.md (except tp20.md) → a slice exists (or it is in a KNOWN_SHARED list: ['tp20'])
```

### 3. Overview docs

- `docs/phase2-mobile-app.md` § "Feature ↔ code map": regenerate as a full table of all 32 slices
  (slug · route · spec), grouped Tier A / B / C like the audit. Fix step 1 (plan 01 already changed
  the default).
- Root `README.md`: "Status" gets lines for Phase 5, the 2026-07 improvement plan and 6b; the
  feature table gains the Tier C rows (module scan, adaptations, routines, coding, service reset,
  sniffer, adapter health) with the 🧪 note; "Running the app" reflects BLE default.
- `docs/README.md` index: add `plans/` ("Handoff-grade implementation plans") and the audit/roadmap
  rows (already present — verify).
- `docs/features/connection.md`: replace references to `ScanScreen`, `useAdapterStatus()` and
  `connectionStore` (none exist) with `ConnectionScreen`, `useScan` / `useConnect` /
  `useBluetoothState`, and `sessionStore` + `scanStore`; re-verify every identifier in the spec
  against the slice.
- `docs/vcds-parity-roadmap.md` § "Login codes": the claimed `2B` comment in `udsCoding.ts` does not
  exist; state plainly that no KWP login code ships (plan 22 adds it).
- `docs/architecture.md`: add one paragraph "Engine host" under "UI: feature-sliced" pointing at the
  new spec, since it is the one sanctioned cross-feature composition point.

### 4. Graph

Run `graph.py build`; confirm `documents` edges rose by the number of new specs
(`graph.py neighbors feature:engine-host` lists `doc:features/engine-host`). No new concepts needed
(`concept:engine-host`, `concept:can-sniffer`, `concept:app-shell` exist).

## Steps

1. Write the specs (order: engine-host, more, sensor-readings decision, verify onboarding + can-sniffer).
2. `featureDocsSync.test.ts`; run `npm test -- featureDocsSync` until green.
3. Overview docs; `npm run format`.
4. `graph.py build`; `npm run ci`.

## Acceptance

- [ ] `for d in src/features/*/; do …` loop from the audit prints no `MISSING`.
- [ ] `featureDocsSync.test.ts` fails when a spec is deleted (prove once locally).
- [ ] `docs/phase2-mobile-app.md` lists 32 slices; root README feature table includes Tier C.
- [ ] `npm run ci` green.
