# Contribute a label pack

A label pack names a module family's measuring values, coding bits, adaptation channels and
measuring groups. It is keyed by the module **part-number prefix** (read live from `F187` by the
module scan), so one pack serves every car with that module. It is the app's open equivalent of a
VCDS label file, written from scratch. Ground rules, evidence levels and licensing:
[CONTRIBUTING.md](../../CONTRIBUTING.md). Field reference:
[adaptations → Label packs](../features/adaptations.md#label-packs-srcsharedlabels).

## Steps

1. **Name it.** The pack `id` is `<make>-<module>-<partPrefix>`, letters and digits joined by
   `-`: make and module lower-case, the part prefix as the module reports it, e.g.
   `vag-edc15-038906019`. The file is `src/shared/labels/packs/<camelCaseName>.ts`, matching the
   bundled packs (`vagEdc17Golf.ts`, `vagBcmPq35.ts`).
2. **Write the pack.** Export one `LabelPack`:

   ```ts
   import { LabelPack } from '../types';

   /** EDC15 engine labels for the 038906019* part numbers (1.9 TDI PD, e.g. the Passat B5.5).
    *  ILLUSTRATIVE — not yet confirmed on a car. Names written for this project. */
   export const vagEdc15Passat: LabelPack = {
     id: 'vag-edc15-038906019',
     module: 'EDC15 engine (1.9 TDI PD)',
     partNumberPrefixes: ['038906019'], // no spaces
     measurements: {
       '0001': { name: 'Engine speed', unit: 'rpm' }, // DID keys: four upper-case hex digits
       '0002': { name: 'Injection quantity', unit: 'mg/str' },
     },
   };
   ```

   Optional sections: `codingBits` (coding DID → `{ byte, bit?, name }[]`), `adaptations` (DID →
   `{ name, unit?, description? }`) and `measuringGroups` (group number `'001'`… →
   `{ name, dids, description? }`, at most four DIDs). Units are metric.

3. **Register it** in `LABEL_PACKS` in `src/shared/labels/registry.ts`.
4. **Add a test case** to `src/shared/labels/registry.test.ts`: `findLabelPack(partNumber)?.id`
   is your id for a full part number of the family, and one label resolves.
5. **Run the checks:**

   ```bash
   npm test -- labels/registry
   npm run validate:contrib
   ```

## What the validator checks

- `id` unique across packs; `module` not empty; every measurement / adaptation / coding bit has a
  name; DID keys are four upper-case hex digits; groups have at most four DIDs, none twice.
- **Prefixes.** Two packs with the **same** prefix fail (which one wins would depend on the order).
  A prefix **inside** another (`03L906` and `03L906022`) is only a warning: the longer prefix wins
  for its part numbers, which may be what you want. Write prefixes without spaces.
- The pack is registered in `LABEL_PACKS`.

## Evidence and honesty

A new pack is **illustrative**: say so in its header comment. Labels become trustworthy with a
capture: record the module with the Bus sniffer while the dealer tool or VCDS shows the value, commit
the CSV under `docs/captures/`, and name it in the pull request
([captures/README.md](../captures/README.md)). Never copy names or groupings from VCDS `.lbl` /
`.clb` files.

A pack can also travel without a pull request: **Settings → Label packs** imports a
`bolid.labelpack.v1` JSON file ([exchange-formats.md](../exchange-formats.md)), and a bundled pack
can be exported as a template to start from.
