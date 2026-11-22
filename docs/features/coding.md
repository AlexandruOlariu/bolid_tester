# Feature: coding (experimental, write-capable, heavily gated)

**Custom coding** = changing a control module's configuration ("long coding" / adaptation) rather
than just reading it — e.g. enabling/disabling a coded feature on a VAG module. This is the only
**write** feature in the app, so it carries the strongest guardrails in the project. Read this whole
spec before any implementation: the honest answer to "can we?" is **"partially, on CAN cars, at real
risk, and never blindly."**

> ⚠️ **DANGER / EXPERIMENTAL.** Writing to a module can disable functions, set faults, or (worst
> case) leave a module in a bad state. This feature ships **locked**, is built and tested against the
> **simulator** first, requires an explicit per-session unlock and a confirm step before every write,
> and **always backs up the original coding before any write**. It is for advanced users on **their
> own** vehicle, off public roads. A fresh install talks to the **real adapter**, so on a CAN car
> whose profile declares `codingModules` the unlock is the only thing standing before a real write —
> see [Gates as built](#gates-as-built-today) for what exists today versus the target model below.

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

- **Security access (`27`) is the wall.** The seed→key routine is **manufacturer/module-specific
  and not public**. Without the correct key, write-protected modules will not accept `2E`. The app
  **never ships, fetches or derives** a seed→key routine. A module that declares `security` is
  write-eligible only with a **security-access plugin** the owner installed for their own car (see
  [Security-access plugins](#security-access-plugins-plan-23)); without one the write is refused
  before anything is sent.
- **DIDs and byte/bit meanings are not standardized.** Long-coding layouts are per-module and per
  software version. Wrong byte = wrong behaviour. Everything is profile data, **illustrative**, and
  must be confirmed on the actual car.
- **K-line cars can't really do this.** The Passat B5.5 (KWP2000 over K-line) uses a different,
  slow, 7-digit soft-coding scheme; a generic ELM327 over K-line is too limited and slow to do this
  safely. **CAN/UDS only** — in our examples, only the **Golf Plus 2009** is even a candidate.
- **Out of scope, hard no:** immobilizer, airbag/SRS, instrument-cluster mileage, key/component
  protection — never offered, regardless of profile.

## Safety model (non-negotiable)

1. **Disabled by default**, behind a Settings flag _and_ a per-session unlock with a typed
   confirmation string. **Target — only the per-session unlock is built** (see
   [Gates as built](#gates-as-built-today)); the Settings flag and the typed string are not.
2. **Simulator-first:** every write path is exercised against `MockTransport` before it ships. The
   simulator is no longer the default target: a fresh install's adapter source is the real
   Bluetooth adapter (Settings), so the write goes to a real module whenever a real CAN session is
   live. In simulator mode the amber simulator banner makes the target obvious.
3. **Mandatory backup:** before any `2E`, the app reads and stores the module's current coding
   (timestamped, exportable) and shows a one-tap **Restore original** action.
4. **Dry-run preview:** show the exact bytes to be written and a human-readable before→after diff;
   require confirmation of the diff, not just the action.
5. **Profile-gated:** a module is writable only if its profile entry supplies the module address and
   the coding DID + layout, and — when it declares `security` — an installed security-access plugin
   unlocks it. No profile data ⇒ read-only; `security` without a plugin ⇒ refused, nothing sent.
6. **Keep-alive + verify:** maintain TesterPresent during the edit; after writing, **re-read** and
   confirm the value took; surface any negative response (`7F`) verbatim.

### Gates as built today

What actually stands between a fresh install and a `2E` on a real module:

- **Availability** (`useCoding.available`): the selected profile declares `codingModules` **and** the
  live protocol is CAN. The Golf Plus 2009 profile ships `codingModules`, so on that car the screen
  is reachable.
- **Per-session unlock** (`codingStore.unlocked`): a plain `Switch` on `CodingScreen`, in-memory
  (resets on app restart), checked again inside `useCoding.write` / `applyTweak`. Off by default.
- **Confirm step**: every write button (module editor, tweaks, backup restore) opens an inline
  **Confirm / Cancel** row — a second tap, not a typed string.
- **Backup-first + verify**: the module editor writes only after **Read + backup**, and every write
  re-reads and verifies.
- **Security access** (plan 23): a module with `security` is unlocked only with an installed plugin
  that matches it; otherwise `useCoding.write` (and so every tweak) stops with “Locked — this module
  needs security access and no plugin is installed for it.” before `ATSH`. The old identity
  `seedToKey` fallback is gone — it could never unlock a real module and burned an attempt.

Not built yet: the **Settings flag** and the **typed confirmation string** from rule 1. Until they
land, a real CAN write on a coding-capable profile is one switch and two taps away.

## UI

- **CodingScreen** — writes only when unlocked (the unlock switch sits at the top). Per supported module: current coding (raw +
  decoded byte/bit editor), a **before→after diff**, **Backup**, **Write**, **Restore original**, and
  a persistent experimental/danger banner. Hidden entirely on non-CAN links and when no profile
  module is declared.

## hooks

- `useCodingUnlock()` — the flag + per-session unlock/confirmation gate. (Not built: today the
  unlock is `codingStore.unlocked`, read directly by `useCoding` and the screen.)
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
  plus byte/bit schema, and an optional security routine descriptor. Writes stay locked until the
  per-session unlock.

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
  undocumented bit. For screen readers each raw bit is a switch named `Byte <n> bit <b>` with its
  on / off state and the steppers are `Decrease` / `Increase <field>`; the bits are 44 dp targets
  (36 dp + 4 dp slop, 8 dp apart) whose slops never overlap (plan 20). Toggling a bit / choosing a value updates a `before → after` hex preview with the
  changed bytes highlighted. The write still goes through the **existing gated path** (`useCoding.write`
  → `codeModule`: backup → write → verify); the helper only shapes the edit.

## Tweaks — one-tap presets (6b.5)

OBDeleven-style curated toggles compiled down to the same gated write. A preset is **data** on the
profile (`codingPresets`, linked to a `codingModules` entry by ATSH header); pure helpers in
`obd-core/coding/presets` apply/revert/detect it:

- `detectPresetState(bytes, preset)` → `on` / `off` / `unknown` drives each row's state badge.
- Each row also carries a **verification badge** (`VerificationBadge`, plan 25): green "Standard OBD2", blue "Confirmed <date> (<source>)" once the profile item carries `confirmed` evidence, amber "Illustrative — not yet confirmed on this car" otherwise — the bit positions are confirmed only with evidence
  (`CodingPreset.confirmed`, plan 25).
- `compareCodingSnapshots(before, after, presets)` → per preset `on` / `off` / `none`: which
  shipped preset explains the difference between two BCM coding reads taken around a VCDS toggle.
  It matches only when every changed bit lies inside the preset's edit masks and the after-read is
  exactly its on (or off) state — so a wrong bit position shows up as `none`. The tool for
  confirming a tweak from the owner's own before / after reads (plan 25, on-car step 6).
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
- **Store** `carBackupStore` (persisted as `bolid.carBackups` **v1** since plan 18 — it shipped
  unversioned, so zustand wrote 0; `migrateCarBackups` keeps the same shape — capped `MAX_CAR_BACKUPS = 10`, debounced + rehydration-merge
  safety net, like `scanHistoryStore`). **Export/share** as `.json`.
- **Restore is per-module and gated.** Coding restore is exactly the existing gated coding write
  (`useCoding.write(codingModule, snapshotBytes)` → backup + verify), behind unlock + confirm.
- **Adaptation restore (plan 24).** Each module block with adaptation values has **Compare with
  car**:
  1. `useAdaptationRestore.readCurrent(module)` reads every profile channel of that module fresh
     (reusing the adaptations feature's `readChannel`) plus the module's long coding when the
     snapshot has one, keyed by DID.
  2. `planAdaptationRestore(snapshot, channels, current, { unlockable })` (pure,
     `api/adaptationRestore.ts`) decides per channel, in this order: no `(reqHeader, did)` channel
     in the current profile → **`no-channel`** (“not in profile”); the backup could not read it →
     **`no-snapshot-raw`** (“not in backup”); the snapshot bytes fail the shared bounds guard
     (`adaptationBoundsError`: wrong width, or outside `min`/`max`) → **`out-of-bounds`**, shown
     with the bounds message — refused, never clamped, because a later profile revision may have
     tightened the bounds; `ch.security` and not unlockable → **`locked`** (unlockable = an
     installed security-access plugin matches the channel's module, plan 23); current bytes equal the
     snapshot bytes → **`equal`** (greyed); otherwise **`restore`**. `summarizeRestorePlan` counts
     them.
  3. A header line from `restoreHeadline(snapshot, currentModuleFromReads(...), diff, items)`,
     e.g. “2 adaptations differ, coding unchanged”. The adaptation count comes from the plan rows on
     raw bytes (the same comparison the rows use), so it never disagrees with them: a channel the
     profile no longer declares, the backup could not read, or the car did not answer for counts as
     “N not compared”, never as a difference; the coding part comes from `diffBackupModule`. Then
     one row per channel: name (DID) · backup → car now (decoded with unit) · action chip, and the
     skip reason under skipped rows.
  4. Per row **Restore** asks inline (“Write 850 rpm to Idle speed offset (DID 3001)? A backup of
     the current value is taken first.”); **Restore all (N)** lists the N channels and writes them
     one by one with progress, stopping at the first failure and naming the channels not restored.
     After any write the panel compares again.
  - **Gating.** These are adaptation writes, so they use the **adaptations unlock**
    (`adaptationsStore.unlocked`), not the coding one; while it is off the Restore buttons are
    disabled with “Locked — unlock adaptations on the Adaptations screen…”, and the hook re-reads
    the unlock at write time so it fails closed. Every write goes through the adaptations feature's
    `writeChannel` (bounds re-checked there → `codeModule`: read backup → `10 03` → `2E` → re-read
    verify, `resetAddressing()` in `finally`); the replaced value is pushed onto
    `adaptationsStore.backups`, so it can be restored again from the Adaptations screen.
  - **CAN only**, like the Adaptations screen: on a non-CAN link Compare is disabled (“Connect to the
    car over CAN…”) and the hook refuses to read or write.
  - **Same car only.** `backupVehicleMismatch(backup.vehicle, { profileId, vin })` blocks every
    restore of a snapshot (coding and adaptations) when it was taken under another profile / garage
    car, or when both VINs are known and differ; the expanded snapshot shows why. Compare and export
    stay available.
  - **One action at a time.** Creating a backup, restoring a module's coding and comparing /
    restoring adaptation channels all take one shared, non-persisted gate (`backupWorkStore`), so
    two of them never interleave `ATSH` / `2E` sequences on the session (which has no lock of its
    own); an action started meanwhile is refused and the buttons show **Busy…**. A compare or write
    that throws (e.g. the link drops inside `resetAddressing`) is logged and shown as “Failed: …”
    and the stale table is dropped.
  - Out of scope: channels on modules the current profile no longer declares (shown as
    `no-channel`) and TP2.0/KWP channels.
- UI: a **Backup** section on `CodingScreen` — create, expandable snapshots (per-module coding hex +
  adaptation values), export, delete, per-module gated coding restore, and the adaptation compare /
  restore panel (`ui/AdaptationRestorePanel.tsx`).
- The flow is tested end to end on the simulated Golf (`adaptationRestore.integration.test.ts`:
  change `3001` to 900, plan → `3001` restore / `3002` equal, restore → 850; a 1024 rpm snapshot is
  refused by the planner and by `writeChannel`) and on screen (`ui/CodingBackup.test.tsx`).
  **On-car pending:** the first real use on the Golf is a no-op restore (backup, Compare → all
  `equal`), then a one-step change restored and re-read — see plan 24's deferred section.

## Security-access plugins (plan 23)

A write that a UDS module protects with `27` SecurityAccess can be unlocked **only** with a
seed→key routine the owner supplies for their own car, as a small data file the app validates and
runs in a sandbox. **The app never ships, downloads or derives such a routine** — not in code, not
in profiles, not in docs; owners supply their own for their own vehicle.

- **File format** — `bolid.seedkey.v1` (a name, a scope `applies: { reqHeader?, address?, level,
partNumberPrefix? }`, `seedBytes` / `keyBytes` of 2 or 4, and a `program`), specified with the
  op reference in [exchange-formats.md](../exchange-formats.md#bolidseedkeyv1). Imported in
  **Settings → Security access plugins** (`settings/ui/SeedKeysSection.tsx`): pick → validate
  → preview (name, scope, widths, steps written / run, “Only for this car” switch) → **Install**;
  installed plugins are listed with **Test in simulator** and **Delete**.
- **Sandbox** — the program is a bounded list of 32-bit accumulator operations interpreted by
  `obd-core/coding/seedKeyDsl.ts` (`compileSeedKey`), **not JavaScript**: Hermes has no `eval`, a
  data program cannot touch the file system, network, stores or session (seed in, key out), and its
  exact step count is known before it runs (≤ 4096 steps, ≤ 256 ops, repeats ≤ 64 × ≤ 32 ops,
  nested ≤ 2 deep). A file over the limits is refused at import with the reason.
- **Storage** — the file is copied to `documentDirectory/seedkeys/<id>.json`; the persisted index
  `bolid.seedKeys` (`shared/state/seedKeyStore.ts`) holds name, scope, widths, file URI, import time
  and an optional `vehicleKey` pin — never the program, which is read, re-validated and compiled at
  every unlock. Plugins are not in `bolid.settings`, not in a profile / label-pack export and not in
  a backup (`NOT_BACKED_UP`); on a new phone, import the file again.
- **Scope matching** (`shared/security/resolveSeedKey.ts`, `matchSeedKeyPlugin`) — among plugins
  for the module's `level` (and, when pinned, for this car's `vin:` / `id:` key): first one naming the
  module's request header or VAG address, else one naming only a part-number prefix that the
  module's known part number starts with. A pinned plugin wins over an unpinned one, then the newest.
  A plugin naming a prefix never matches a module whose part number is unknown or different — fail
  closed, because each wrong key counts toward the module's lockout (NRC `0x36`). The part number is
  always the one the **live module scan** read (F187, `scannedPartNumber` in
  `module-scan/model/moduleScanStore.ts`) — never a profile's static `partNumber`, which is
  illustrative — on every surface (coding cards, tweaks, adaptations, the backup restore panel), so
  until a scan reads it a prefix-scoped plugin matches nothing.
- **Every write surface** resolves through the same helpers (`decideSecurity`,
  `securityDecisionForActiveCar`): **coding** and **tweaks** refuse without a plugin; **adaptations**
  (`writeChannel(…, { seedToKey })`, also the backup restore panel, whose planner treats a security
  channel as `locked` unless a plugin matches) refuse; **service reset** refuses (the screen leads with
  the manual procedure); **routines** unlock with a plugin and otherwise still attempt the routine
  unlocked (the module decides; NRC `0x33` is explained).
- **Badges** — `shared/ui/UnlockBadge.tsx` (“No unlock needed” / “Unlockable · <plugin>” /
  “Locked · needs security access”) on coding module cards, tweak rows (through their module),
  adaptation channels (replacing “Security-locked (read-only)”), routine rows and the service-reset
  card, via `useUnlockStatus`.
- **Test in simulator** (`shared/security/simulatorCheck.ts`) — runs the plugin twice on a fixed
  test seed, then drives the real `codeModule` flow (backup → `10 03` → `27` → `2E` → verify)
  against a one-module simulator whose SecurityAccess model expects that key and protects `2E`
  (after checking it refuses the write while locked). A pass proves the file works end to end in the
  app; it cannot prove the routine is right for the car, and says so.
- **Policy, tested** — `shared/vehicles/noSeedKeys.test.ts` fails if a registry profile sets
  `seedToKey`, a vehicle file mentions one, or any production file falls back to an identity key.
  The test vector used in tests (seed XOR `0xFFFF`) lives only in test files.

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
