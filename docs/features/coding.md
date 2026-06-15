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
