# Plan 23 — Security-access plugins (user-supplied seed→key, never shipped)

**Size:** M–L (1½–2 days) · **Depends on:** plan 13 (file picker + validator), plan 06 (garage) ·
**Roadmap:** v0.6 "Security-access plugins"

## Goal

A write that a UDS module protects with `27` SecurityAccess can be unlocked **only** with a
seed→key routine the owner supplies for their own car, as a small data file the app validates and
interprets in a sandbox. The app never ships, downloads or derives such routines. Every write
surface (coding, tweaks, adaptations, routines, service reset) shows whether it is **unlockable**
with an installed plugin, and refuses — instead of sending a bogus key — when it is not.

## Why

Today `src/features/coding/hooks/useCoding.ts` line ~95 passes `seedToKey: (s) => s` (identity)
whenever `mod.security` is set, and `useServiceReset.ts` line 49 does the same fallback. On a real
module that is a guaranteed NRC `0x35` and counts toward the lockout (`0x36`). `writeChannel`
refuses security-locked channels outright. The three behaviours disagree, and none can ever succeed.
`docs/features/coding.md` already states the policy: "a module is write-eligible only if its profile
supplies one (or the module needs none)".

## Read first

- `src/shared/obd-core/coding/udsCoding.ts` — `securityAccess(send, level, seedToKey, opts)`
  (`0x37` retried once, `0x36` never), `CodeModuleOptions.security` (**`seedToKey` is required**
  here), `codeModule`, `serviceReset` / `ServiceResetDescriptor.security`.
- `src/shared/obd-core/uds/guidedRoutine.ts` — `GuidedRoutineDescriptor.security.seedToKey`
  **optional**; `startGuidedRoutine` skips `27` when absent.
- `src/shared/vehicles/types.ts` — `CodingModule.security?: { level }`,
  `AdaptationChannel.security?: { level }`, `ServiceReset.security?: { level; seedToKey? }`,
  `GuidedRoutine.security?: { level; seedToKey? }`.
- Call sites: `useCoding.write`, `useServiceReset` (lines 38–50), `routineService.startRoutine`
  (passes `routine.security` through), `adaptationService.writeChannel` (refuses), `useCarBackup`
  (read-only, unaffected).
- `src/shared/obd-core/transport/MockTransport.ts` `27` handler (`67010000` = zero seed =
  "already unlocked", `6702` for any key) — the simulator never exercises a real unlock.
- Plan 13: `src/shared/lib/validate.ts`, `expo-document-picker` import pattern, Settings → Data.
- `docs/features/coding.md` § "The real blockers", § "Safety model".

## Design

### Plugin file (`bolid.seedkey.v1`)

```ts
export interface SeedKeyPluginV1 {
  schema: 'bolid.seedkey.v1';
  name: string; // 'My Golf BCM level 03'
  /** Scope: which module(s) and level this routine applies to. */
  applies: { reqHeader?: string; address?: string; level: number; partNumberPrefix?: string };
  /** Seed/key byte widths the module uses (2 or 4). */
  seedBytes: 2 | 4;
  keyBytes: 2 | 4;
  /** The routine, as a bounded list of operations over one 32-bit accumulator (see interpreter). */
  program: SeedKeyOp[];
  notes?: string;
}
```

### Interpreter — a tiny bounded DSL, not JavaScript

`src/shared/obd-core/coding/seedKeyDsl.ts` (pure, zero dependencies, exported from `obd-core`):

```ts
export type SeedKeyOp =
  | { op: 'load'; from: 'seed' } // acc = seed as big-endian uint
  | { op: 'const'; value: number } // acc = value (uint32)
  | { op: 'add' | 'sub' | 'mul' | 'xor' | 'and' | 'or'; value: number }
  | { op: 'not' }
  | { op: 'swap16' }
  | { op: 'bswap' }
  | { op: 'shl' | 'shr' | 'rol' | 'ror'; bits: number } // 0–31
  | { op: 'mask'; bits: 8 | 16 | 32 }
  | { op: 'table'; values: number[]; index: 'low8' } // acc = values[acc & 0xff] (values.length == 256)
  | { op: 'repeat'; count: number; body: SeedKeyOp[] } // count ≤ 64, body ≤ 32 ops, nesting ≤ 2
  | { op: 'store' }; // key = acc truncated to keyBytes (big-endian)
export interface CompiledSeedKey {
  (seed: number[]): number[];
  readonly steps: number;
}
export function compileSeedKey(plugin: SeedKeyPluginV1): CompiledSeedKey; // validates limits, throws on violation
export const SEED_KEY_LIMITS = { maxOps: 256, maxSteps: 4096, maxNesting: 2, maxRepeat: 64 };
```

Why a DSL rather than evaluating JavaScript from the file: (1) Hermes has no `eval` /
`new Function`, so a JS plugin would not run at all on device; (2) a data program cannot touch the
file system, network, stores or the session — the only input is the seed and the only output is the
key; (3) execution is bounded (`maxSteps`) so a malicious or buggy file cannot hang the UI; (4) it
is trivially unit-testable and diffable. The op set is generic 32-bit arithmetic; it encodes no
manufacturer knowledge.

### Storage

- Files live in `documentDirectory/seedkeys/<pluginId>.json` (copied from the picker's cache).
- Index in a persisted `src/shared/state/seedKeyStore.ts` (`bolid.seedKeys` v1):
  `{ plugins: { id; name; applies; seedBytes; keyBytes; fileUri; importedAt; vehicleKey?: string }[] }`
  where `vehicleKey` optionally pins a plugin to one car (`historyVehicleKey`). The program itself is
  **not** in the store blob — it is read from the file when needed and compiled per use (cheap).
- Never in `bolid.settings`; never exported by plan 13's profile export (a profile file may
  reference `pluginName`s it expects, nothing more).

### Resolution and wiring

`src/shared/security/resolveSeedKey.ts` (shared; node-testable):

```ts
export interface UnlockStatus {
  state: 'none-required' | 'unlockable' | 'locked';
  pluginName?: string;
  level?: number;
}
export async function resolveSeedToKey(target: {
  reqHeader: string;
  level: number;
  partNumber?: string;
  vehicleKey?: string;
}): Promise<CompiledSeedKey | null>;
export function unlockStatusFor(
  security: { level: number } | undefined,
  plugin: { name: string } | null,
): UnlockStatus;
```

Matching order: exact `reqHeader` + level (+ vehicleKey when pinned) → `partNumberPrefix` + level →
null. Then:

- `useCoding.write`: replace the identity with `const stk = mod.security ? await resolveSeedToKey(…)
: null; if (mod.security && !stk) { setLastResult('Locked — this module needs security access and
no plugin is installed for it.'); return false; }` and pass `{ level, seedToKey: stk }`.
- `adaptationService.writeChannel(session, ch, newRaw, opts?: { seedToKey? })`: when `ch.security`
  and `opts.seedToKey` present, pass `security` into `codeModule`; otherwise keep today's refusal.
  `useAdaptations.write/restore` resolve and pass it.
- `routineService.startRoutine(session, routine, opts?: { seedToKey? })`: inject into the descriptor
  when `routine.security` and a plugin resolved; when `routine.security` exists and nothing resolved,
  keep the current "attempt unlocked, explain NRC 0x33" behaviour (routines are read-ish; the
  module decides).
- `useServiceReset`: drop the identity fallback; when `descriptor.security` and no plugin → refuse
  with the same text (the screen already leads with the manual procedure).
- Keep `seedToKey?` on `ServiceReset`/`GuidedRoutine` **types** for tests and fakes only; lint rule
  of thumb documented: no registry profile may set it.

### UI

- Settings → Data → **Security access plugins**: import (picker → validate → preview: name, scope,
  widths, op count), list with Delete, and **Test in simulator** (runs the plugin against the
  simulator scenario below and reports pass/fail).
- Badges via a shared `UnlockBadge` (`src/shared/ui/UnlockBadge.tsx`): "No unlock needed" /
  "Unlockable · <plugin>" / "Locked · needs security access" on: coding module rows, tweaks rows
  (through their module), adaptation channels (replaces the "Security-locked (read-only)" text),
  routine rows, the service-reset card.

### Simulator

Extend `SimScenario`:

```ts
/** Per-header SecurityAccess model. When present for the addressed header, 27 <level> returns the
 *  seed, 27 <level+1> <key> is checked, and protected services answer 7F xx 33 until unlocked. */
security?: Record<string, { level: number; seed: number[]; key: number[]; protects: ('2E' | '31' | '2F' | '3B')[] }>;
```

`MockTransport`: track `unlocked: Set<string>`; `27 <lvl>` → `67 <lvl> <seed>`; `27 <lvl+1> <key>` →
`67 <lvl+1>` on match else `7F 27 35` (and count attempts: third failure → `7F 27 36`); protected
services → `7F <svc> 33` while locked; `10 xx` re-locks. Default scenarios keep **no** `security`,
so every existing test is unchanged. The test fixture plugin uses a deliberately trivial program
(e.g. `load seed → xor 0xFFFF → store`) with a matching scenario `{ seed: [0x12, 0x34], key: [0xED,
0xCB] }` — a test vector, not a real routine.

## Steps

1. `seedKeyDsl.ts` + exhaustive tests (each op, limits, determinism).
2. Plugin schema with plan 13's validator (`src/shared/lib/exchange/schemas.ts`); `seedKeyStore.ts`.
3. `resolveSeedKey.ts` + tests; `UnlockBadge`.
4. Simulator `security` model + `MockTransport.test.ts`.
5. Wire the five call sites; remove both identity fallbacks; `writeChannel` option.
6. Settings UI (import / list / test); badges on the five screens.
7. Docs; `npm run ci`.

## Tests

- `seedKeyDsl.test.ts`: each op against hand-computed vectors; `repeat` nesting > 2 rejected;
  `maxSteps` exceeded throws before producing a key; `table` requires 256 entries; widths respected.
- `resolveSeedKey.test.ts`: header+level match beats prefix match; pinned `vehicleKey` excludes
  other cars; none → null; `unlockStatusFor` three states.
- `MockTransport.test.ts`: locked `2E` → `7F2E33`; wrong key → `7F2735`; third wrong → `7F2736`;
  right key → `2E` accepted; `10 03` re-locks.
- `udsCoding.integration` (new case in `coding/presets.integration.test.ts` or a new file): Golf
  scenario override with `security['70E']`; `codeModule` with the fixture plugin verifies; without
  `security` option → `UdsError` nrc 0x33.
- Hook-level logic is React; keep the decision in pure helpers (`decideCodingWrite(mod, plugin)`)
  with tests.

## Docs

- `docs/features/coding.md`: replace the "no seed/key algorithms ship" paragraphs with the plugin
  model (file format, sandbox, scope matching, badges) and the firm policy: the app never ships,
  fetches or derives routines; owners supply their own for their own vehicle.
- `docs/features/{adaptations,routines,service-reset}.md`: badge + behaviour change (refuse vs
  attempt).
- `docs/exchange-formats.md` (plan 13): the `bolid.seedkey.v1` schema and the DSL reference.
- `docs/simulator.md`: `security` scenario field.

## Acceptance

- [ ] Golf simulator with the test `security` override: coding write on BCM is refused with the
      "no plugin" message and **no** `27` is sent (assert via adapter log); after importing the
      fixture plugin the same write verifies; Settings → Test in simulator reports pass.
- [ ] A plugin whose program exceeds the limits is rejected at import with a clear message.
- [ ] No registry profile sets `seedToKey` (grep in a test).
- [ ] `npm run ci` green; `MockTransport` default behaviour unchanged for every existing suite.

## Out of scope

Any seed/key routine content; login (`2B`) for KWP modules (plan 22); TP2.0 modules.

## Deferred until an on-car session

Nothing in this plan requires the car. If the owner later obtains a routine for one of their own
modules, the on-car check is: import → Coding → the module row shows "Unlockable" → read coding →
write the **same** bytes back (a no-op write) → verify. Record the result in the vehicle doc's
"Validated on the car" table; never record the routine itself in the repo.
