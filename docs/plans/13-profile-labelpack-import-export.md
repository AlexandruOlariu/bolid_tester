# Plan 13 — Profile and label-pack import / export

**Size:** M (1–1½ days) · **Depends on:** plan 06 (`UserVehicle`, `garageStore`) · **Roadmap:**
v0.3 "Profile import / export", v0.6 "Label-pack expansion (community import)"

## Goal

A garage vehicle or a label pack can be **exported as a versioned JSON file** and **imported** on
another phone (or from a community repo) through the OS file picker, with schema validation, a
preview, and explicit conflict handling. Imported label packs live in a persisted store and are
**merged over the bundled registry** so `findLabelPack` sees them everywhere (coding helper,
adaptations, measuring groups) without any feature changing.

## Why

`src/shared/labels/registry.ts` is a hard-coded `LABEL_PACKS = [vagEdc17Golf, vagBcmPq35]`; adding
a pack means a TypeScript PR. Plan 06 makes vehicles user data but leaves them trapped on one
phone. The roadmap calls label packs "the single highest-leverage data investment" — that only
pays off if packs can travel as data.

## Read first

- `src/shared/labels/{types.ts, registry.ts, index.ts}`, `packs/vagEdc17Golf.ts`,
  `packs/vagBcmPq35.ts`, `registry.test.ts` (keep every assertion green).
- Plan 06: `src/shared/vehicles/userVehicle.ts` (`UserVehicle`, `LearnedIdentity`),
  `src/shared/state/garageStore.ts`.
- `src/shared/vehicles/types.ts` (`VehicleProfile`, `Fuel`), `src/shared/obd-core/obd/protocols.ts`
  (`ProtocolId` — the union the validator must accept).
- `src/features/error-log/hooks/useErrorLogExport.ts` (export pattern),
  `src/features/coding/hooks/useCarBackup.ts` `exportBackup` (same pattern, JSON).
- `src/shared/state/persistStorage.ts` (`fileStateStorage`), `src/shared/state/historyStore.ts`
  (persist + `merge` idiom).
- `docs/features/adaptations.md` § "Label packs", `docs/features/vehicle-select.md`.
- `package.json` — `expo-document-picker` and `expo-clipboard` are **not** installed (verified).

## Design

### File formats (versioned envelopes)

```ts
// src/shared/lib/exchange/types.ts
export interface ExchangeEnvelope<S extends string, T> {
  schema: S; // 'bolid.profile.v1' | 'bolid.labelpack.v1'
  exportedAt: string; // ISO 8601
  app: { name: 'bolid-tester'; version: string };
  payload: T;
}
export interface ProfilePayloadV1 {
  vehicle: Omit<UserVehicle, 'id' | 'createdAt' | 'updatedAt'> & { sourceId: string };
  /** Label packs the exporting phone had imported for this car's modules (optional, embedded). */
  labelPacks?: LabelPackV1[];
}
export interface LabelPackV1 extends LabelPack {
  author?: string;
  source?: string; // URL or free text
  license?: string; // e.g. 'CC0-1.0'
  /** Set when a pack entry was verified on a car — see plan 25 `Confirmation`. */
  confirmed?: { on: string; source: 'sniffer-capture' | 'on-car' | 'vcds-log'; note?: string };
}
export type ProfileFileV1 = ExchangeEnvelope<'bolid.profile.v1', ProfilePayloadV1>;
export type LabelPackFileV1 = ExchangeEnvelope<'bolid.labelpack.v1', LabelPackV1>;
```

`decode` functions on `ExtendedPid` are code and are **never** exported; a user vehicle only
carries `learned.supportedPids` + `baseProfileId` (plan 06), so the payload is pure data.

### Validator — hand-written, no `ajv`

`src/shared/lib/validate.ts`, ~120 lines, pure, tested:

```ts
export type Validator<T> = (v: unknown, path: string) => { ok: true; value: T } | { ok: false; errors: string[] };
export const v = {
  str(opts?: { min?: number; max?: number; pattern?: RegExp }): Validator<string>,
  num(opts?: { int?: boolean; min?: number; max?: number }): Validator<number>,
  bool(): Validator<boolean>,
  lit<L extends string>(...values: L[]): Validator<L>,
  opt<T>(inner: Validator<T>): Validator<T | undefined>,
  arr<T>(inner: Validator<T>, opts?: { max?: number }): Validator<T[]>,
  rec<T>(inner: Validator<T>, keyPattern?: RegExp): Validator<Record<string, T>>,
  obj<T>(shape: { [K in keyof T]: Validator<T[K]> }, opts?: { extra?: 'strip' | 'reject' }): Validator<T>,
  hex(len: number): Validator<string>,     // uppercase hex of exact length, e.g. DID '1701'
};
export function validate<T>(schema: Validator<T>, input: unknown): { ok: true; value: T } | { ok: false; errors: string[] };
```

Errors are JSON-pointer style (`/payload/vehicle/fuel: expected one of diesel|petrol|…`).

Why not `ajv`: it compiles schemas with `new Function`, which **Hermes does not support** (no
`eval`), so it would need the slower `ajv` "no-codegen" fallback plus ~120 KB; `zod` works on Hermes
but adds ~60 KB for two schemas. A 120-line combinator set is smaller than either, fully typed, and
reused by plans 23 (seed/key plugin files) and 25.

Schemas in `src/shared/lib/exchange/schemas.ts`: `profileFileV1`, `labelPackFileV1` built from the
combinators (DIDs `v.hex(4)`, part-number prefixes `v.str({ pattern: /^[0-9A-Z]{3,12}$/ })`,
`fuel` via `v.lit('diesel','petrol','lpg','hybrid','other')`, protocol via the `ProtocolId` list,
`supportedPids` entries `v.hex(4)` starting with `01`, arrays capped at 512, `extra: 'strip'` on
every object so future fields never break old apps).

### Label-pack store and registry merge

- `src/shared/state/labelPackStore.ts` — persisted `bolid.labelPacks` v1:
  `{ packs: LabelPackV1[]; add(p); replace(id, p); remove(id) }`, capped at 100 packs.
- `src/shared/labels/registry.ts`: keep `LABEL_PACKS` (bundled). Add module state and a setter:

```ts
let userPacks: LabelPack[] = [];
export function setUserLabelPacks(packs: LabelPack[]): void; // called by the store on hydrate + change
export function allLabelPacks(): LabelPack[]; // user packs first, then bundled
```

`findLabelPack` iterates `allLabelPacks()`; longest prefix still wins; on an equal-length tie the
**user pack wins** (it appears first). `measurementLabel` / `adaptationLabel` / `codingBitLabels`
unchanged. The store wires `useLabelPackStore.subscribe((s) => setUserLabelPacks(s.packs))` at
module load and calls the setter in `onRehydrateStorage`, so `shared/labels` stays free of zustand.

### Export

- Garage vehicle: `src/features/vehicle-select/api/exchange.ts` → `exportVehicle(user: UserVehicle,
packs: LabelPackV1[]): ProfileFileV1` (pure) + `shareVehicleFile(file)` (expo-file-system +
  expo-sharing, tolerant imports), file name `bolid-profile-<slug(name)>-<stamp>.json`.
- Built-in registry profile → exported as a **seed**: `vehicle = { name, year, fuel, make,
baseProfileId: p.id, sourceId: p.id }` with no `learned`. Lets a user send "Golf Plus 2009" to a
  friend who then learns their own PIDs on connect.
- Label pack: `exportLabelPack(pack): LabelPackFileV1` + share, from the new Settings → **Data**
  section (list of user packs with Export / Delete) and from the bundled list (export a bundled pack
  as a starting point for edits).

### Import

- Dependency: `npx expo install expo-document-picker` (new native module → requires a rebuild).
  Load tolerantly: `const Picker = await import('expo-document-picker' as string)`;
  `getDocumentAsync({ type: 'application/json', copyToCacheDirectory: true, multiple: false })`,
  then `FileSystem.readAsStringAsync(asset.uri)`.
- `src/shared/lib/exchange/import.ts` (pure): `parseExchangeFile(text): { kind: 'profile' | 'labelpack';
file } | { error: string }` — JSON parse → read `schema` → validate with the matching schema →
  size limit 1 MB.
- Conflict handling (pure, tested): `planProfileImport(file, existing: UserVehicle[]):
{ action: 'create' } | { action: 'conflict'; existingId; reason: 'same-vin' | 'same-name' }` and
  `planLabelPackImport(file, userPacks, bundled): { action: 'create' | 'replace'; overlaps:
{ packId; prefix }[] }`. UI choices on conflict: **Replace**, **Keep both** (name gets " (2)";
  pack id gets `-2`), **Cancel**.
- Preview sheet (`ImportPreviewSheet.tsx` in `src/features/vehicle-select/ui/`, reused for packs from
  Settings): name/year/fuel/base profile/VIN-suffix/learned PID count for profiles; module name,
  prefixes, counts of measurements / coding bits / adaptations / measuring groups for packs; the
  overlap warning "This pack also matches prefix 03L906022 used by the bundled EDC17 pack; the
  imported names will take precedence."
- Apply: `garageStore.add` / `labelPackStore.add|replace`; `logError`-free success toast; History
  is untouched.

### Where it shows

- Vehicle → garage card ⋯ menu: **Export**; Vehicle header: **Import profile**.
- Settings → **Data** (new section; plan 07 places it after Notifications): Import label pack ·
  user packs list (name, prefixes, counts, Export, Delete) · bundled packs (Export as template).

## Steps

1. `validate.ts` + `validate.test.ts`; `exchange/types.ts`, `exchange/schemas.ts` + tests.
2. `labelPackStore.ts` + registry `setUserLabelPacks` / `allLabelPacks`; wire subscription;
   registry tests for precedence.
3. Export functions + share hooks; Vehicle and Settings UI entry points.
4. `expo-document-picker`; `import.ts` + conflict planners + tests; preview sheet; apply.
5. Docs; `npm run ci`; rebuild the dev client (new native module).

## Simulator

No bus traffic. For a demo, ship `docs/examples/label-pack.example.json` (a pack for prefix
`03L906022` adding one extra measurement) and `docs/examples/profile.example.json` (a Golf seed);
the fixtures double as test inputs.

## Tests

- `validate.test.ts`: each combinator's accept/reject; nested error paths; `extra: 'strip'` drops
  unknown keys; `hex(4)` rejects lowercase/odd length.
- `schemas.test.ts`: both example files validate; a file with `schema: 'bolid.profile.v9'` is
  rejected with a readable message; a DID `'17G1'` is rejected at `/payload/measurements`.
- `registry.test.ts` additions: a user pack with a longer prefix beats the bundled one; equal
  prefix → user pack wins; clearing user packs restores bundled behaviour; existing assertions
  unchanged.
- `import.test.ts`: conflict planners (same VIN → conflict; same name only → conflict with reason;
  different → create; pack id collision → replace; prefix overlap listed).
- `labelPackStore.test.ts`: add/replace/remove, cap at 100.

## Docs

- New `docs/exchange-formats.md`: both schemas with a full example each, versioning rules
  (additive fields only; a breaking change bumps `v2` and the app keeps importing `v1`), licensing
  note for community packs.
- `docs/features/vehicle-select.md`: export/import; `docs/features/settings.md`: Data section;
  `docs/features/adaptations.md` § label packs: user packs + precedence; `docs/vehicles/README.md`:
  "Share a profile".

## Acceptance

- [ ] Export a garage car → JSON validates against `profileFileV1`; import it on a cleared app →
      identical card appears; importing again offers Replace / Keep both.
- [ ] Import the example label pack → the Adaptations screen (Golf simulator, after a module scan)
      shows the imported description for DID `3001`; delete the pack → bundled description returns.
- [ ] A corrupted file shows the validator's first three errors and changes nothing.
- [ ] `npm run ci` green; `registry.test.ts` unchanged assertions pass.

## Out of scope

Downloading packs from a URL (community repo browsing), signing/verifying authorship, exporting
built-in profiles' `extendedPids` decoders (code). Trip/history export is roadmap v0.4.
