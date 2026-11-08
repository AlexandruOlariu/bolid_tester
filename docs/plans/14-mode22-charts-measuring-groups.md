# Plan 14 — Mode 22 values in the poll loop and charts; VCDS-style measuring groups

**Size:** M (1–1½ days) · **Depends on:** nothing (plan 13 adds import of user label packs later)
· **Roadmap:** v0.3 "Mode 22 in charts", v0.6 "Measuring-block groups"

## Goal

Extended (Mode 22) DIDs flow through the same demand-driven poll loop as Mode 01 PIDs, so they plot
in Charts, show live on the Extended PIDs screen without a manual refresh, and can be grouped into
VCDS-style labelled **measuring groups** defined by label packs. Everything runs in the simulator.

## Why

`docs/features/extended-pids.md` § "Live plot (deferred)" explains the gap: `liveDataStore.setValues`
replaces the whole map each sweep and `EngineHost` polls Mode 01 only, so DIDs cannot reach
`live-charts`. The measuring-block CSV log covers recording but not live viewing. VCDS users think in
numbered groups of up to four values; label packs have `measurements` but no grouping.

## Read first

- `src/features/engine-host/{EngineHost.tsx, pollPids.ts, pollPids.test.ts}` — the loop and the
  union (`computePollPids`, `enabledRulePids`).
- `src/features/live-data/model/liveDataStore.ts` (`registrations`, `acquire`, `setValues`),
  `src/features/live-data/hooks/useLiveData.ts`.
- `src/shared/obd-core/session/DiagnosticSession.ts` — `pollOnce(pids)`, `readExtended(did)`,
  `setHeader`, `setRxFilter`, `resetAddressing`, `LiveValue`.
- `src/features/live-charts/{model/chartsStore.ts, hooks/useChartSeries.ts, ui/ChartsScreen.tsx,
api/chartCsv.ts}` — `ChartPanel.pids: string[]` are plain keys into `values`.
- `src/features/extended-pids/{hooks/useExtendedPids.ts, hooks/useMeasuringLog.ts,
api/measuringLog.ts, ui/ExtendedPidsScreen.tsx}`.
- `src/shared/labels/{types.ts, registry.ts, packs/vagEdc17Golf.ts}`; `src/shared/vehicles/types.ts`
  (`ExtendedPid`, `DiagModule.sampleIdent`).
- `src/shared/obd-core/transport/MockTransport.ts` (`extendedDids`, `moduleDids`) and
  `scenarios.ts` (how `sampleResponse` seeds DIDs).
- `docs/features/{extended-pids.md, live-charts.md, adaptations.md}` (label packs section).

## Design

### Key convention

A live-value key is either a Mode 01 PID (`'010C'`) or an extended DID key `'22:<DID>'`
(`'22:1701'`). Keys live in the same `liveDataStore.values` map and the same `registrations`, so
every consumer that already treats keys as opaque strings (charts, CSV, trip samples) works
unchanged. Pure helpers in `src/shared/obd-core/obd/liveKeys.ts`:

```ts
export const extendedKey = (did: string) => `22:${did.toUpperCase()}`;
export const isExtendedKey = (key: string) => key.startsWith('22:');
export const didOfKey = (key: string) => key.slice(3);
/** Split a poll key list into Mode 01 PIDs and extended DIDs (order preserved, de-duplicated). */
export function splitPollKeys(keys: string[]): { pids: string[]; dids: string[] };
```

### Session: `pollExtendedOnce`

```ts
/** Sequential Mode 22 reads on the CURRENT header (engine / default addressing). Returns raw data bytes per DID
 *  (after `62 <did>`), null for NO DATA / negative response. Never changes addressing. */
async pollExtendedOnce(dids: string[]): Promise<Record<string, number[] | null>>;
```

Sequential on purpose: multi-DID `22` requests are ECU-dependent and the ISO-TP reply exceeds one
frame; note the optimisation for later. Only called when `isCan(protocol)`.

### EngineHost

- `computePollPids` keeps returning the union of keys; after it, `const { pids, dids } =
splitPollKeys(keys)`.
- The sweep becomes: `const snap = await session.pollOnce(pids)`; if `dids.length && isCan(...)`,
  `const raw = await session.pollExtendedOnce(dids)`; `const ext = decodeExtendedSnapshot(raw,
profile.extendedPids ?? [], Date.now())`; `setValues({ ...snap, ...ext })`.
- `decodeExtendedSnapshot(raw, defs, ts): Record<string, LiveValue>` is pure (new file
  `src/features/engine-host/extendedSnapshot.ts`, tested): for each DID with a definition and
  non-null bytes → `{ pid: extendedKey(did), name: def.name, unit: def.unit, value: def.decode(bytes),
ts }`; DIDs without a definition or with null bytes are omitted (the previous value simply ages
  out, matching Mode 01 behaviour).
- Registrations containing `22:` keys for a profile that does not declare the DID, or on a non-CAN
  link, are ignored by `splitPollKeys`'s caller (filter against `profile.extendedPids`), so a stale
  chart panel cannot generate bus traffic.
- Alerts: `AlertRule.pid` may be an extended key; `AlertEngine.evaluate` reads `snap[pid]` so it
  already works; the Alerts rule editor lists extended keys when the profile has DIDs.
- Trip recording: unchanged (`tripPids` stays the effective Mode 01 set). Out of scope.

### Extended PIDs screen goes live

`useExtendedPids` keeps `refresh()` for the one-shot read of every DID (raw frames shown), and
additionally registers the profile's DID keys with `useLiveData(keys)` while the screen is mounted,
so values update every sweep. The measuring-block CSV log (`useMeasuringLog`) is unchanged; its
sweep already reads on its own cadence — document that both may run (the ELM queue serialises).

### Charts

- `chartsStore.ChartPanel.pids` accepts extended keys. The panel picker (`ChartsScreen`) lists Mode 01
  PIDs from `session.effectivePids(...)` plus, on CAN with a profile that has DIDs, the extended keys
  labelled `name (unit) · DID` via `labelForLiveKey(key, profile)` (pure helper next to `liveKeys.ts`
  taking the PID registry for Mode 01 names).
- Panel header and stats lines use `labelForLiveKey` instead of raw keys. `chartCsv` keeps keys as
  column names (plus a second header row of labels — small additive change, test updated).
- "Chart this" action on the Extended PIDs screen adds a panel `{ id: 'p<n>', pids: [extendedKey(did)],
windowMs: 60_000 }` and navigates to `/charts`.

### Measuring groups (label packs)

`LabelPack` gains:

```ts
export interface MeasuringGroup { name: string; dids: string[]; description?: string }   // ≤ 4 DIDs, VCDS-style
measuringGroups?: Record<string, MeasuringGroup>;   // key = group number as VCDS shows it, e.g. '001', '121'
```

- `vagEdc17Golf.ts` ships three illustrative groups over the existing `1701`–`170D` DIDs (e.g.
  `'075'` DPF: soot mass, soot %, km since regen, regen count; `'099'` temperatures: EGT, oil temp;
  `'120'` EGR / injection), clearly commented as illustrative until a capture confirms (plan 25).
- Registry: `measuringGroups(pack): [groupNo, MeasuringGroup][]` sorted by group number.
- Resolving the pack: once per session, `readExtended('F187')` (engine part number, ASCII) through a
  small `useEnginePartNumber()` hook in `extended-pids/hooks` (cached in `sessionStore.info` as
  `partNumber?: string` — additive field set by `connectionService` after connect when CAN); fallback
  to the profile's engine `DiagModule.sampleIdent.F187` in the simulator, else no pack.
- UI: a **Groups** section at the top of the Extended PIDs screen: one card per group with the group
  number, name, and up to four live tiles (`ValueCard`), driven by `useLiveData(groupKeys)`; buttons
  **Log group** (→ `useMeasuringLog.start(defs)`) and **Chart group** (→ chart panel). DIDs in a group
  that the profile does not declare render as "no definition for `17xx` in this profile".

### Addressing note

Everything here uses the default/functional header (engine). Groups for **other modules** would
require `setHeader`/`setRxFilter` per sweep and `resetAddressing` in `finally`; that is not done in
the EngineHost loop. Module-scoped groups and KWP `21 <group>` for pre-UDS modules are deferred.

## Steps

1. `liveKeys.ts` (+ test) exported from `obd-core/index.ts`; `DiagnosticSession.pollExtendedOnce`
   (+ integration test on the Golf simulator).
2. `engine-host/extendedSnapshot.ts` (+ test); EngineHost sweep change; `pollPids.test.ts` gains the
   mixed-key case.
3. `useExtendedPids` registration; Extended PIDs screen live values + "Chart this".
4. Charts picker / labels / CSV label row.
5. `LabelPack.measuringGroups`, registry helper, Golf pack groups, `registry.test.ts`.
6. `sessionStore.info.partNumber`, `useEnginePartNumber`, Groups section with Log / Chart actions.
7. Docs; `npm run format`; `npm run ci`.

## Simulator

`MockTransport` already answers `22<did>` from `scenario.extendedDids` and `buildScenario` seeds every
profile DID from `sampleResponse`; `F187` is answered when present in `moduleIdent`/`extendedDids` —
add `'F187'` for the Golf engine (`03L906022LM` ASCII) to the default scenario so the pack resolves
in the simulator. Integration test: register `22:1701` + `010C`, run one EngineHost-equivalent
sweep (`pollOnce` + `pollExtendedOnce` + `decodeExtendedSnapshot`), assert both keys present with
decoded values.

## Tests

- `liveKeys.test.ts`: key round-trip; `splitPollKeys(['010C','22:1701','010C','22:1701'])` →
  `{ pids: ['010C'], dids: ['1701'] }`.
- `extendedSnapshot.test.ts`: decode via the profile's `decode`; undefined DID omitted; null bytes
  omitted; `ts` applied.
- `sessionExtras.integration.test.ts` (extend): `pollExtendedOnce(['1701','170D'])` returns bytes for
  both on the Golf scenario, `null` for an unseeded DID.
- `pollPids.test.ts`: mixed keys preserved and de-duplicated.
- `labels/registry.test.ts`: `measuringGroups(vagEdc17Golf)` sorted; a group referencing a DID the
  pack lacks a `measurements` label for still returns (UI handles the label fallback).
- `chartCsv.test.ts`: label header row.

## Docs

- `docs/features/extended-pids.md`: delete the "Live plot (deferred)" paragraph; add "Live values",
  "Chart this", "Measuring groups" (resolution via F187, illustrative packs).
- `docs/features/live-charts.md`: extended keys in panels, labels, CSV header row.
- `docs/features/adaptations.md` § label packs (or a new `docs/label-packs.md` referenced from both):
  `measuringGroups` field.
- `docs/features/engine-host.md` (plan 04): the split sweep and the "default header only" rule.

## Acceptance

- [ ] Golf simulator: Charts → add panel → pick "DPF soot mass (g) · 1701" → the line updates every
      sweep without the Extended PIDs screen open.
- [ ] Extended PIDs screen shows live values and three groups; **Chart group** opens Charts with a
      4-series panel; **Log group** records only that group's DIDs.
- [ ] Punto / Passat simulator (no DIDs / K-line): no `22` traffic in the adapter log even with a
      stale `22:` chart panel.
- [ ] CSV export of a mixed panel has key and label header rows.
- [ ] `npm run ci` green.

## Deferred until an on-car session

- Confirm which Golf engine DIDs answer (plan 02 flow `extended`) and prune the pack groups to real
  ones (plan 25 `confirmed`).
- Module-scoped measuring groups (ABS, cluster) and KWP `21 <group>` for TP2.0 modules: build only
  after plan 25 confirms addresses and TP2.0 timing on the Vgate.
- Measure how many extended DIDs per sweep the BLE link sustains at the chosen poll interval; set a
  documented cap.
