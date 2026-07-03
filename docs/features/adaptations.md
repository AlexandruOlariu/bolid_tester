# Feature: adaptations — channel browser (experimental, write-capable, gated)

VCDS-style **adaptation channels**: small numeric module values (idle offset, base duties, service
counters…) read via UDS `22` and written via `2E` with the coding feature's full guardrails —
unlock gate, mandatory backup, bounds checking, verify-after-write, restore.

> ⚠️ **DANGER / EXPERIMENTAL.** Channel DIDs, scaling and safe bounds are per-module and NOT
> standardized. Shipped channels are **illustrative** and must be confirmed on the real car.
> Channels that require SecurityAccess are **read-only** unless the profile supplies a real
> seed/key algorithm (none ship). K-line cars are out of scope (their VAG adaptation lives behind
> KWP1281, unreachable over a generic ELM327).

## Model
- Profiles gain `adaptations?: AdaptationChannel[]` — module + headers, DID, `byteCount`,
  display scaling (`scale`/`offset`), display bounds (`min`/`max`), optional `defaultRaw`,
  optional `security` (⇒ read-only), simulator `sampleValue`.
- Value math is pure + unit-tested: `obd-core/coding/adaptationValue.ts`
  (`decodeAdaptationRaw` / `encodeAdaptationValue`, clamped big-endian).
- `adaptationsStore` (Zustand): `unlocked`, `values`, `backups` (last 50), `lastResult`, `running`.

## Label packs (`src/shared/labels/`)
The open equivalent of VCDS label files: a `LabelPack` names measurements, coding bits and
adaptation channels for a module FAMILY, keyed by **part-number prefix** (matched against the live
`F187` ident from [module-scan](./module-scan.md); longest prefix wins). Packs are data,
community-extensible; `vag-edc17-03L906022` ships as the illustrative example. The adaptations
screen shows the pack's channel descriptions when the scanned part number matches.

## api / hooks / UI
- `adaptationService.readChannel/writeChannel` — header addressing + `codeModule` (backup →
  write → verify) reuse; security-locked channels never attempt a write.
- `useAdaptations()` — CAN + profile gating, bounds validation, backup/restore, label enrichment.
- **AdaptationsScreen** — unlock switch (off = read-only), per channel: current value, read,
  numeric editor with explicit before→after confirm, restore-from-backup and restore-known-default.

## Acceptance
- Golf simulator: both channels read (850 rpm / 50 %), a bounded write round-trips and verifies,
  out-of-bounds values are rejected before any bus traffic, restore returns the original.
- Locked (default): no write control is reachable. Passat/Punto: honest unavailability note.
