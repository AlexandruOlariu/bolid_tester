# Feature: coding (experimental, write-capable, heavily gated)

**Custom coding** = changing a control module's configuration ("long coding" / adaptation) rather
than just reading it — e.g. enabling/disabling a coded feature on a VAG module. This is the only
**write** feature in the app, so it carries the strongest guardrails in the project. Read this whole
spec before any implementation: the honest answer to "can we?" is **"partially, on CAN cars, at real
risk, and never blindly."**

> ⚠️ **DANGER / EXPERIMENTAL.** Writing to a module can disable functions, set faults, or (worst
> case) leave a module in a bad state. This feature ships **disabled**, defaults to the **simulator**,
> requires an explicit per-session unlock and typed confirmation, and **always backs up the original
> coding before any write**. It is for advanced users on **their own** vehicle, off public roads.

## What's actually possible over a generic ELM327
A generic ELM327 is a CAN transceiver we can address freely, so the **transport** for coding exists:
- Set the tester→module header (`ATSH`), RX filter (`ATCRA`), and ISO-TP flow control
  (`ATFCSH`/`ATFCSD`/`ATFCSM`) to talk to a **specific module** (not the OBD2 functional address).
- Drive the relevant **UDS services**:
  - `10 03` — enter **extended diagnostic session**.
  - `3E` — **TesterPresent** keep-alive (looped so the session doesn't drop mid-edit).
  - `22 <DID>` — **read** the current coding/adaptation bytes.
  - `27` — **SecurityAccess** (seed/key) when the module requires it to unlock writes.
  - `2E <DID> <data>` — **WriteDataByIdentifier** (long coding / adaptation write).
  - `31` — **RoutineControl** for modules that code via a routine.

## The real blockers (why this is "partial")
- **Security access (`27`) is the wall.** The seed→key algorithm is **manufacturer/module-specific
  and not public**. Without the correct key, write-protected modules will not accept `2E`. The app
  ships **no** seed/key algorithms; a module is write-eligible only if its profile supplies one (or
  the module needs none).
- **DIDs and byte/bit meanings are not standardized.** Long-coding layouts are per-module and per
  software version. Wrong byte = wrong behaviour. Everything is profile data, **illustrative**, and
  must be confirmed on the actual car.
- **K-line cars can't really do this.** The Passat B5.5 (KWP2000 over K-line) uses a different,
  slow, 7-digit soft-coding scheme; a generic ELM327 over K-line is too limited and slow to do this
  safely. **CAN/UDS only** — in our examples, only the **Golf Plus 2009** is even a candidate.
- **Out of scope, hard no:** immobilizer, airbag/SRS, instrument-cluster mileage, key/component
  protection — never offered, regardless of profile.

## Safety model (non-negotiable)
1. **Disabled by default**, behind a Settings flag *and* a per-session unlock with a typed
   confirmation string.
2. **Simulator-first:** the default target is `MockTransport`; writing to a real module requires
   explicitly switching the adapter source and re-confirming.
3. **Mandatory backup:** before any `2E`, the app reads and stores the module's current coding
   (timestamped, exportable) and shows a one-tap **Restore original** action.
4. **Dry-run preview:** show the exact bytes to be written and a human-readable before→after diff;
   require confirmation of the diff, not just the action.
5. **Profile-gated:** a module is writable only if its profile entry supplies the module address, the
   coding DID + layout, and (if required) the security routine. No profile data ⇒ read-only.
6. **Keep-alive + verify:** maintain TesterPresent during the edit; after writing, **re-read** and
   confirm the value took; surface any negative response (`7F`) verbatim.

## UI
- **CodingScreen** — only reachable when unlocked. Per supported module: current coding (raw +
  decoded byte/bit editor), a **before→after diff**, **Backup**, **Write**, **Restore original**, and
  a persistent experimental/danger banner. Hidden entirely on non-CAN links and when no profile
  module is declared.

## hooks
- `useCodingUnlock()` — the flag + per-session unlock/confirmation gate.
- `useModuleCoding(moduleId)` — read current coding, edit byte/bit, compute the diff.
- `useCodingWrite()` — backup → (security access) → write → verify, with explicit confirmation; never
  fires without a stored backup.

## api (service layer)
- `codingService` — owns the UDS write sequence (`10 03` → optional `27` → `2E`/`31` → re-read), the
  TesterPresent loop, and negative-response handling. Reuses the module-addressing helpers from
  [`sensor-tests`](./sensor-tests.md) / [`extended-pids`](./extended-pids.md). Backups persist via
  the same storage as [`trip-recording`](./trip-recording.md).

## model
- `codingStore` (Zustand): `unlocked`, `modules`, `backups`, `lastWriteResult`.
- Profiles gain an optional, clearly-experimental `codingModules` map: module CAN IDs, coding DID(s)
  + byte/bit schema, and an optional security routine descriptor. **None are shipped enabled.**

## Long-coding helper (6b.4)
A VCDS-style byte-by-byte breakdown over the existing bit/byte schema, so a write is never a blind
hex edit:
- `obd-core/coding/codingHelper.buildCodingView(bytes, fields, baseline?)` (pure, unit-tested) turns a
  coding value into per-byte views: hex, all 8 bits msb-first (each annotated when the schema names
  it), the named bit/mask/whole-byte fields, and a `changed` flag against an optional baseline.
- **Label-pack names.** `mergeCodingLabels(schema, packBits)` merges a module's own schema with
  coding-bit labels from a matching **label pack** (resolved by the module's part number,
  `findLabelPack` → `codingBitLabels`), **additively** — the profile schema always wins on a
  conflict, the pack only fills in bits the schema doesn't name. The Golf BCM ships an illustrative
  part number so the `vag-bcm-pq35` pack contributes extra bit names.
- **Live old→new preview.** `CodingScreen`'s editor renders the breakdown: a `Switch` per named bit,
  a stepper per masked field (e.g. the comfort-blink nibble), and a raw 8-bit editor for any
  undocumented bit. Toggling a bit / choosing a value updates a `before → after` hex preview with the
  changed bytes highlighted. The write still goes through the **existing gated path** (`useCoding.write`
  → `codeModule`: backup → write → verify); the helper only shapes the edit.

## Tweaks — one-tap presets (6b.5)
OBDeleven-style curated toggles compiled down to the same gated write. A preset is **data** on the
profile (`codingPresets`, linked to a `codingModules` entry by ATSH header); pure helpers in
`obd-core/coding/presets` apply/revert/detect it:
- `detectPresetState(bytes, preset)` → `on` / `off` / `unknown` drives each row's state badge.
- `applyPreset` / `revertPreset` compile the preset onto a coding value (masked, in place).
- `useCoding.applyTweak(preset, on)` reads the live coding first (**backup-first**), compiles, then
  writes + verifies — never a bypass. Gated behind the same unlock + confirmation.
- Ships with three reversible Golf Plus BCM tweaks (DRL, needle sweep, one-touch turn signals);
  the whole apply→verify→revert loop round-trips against the simulator
  (`presets.integration.test.ts`).

## Full backup — "clone my car" (6b.8)
One tap reads **every profile-declared module's** long coding **and** adaptation-channel values into a
dated JSON snapshot — the safety net VCDS users keep in a drawer.
- **Read path** (`useCarBackup.create`) walks the union (by ATSH header) of `codingModules` and
  `adaptations`: per module it reads ident (`readModuleIdent`, best-effort part no/SW) + coding
  (`22 <codingDid>`), and reads each adaptation channel by **reusing the adaptations feature's read
  service** (`readChannel`, read-only — the adaptations feature itself is not modified).
- **Snapshot shape** (`carBackup.buildCarBackup`, pure + tested): `{ id, ts, vehicle (key+VIN),
  protocol, modules: [{ reqHeader, address?, name, partNumber?, softwareVersion?, coding: {did,
  bytes, hex} | null, adaptations: [{did, name, unit?, raw, value}] }] }`. Pure diff/summary helpers
  (`diffBackupModule`, `summarizeCarBackup`) support the restore preview and headline counts.
- **Store** `carBackupStore` (persisted, capped `MAX_CAR_BACKUPS = 10`, debounced + rehydration-merge
  safety net, like `scanHistoryStore`). **Export/share** as `.json`.
- **Restore is per-module and gated.** Coding restore is exactly the existing gated coding write
  (`useCoding.write(codingModule, snapshotBytes)` → backup + verify), behind unlock + confirm.
  **Adaptation restore is manual in v1** (read-only in the backup UI, with a pointer to the
  Adaptations screen): each adaptation write is bounds-checked and module-specific in the adaptations
  feature, and reaching into it from the backup UI would duplicate that gating — deferred rather than
  half-built.
- UI: a **Backup** section on `CodingScreen` — create, expandable snapshots (per-module coding hex +
  adaptation values), export, delete, and per-module gated coding restore.

## Behavior
- The whole read→edit→backup→write→verify→restore loop is exercised end-to-end against the
  **simulator** with seeded module coding, so the UX and guardrails are testable with no hardware and
  no risk.
- On a real car, anything missing (no profile module, non-CAN, failed security access, no backup)
  blocks the write with a clear reason.

## Acceptance
- With the feature locked (default), no write path is reachable anywhere in the UI.
- In the simulator with a seeded codeable module: read current coding, edit a bit, see the diff,
  back up, write, and verify the re-read reflects the change; **Restore original** reverts it.
- The coding section is **never** shown for the K-line Passat or the Punto, and never for
  immobilizer/airbag/cluster modules.
