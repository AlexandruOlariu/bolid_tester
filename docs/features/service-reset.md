# Feature: service-reset (experimental, write-capable, gated)

Reset the **service interval / oil-service reminder** ("SRI reset" — the *service now / service in
N km* indicator). This is a **write** to a control module, so it carries the same guardrails as
[`coding`](./coding.md).

> ⚠️ **DANGER / EXPERIMENTAL.** There is **no standard OBD2 service-reset.** It is manufacturer- and
> module-specific, normally on the **instrument cluster**. This feature ships **gated** (explicit
> confirmation), is **profile-driven** (CAN/UDS **or** K-line/KWP2000), and (for the adaptation method) **backs up the
> current values first**. The reset descriptors shipped in profiles are **illustrative** and must be
> **confirmed on the real car**.

## What's actually possible over a generic ELM327
The cluster is just another module we can address (`ATSH`/`ATCRA` + flow control), so a CAN car can,
in principle, be reset two ways — both defined per-profile:
- **Routine method** — UDS **RoutineControl `31`** start a manufacturer "reset service" routine
  (some VAG clusters). One request, positive `71` response, done.
- **Adaptation method** — UDS **WriteDataByIdentifier `2E`** writing the service-interval
  adaptation value(s) back to default (distance/time since service). Read current first (backup),
  then write defaults.

On **K-line/KWP2000** the same idea uses the KWP service IDs (`10` start session, `27` login, `31`
StartRoutine, `3B`/`21` write/read local identifier). Either transport may sit behind **SecurityAccess `27`** (manufacturer-secret seed/key); the profile must supply
the algorithm or the module must need none.

## The real limits (honest)
- **Two transports.** CAN/UDS (Golf) and K-line/KWP2000 (Passat). Both are experimental and the
  descriptors are illustrative — confirm on the real car.
- **K-line (Passat B5.5):** supported via a **KWP2000** (ISO 14230) path — start a diagnostic
  session, optional login, then a StartRoutine (`31`) or local-identifier adaptation write (`3B`).
  This is **even more experimental and slower**; on a real B5.5 the dash stalk buttons are often the
  reliable method, and the descriptor here is illustrative. The **Punto** declares no reset descriptor.
- **Illustrative descriptors.** Routine IDs / adaptation DIDs / default values are **not
  standardized** and must be confirmed on the real vehicle.

## Safety model
1. **Gated:** reachable only after an explicit confirmation; profile-gated and transport-matched
   (hidden when the profile declares no `serviceReset`, or the link doesn't match its transport).
2. **Backup (adaptation method):** the current adaptation value is read and stored before any write,
   with a shown before→after.
3. **Verify:** after a write/routine, surface the positive response or the negative response (`7F`)
   verbatim.
4. **Never K-line / never other safety modules.**

## UI
- **ServiceResetScreen** — shows the target module + method, a prominent experimental/danger banner,
  a single **Reset service interval** action behind a confirm, and the result (success / the raw
  negative response). Hidden entirely on non-CAN links and when no profile descriptor exists.

## hooks
- `useServiceReset()` — reads the profile's `serviceReset`, gates on CAN, runs the
  `enterSession → (security) → routine|adaptation → verify` flow, exposes availability + result.

## api (service layer)
- Reuses the UDS layer: `serviceReset()` and `routineControl()` in
  [`obd-core/coding/udsCoding`](../architecture.md), addressed via the session's `setHeader` /
  `setRxFilter` (same path as [`sensor-tests`](./sensor-tests.md) and [`coding`](./coding.md)).

## model
- Profiles gain an optional, clearly-experimental `serviceReset` descriptor: module CAN ids, method
  (`routine` | `adaptation`), routine id or adaptation DIDs + default bytes, and an optional security
  level. **None are shipped enabled by default beyond the illustrative Golf example.**
- `serviceResetStore` (Zustand): `lastResult`, `running`.

## Behavior
- The whole flow is exercised end-to-end against the **simulator** (the cluster routine returns a
  positive response), so the UX + guardrails are testable with no hardware and no risk.
- On a real car, anything missing (no descriptor, wrong transport, failed security, negative
  response) blocks with a clear reason.

## Acceptance
- In the simulator with the Golf's seeded routine descriptor, the reset reports success.
- With the Passat's KWP descriptor, the reset reports success in the simulator; the feature is
  **absent** only for the Punto (no descriptor).
