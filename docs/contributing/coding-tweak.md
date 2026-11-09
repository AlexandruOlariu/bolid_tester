# Contribute a coding tweak

A tweak is a one-tap, reversible coding change ("daytime running lights on") compiled down to the
app's gated coding write: backup → write → verify, behind the per-session unlock
([coding → Tweaks](../features/coding.md#tweaks--one-tap-presets-6b5)). It is **data** on a vehicle
profile. Ground rules, evidence levels and licensing: [CONTRIBUTING.md](../../CONTRIBUTING.md).

Never write a tweak for airbag, immobilizer, ABS or instrument-cluster mileage, and never one that
needs a seed/key you would have to ship.

## Steps

1. **The coding module must exist.** The profile's `codingModules` needs an entry for the module
   (`reqHeader`, `rxFilter`, `codingDid`, `byteCount`, `schema`, `sampleCoding`,
   `experimental: true`). Add it first if needed; `sampleCoding` is the coding the simulator
   stores and answers with.
2. **Add the preset** to the profile's `codingPresets`:

   ```ts
   {
     id: 'golf-drl', // unique, kebab-case, starts with the car
     title: 'Daytime running lights',
     description: 'Enable the always-on daytime running lights (BCM byte 0, bit 0).',
     reqHeader: '70E', // = the codingModules entry it changes
     edits: [{ byte: 0, bit: 0, mask: 0x01, onValue: 0x01, offValue: 0x00 }],
     reversible: true, // always: offValue is the factory state the revert restores
   }
   ```

   `onValue` / `offValue` are the masked bits **in place** within the byte (a nibble uses e.g.
   `mask: 0x0f`, `onValue: 0x03`). The `description` says honestly what changes and where; the
   comment above the presets says "illustrative" until the bit positions are confirmed.

3. **Show both states in the simulator.** `sampleCoding` should hold one state of the bits your
   preset changes, so the integration test can read it, apply the preset, verify, and revert.
4. **Add a test case** to `src/shared/obd-core/coding/presets.integration.test.ts`: detect the
   current state from the seeded coding, apply → write → verify against `MockTransport`, then
   revert and verify the factory value is back. Pure apply / revert / detect cases go in
   `presets.test.ts`.
5. **Run the checks:**

   ```bash
   npm test -- presets
   npm run ci
   ```

## Confirming it

A tweak's bit positions are confirmed with two coding reads around the change made by a dealer
tool or VCDS: `compareCodingSnapshots(before, after, presets)` says which preset explains the
difference. Commit the evidence (a capture under `docs/captures/` or a replay fixture) and set the
preset's `confirmed: { on, source, fixture, note }` in the same pull request
([vehicles → `confirmed`](../vehicles/README.md#confirmed--evidence-that-an-item-was-checked-on-the-car)).
