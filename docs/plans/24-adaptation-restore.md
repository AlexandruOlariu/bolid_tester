# Plan 24 — Adaptation restore from a full-car backup

**Size:** S–M (½–1 day) · **Depends on:** plan 23 optional (security-locked channels) ·
**Roadmap:** v0.6 "Adaptation restore"

## Goal

The "clone my car" snapshot restores **adaptation channels** too — per channel, gated by the
adaptations unlock, bounds-checked by the same guard every other write uses, with a before/after
diff and a per-module "restore all" that lists exactly what will change. Fully exercised in the
simulator.

## Why

`docs/features/coding.md` § 6b.8: "Adaptation restore is manual in v1 … deferred rather than
half-built." `CodingBackup.tsx` prints "Adaptation values are informational here — restore them
from the Adaptations screen". The write path with backup + verify + bounds already exists
(`adaptationService.writeChannel`); the missing piece is the planning + UI glue.

## Read first

- `src/features/coding/api/carBackup.ts` (`CarBackup`, `CarBackupModule`, `CarBackupAdaptation`,
  `diffBackupModule`, `BackupModuleDiff`, `buildCarBackup`) and `carBackup.test.ts`.
- `src/features/coding/hooks/useCarBackup.ts` (`moduleSpecs`, how channels are read via
  `readChannel`), `src/features/coding/model/carBackupStore.ts`, `src/features/coding/ui/CodingBackup.tsx`
  (per-module block with the gated "Restore coding").
- `src/features/adaptations/api/adaptationService.ts` (`readChannel`, `writeChannel`,
  `checkBounds`, `WriteOutcome`), `hooks/useAdaptations.ts` (`write`, `restore`, `display`),
  `model/adaptationsStore.ts` (`unlocked`, `addBackup`, `backups` capped at 50).
- `src/shared/obd-core/coding/adaptationValue.ts` (`AdaptationScaling`, `decodeAdaptationRaw`,
  `encodeAdaptationValue`).
- `src/shared/vehicles/golf-plus-2009-20tdi.ts` `adaptations` (channels `3001` 2 bytes 750–950
  default `03 52`; `3002` 1 byte scale 0.5 0–100 default `64`).
- `src/shared/obd-core/transport/scenarios.ts` (`adaptationSeeds` → `coding` map, so `2E` on a
  channel DID is accepted by the simulator).

## Design

### Move the bounds guard into the core

`checkBounds(ch, raw)` currently lives in the adaptations feature. Move the logic to
`src/shared/obd-core/coding/adaptationValue.ts` as

```ts
export interface AdaptationBounds extends AdaptationScaling {
  min?: number;
  max?: number;
  unit?: string;
}
export function adaptationBoundsError(ch: AdaptationBounds, raw: number[]): string | null;
```

and keep `checkBounds` in `adaptationService.ts` as a one-line re-export wrapper, so the coding
feature's planner depends on `@/shared/obd-core` only (no feature → feature import beyond the
existing read-path reuse).

### Restore planner (pure, `src/features/coding/api/adaptationRestore.ts`)

```ts
export type RestoreSkip = 'equal' | 'no-channel' | 'no-snapshot-raw' | 'out-of-bounds' | 'locked';
export interface RestorePlanItem {
  did: string;
  name: string;
  unit?: string;
  channel: AdaptationChannel | null;
  snapshotRaw: number[] | null;
  snapshotValue: number | null;
  currentRaw: number[] | null;
  currentValue: number | null;
  action: 'restore' | 'skip';
  skip?: RestoreSkip;
  reason?: string;
}
export function planAdaptationRestore(
  snapshot: CarBackupModule,
  liveChannels: AdaptationChannel[], // profile.adaptations filtered to snapshot.reqHeader
  current: Record<string, number[] | undefined>, // DID -> live raw (from a fresh read), may be partial
  opts: { unlockable: (ch: AdaptationChannel) => boolean }, // plan 23 status; without it: ch => !ch.security
): RestorePlanItem[];
export function summarizeRestorePlan(items: RestorePlanItem[]): {
  restore: number;
  skipped: Record<RestoreSkip, number>;
};
```

Rules: no matching `(reqHeader, did)` channel → `no-channel`; snapshot `raw === null` →
`no-snapshot-raw`; `adaptationBoundsError(ch, snapshotRaw)` non-null → `out-of-bounds` (a snapshot
can hold a value a later profile revision no longer allows — refuse, never clamp); `ch.security`
and not unlockable → `locked`; current raw equals snapshot raw byte-for-byte → `equal`; else
`restore`.

### Hook (`src/features/coding/hooks/useAdaptationRestore.ts`)

```ts
export function useAdaptationRestore(): {
  busy: boolean;
  /** Fresh live read of every channel in the module (reuses readChannel), returns DID -> raw. */
  readCurrent(module: CarBackupModule): Promise<Record<string, number[] | undefined>>;
  plan(module: CarBackupModule, current: Record<string, number[] | undefined>): RestorePlanItem[];
  /** Writes one item through writeChannel (bounds re-checked there), records the backup in
   *  adaptationsStore, returns the WriteOutcome. Requires adaptationsStore.unlocked. */
  restoreOne(item: RestorePlanItem): Promise<WriteOutcome>;
  /** Sequential restore of every `action === 'restore'` item; stops at the first failure. */
  restoreAll(
    items: RestorePlanItem[],
  ): Promise<{ done: number; failed?: { did: string; message: string } }>;
};
```

Gate: `useAdaptationsStore.unlocked` (the adaptations unlock, because these are adaptation writes);
the UI explains "Unlock on the Adaptations screen" when locked. Security: pass plan 23's
`resolveSeedToKey` result into `writeChannel` opts when available.

### UI (`CodingBackup.tsx`)

In the per-module block, replace the informational paragraph with:

- **Compare with car** button → `readCurrent` → plan → a table: name · snapshot → current
  (display values with unit) · action/skip reason chip. Equal rows are greyed.
- Per row **Restore** (confirm inline: "Write 850 rpm to Idle speed offset (DID 3001)? A backup of
  the current value is taken first.").
- **Restore all (N)** → confirm sheet listing the N items → sequential writes with progress; on
  failure show the message and which items remain.
- Diff summary line from `diffBackupModule(snapshot, currentAsModule)` for the header
  ("2 adaptations differ, coding unchanged") — build `currentAsModule` via `buildCarBackup` on
  the fresh reads.

## Steps

1. `adaptationBoundsError` in obd-core + tests; `checkBounds` becomes a wrapper.
2. `adaptationRestore.ts` + `adaptationRestore.test.ts`.
3. `useAdaptationRestore.ts`; `CodingBackup.tsx` UI.
4. Integration test against the simulator (below); docs; `npm run ci`.

## Simulator

No new scenario fields: `2E` on channel DIDs is already accepted because `buildScenario` merges
`adaptationSeeds` into `coding`. Integration test
`src/features/coding/api/adaptationRestore.integration.test.ts`:

1. `buildScenario('golf-plus-2009-20tdi')` → `MockTransport` → `DiagnosticSession.connect()`.
2. Read `3001` via `readChannel` → `[0x03, 0x52]` (850); take a snapshot module with that raw.
3. `writeChannel(session, ch3001, [0x03, 0x84])` (900) → verified; read → 900.
4. `planAdaptationRestore(snapshot, channels, { '3001': [0x03,0x84], '3002': [0x64] })` →
   `3001` restore, `3002` equal.
5. Execute the restore item through `writeChannel` → verified; read → `[0x03, 0x52]`.
6. A snapshot raw of `[0x04, 0x00]` (1024 rpm, above max 950) plans as `out-of-bounds` and
   `writeChannel` refuses it too.

## Tests

- `adaptationValue.test.ts`: `adaptationBoundsError` below/above/inside/no-bounds; signed channel.
- `adaptationRestore.test.ts`: every skip reason; `equal` on identical bytes; `summarizeRestorePlan`
  counts; locked when `ch.security` and `unlockable` false, `restore` when true.
- Integration test above.
- `carBackup.test.ts` unchanged.

## Docs

- `docs/features/coding.md` § 6b.8: replace the "manual in v1" paragraph with the restore flow,
  gating and skip reasons.
- `docs/features/adaptations.md`: note that the backup screen can write channels through the same
  service and unlock.

## Acceptance

- [ ] Golf simulator: create a backup, change `3001` on the Adaptations screen to 900, Coding →
      Backup → **Compare with car** shows `3001: 850 → 900 · restore`, `3002: equal`; **Restore**
      returns the car to 850 and the Adaptations screen reads 850 after refresh.
- [ ] With adaptations locked, Restore buttons are disabled with the explanatory text.
- [ ] An out-of-bounds snapshot value is shown as skipped with the bounds message and cannot be
      forced.
- [ ] `npm run ci` green.

## Out of scope

Restoring channels on modules the current profile no longer declares (shown as `no-channel`);
TP2.0/KWP channels (plan 22 deferred section).

## Deferred until an on-car session

The flow is complete in the simulator. On the Golf, the first real use must be a **no-op restore**:
take a backup, change nothing, Compare → everything `equal` → confirms read parity; then change one
channel on the Adaptations screen by one step, restore it, re-read. Record both in the vehicle doc.
