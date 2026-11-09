# Exchange formats — profile and label-pack files

A garage car ("profile") or a label pack can leave the phone as a **versioned JSON file** and be
imported on another phone, or from a community repository, through the OS file picker
([plan 13](./plans/13-profile-labelpack-import-export.md)). Both files share one envelope, are
validated strictly on import, and are **pure data**: nothing in a file is ever evaluated.

Code: `src/shared/lib/exchange/` (types, schemas, parse / plan / export — pure, unit-tested),
`src/shared/lib/validate.ts` (the validator combinators), `src/shared/state/exchangeService.ts`
(pick, preview, apply, share), `src/shared/state/labelPackStore.ts` (imported packs),
`src/shared/ui/ImportPreviewSheet.tsx` (the preview). Examples:
[`examples/profile.example.json`](./examples/profile.example.json),
[`examples/label-pack.example.json`](./examples/label-pack.example.json) (both double as test
inputs).

## Envelope

```ts
interface ExchangeEnvelope<S extends string, T> {
  schema: S; // 'bolid.profile.v1' | 'bolid.labelpack.v1'
  exportedAt: string; // ISO 8601
  app: { name: 'bolid-tester'; version: string };
  payload: T;
}
```

File names: `bolid-profile-<slug(name)>-<stamp>.json`, `bolid-labelpack-<slug(id)>-<stamp>.json`
(stamp = ISO time with `:` and `.` replaced by `-`). Files are written to the app's document
directory and handed to the share sheet.

## `bolid.profile.v1`

```ts
interface ProfilePayloadV1 {
  vehicle: {
    name: string; // 1–80 characters
    year?: number; // 1950–2100
    fuel: 'diesel' | 'petrol' | 'lpg' | 'hybrid' | 'other';
    make?: 'vag' | 'fiat' | 'generic';
    baseProfileId: string; // a built-in profile id, e.g. 'golf-plus-2009-20tdi'
    learned?: {
      protocol: ProtocolId; // one of the ELM327 protocol ids the app knows
      supportedPids: string[]; // Mode 01 PIDs, '01' + two uppercase hex digits, ≤ 512
      vin: string | null; // ≤ 17 letters or digits
      calibrationId: string | null; // printable, ≤ 64
      adapterVersion?: string; // printable, ≤ 64
      learnedAt: number; // epoch ms
    };
    notes?: string; // ≤ 4000
    modules?: DiagModule[]; // discovered modules (plan 25), ≤ 64; UDS needs reqHeader + rxFilter
    sourceId: string; // the exporting phone's 'user:…' id, or the registry id of a seed
  };
  labelPacks?: LabelPackV1[]; // ≤ 20, the exporting phone's imported packs for this car
}
```

- **Garage car → file**: `exportVehicle(user, packs)`. The car's identity, learned identity, notes
  and discovered modules travel; its **code book (`loginCodes`) never does** — module login codes
  stay on the phone that learned them (a full backup, plan 18, still carries them). The imported
  label packs whose prefixes match a part number the car's resolved profile knows (coding modules'
  `partNumber`, modules' seeded `F187`) are embedded, in the store's precedence order (newest
  first); the importer adds them so the receiving phone keeps that order, and an equal-prefix tie
  goes the same way on both phones. The fields are clamped to the schema so every garage car
  exports to a file that imports again: name trimmed to 80 characters (a blank one falls back to
  the VIN default name), notes to 4000, the learned calibration id and adapter version to printable
  ASCII and 64 characters (an ECU reporting several CALIDs joins them past that). The garage editor
  caps name and notes at the same limits (`VEHICLE_NAME_MAX` / `VEHICLE_NOTES_MAX`).
- **Self-check**: `shareExchangeFile` validates every file against its own schema before writing it;
  a file that would not import is logged and not written ("Could not export…").
- **Built-in profile → seed**: `exportProfileSeed(profile)` — name, year, fuel, make,
  `baseProfileId = sourceId = profile.id`, no `learned`. The receiver gets a garage car on that base
  and learns their own VIN / PIDs on connect. Auto / Generic is not offered (a seed of it says
  nothing).
- Extended PIDs and other profile data with `decode` functions are code and are never exported; a
  car carries only `baseProfileId`, and inherits the rest from the receiving app's registry.

Full example: [`examples/profile.example.json`](./examples/profile.example.json).

```json
{
  "schema": "bolid.profile.v1",
  "exportedAt": "2026-11-09T10:00:00.000Z",
  "app": { "name": "bolid-tester", "version": "0.1.0" },
  "payload": {
    "vehicle": {
      "name": "VW Golf Plus 2009 2.0 TDI 81 kW",
      "year": 2009,
      "fuel": "diesel",
      "make": "vag",
      "baseProfileId": "golf-plus-2009-20tdi",
      "notes": "Starting profile shared from the built-in Golf Plus. …",
      "sourceId": "golf-plus-2009-20tdi"
    }
  }
}
```

## `bolid.labelpack.v1`

```ts
interface LabelPackV1 extends LabelPack {
  // LabelPack: id, module, partNumberPrefixes, measurements?, codingBits?, adaptations?,
  //            measuringGroups? — see features/adaptations.md → "Label packs"
  author?: string; // ≤ 200
  source?: string; // URL or free text, ≤ 500
  license?: string; // SPDX id, e.g. 'CC0-1.0'
  confirmed?: Confirmation; // plan 25: { on: 'YYYY-MM-DD', source, fixture?, note? }
}
```

Rules: `id` letters / digits / `.` / `_` / `-`, at most 64; `partNumberPrefixes` 1–32 entries, each
3–12 uppercase letters or digits with no spaces; `measurements`, `codingBits` and `adaptations` are
keyed by a **4-digit uppercase hex DID** (`'1701'`, `'F1A0'`); `measuringGroups` by a 1–3 digit
group number, each group at most four DIDs; coding bits are `{ byte 0–255, bit? 0–7, name }`; names
≤ 120 characters, units ≤ 16, descriptions ≤ 500; every record ≤ 512 entries.

Full example: [`examples/label-pack.example.json`](./examples/label-pack.example.json) — the
bundled EDC17 pack's names for prefix `03L906022` plus one extra measurement (`170A`, injector
correction cylinder 1) and its own description for adaptation `3001`.

## Import

1. **Pick** — `expo-document-picker` (`application/json`, `text/plain`, `application/octet-stream`;
   Android labels files loosely, the content is validated anyway), copied to the cache directory.
   A file over **1 MB** is refused before it is read.
2. **Parse** — `parseExchangeFile(text)`: strip a byte-order mark, `JSON.parse` (never `eval`), read
   `schema`, validate with the matching schema. Refusals carry a one-line reason and the validator's
   errors; the sheet shows the **first three** and "Nothing was changed." Readable reasons for a file
   that is not JSON, not an exchange file, a whole-garage export (`bolid.garage`, plan 06 — import
   one car at a time), a **newer** version (`bolid.profile.v9` → "made by a newer version of the
   app. Update the app to import it.") or an unknown format.
3. **Preview** — `previewImport`: name / year / fuel / base profile / VIN ending / learned PID count
   for a car (an unknown base id is shown and falls back to Auto / Generic); module, id, prefixes,
   counts, author / licence / source and the overlap warnings for a pack.
4. **Conflicts** (pure planners, re-run at apply time):
   - `planProfileImport(file, garage)` — a garage car with the same learned VIN (`same-vin`), else
     the same name, case- and space-insensitive (`same-name`), is a conflict; else `create`.
   - `planLabelPackImport(pack, userPacks, bundled)` — a user pack with the same id → `replace`;
     every other pack whose prefix overlaps (one is a prefix of the other) is listed with who wins:
     "This pack also matches prefix 03L906022 used by the bundled EDC17 engine (2.0 TDI CR) pack;
     the imported names will take precedence." `full` when the phone already holds 100 packs.
   - Choices: **Replace** (a car keeps its id, `createdAt` and its own code book), **Keep both**
     (the name gets " (2)", shortened so it stays within 80 characters; the pack id gets `-2`),
     **Cancel**.
5. **Apply** — `garageStore.add` / `garageStore.replace`, `labelPackStore.add` / `replace`. Embedded
   packs of a profile are added when no imported pack has their id (a local pack with that id is
   kept). History is untouched.

## Validation and safety

The validator (`shared/lib/validate.ts`, ~200 lines, no dependencies) is hand-written: `ajv`
compiles schemas with `new Function`, which Hermes does not support, and `zod` would add ~60 KB.
Combinators: `str`, `num`, `bool`, `lit`, `opt`, `nullable`, `arr`, `rec`, `obj`, `hex`. Errors are
JSON-pointer paths (`/payload/vehicle/fuel: expected one of diesel|petrol|lpg|hybrid|other, got
"coal"`). A validator reads only own properties, rebuilds the value from the schema (so nothing the
schema does not name is stored), rejects the `__proto__` / `constructor` / `prototype` keys and caps
every list, record and string. The imported-pack store re-validates its own file on every load.

## Versioning

- **Additive fields only** within a version. Every object strips unknown keys, so a file from a
  newer app with extra fields still imports into an older one.
- A **breaking** change bumps the schema (`bolid.profile.v2`); the app keeps importing `v1` files
  (convert on import) for as long as they can exist.
- An older app shown a `v2` file says it was made by a newer version and changes nothing.

## Licensing community packs

Label packs are facts about module data (DIDs, bit positions, names). Publish community packs with
an explicit `license` — `CC0-1.0` is recommended so packs can be merged into the bundled set without
attribution chains — and an `author` / `source`. Do not copy names from commercial label files
(e.g. VCDS `.lbl` files); write your own from your own captures. Set `confirmed` only with evidence
(plan 25). Every imported pack stays labelled unconfirmed in the preview until it has it.
