# Plan 33 — Community contribution flow

**Size:** M (1 day) · **Depends on:** plan 02 (fixture format), plan 03 (sniffer captures),
plan 05 (DTC database layout), plan 13 (JSON schemas for profiles / label packs, if landed —
otherwise this plan defines minimal schemas) · **Roadmap:** v1.0 "Community data"

## Goal

Anyone can contribute a vehicle profile, a label pack, DTC texts or a coding tweak through a PR
that CI validates mechanically (format, duplicates, docs sync, licence hygiene) and that a
maintainer reviews against a short checklist. Experimental data is accepted as **illustrative**;
promotion to **confirmed** requires on-car evidence (a replay fixture or a sniffer capture).

## Why

The vehicle registry (`docs/vehicles/README.md`, `src/shared/vehicles/*`, `vehicle-docs-sync.test.ts`),
label packs (`src/shared/labels/packs/*.ts`, registry with longest-prefix matching) and coding
presets (`src/shared/obd-core/coding/presets.ts` `CodingPreset`) are already "data, not code" by
design, but there is no `CONTRIBUTING.md`, no PR template, no `LICENSE` file at the repo root
(only `"license": "MIT"` in `package.json`), no issue templates, and no validation beyond the
docs-sync test. `.github/` holds only `workflows/ci.yml`.

## Read first

- `docs/vehicles/README.md` (schema + "How to add a vehicle"), `src/shared/vehicles/{types.ts, index.ts, vehicle-docs-sync.test.ts}`.
- `src/shared/labels/{types.ts, registry.ts, registry.test.ts, packs/vagEdc17Golf.ts, packs/vagBcmPq35.ts}`.
- `src/shared/obd-core/coding/presets.ts` (`CodingPreset`, `CodingPresetEdit`, `applyPreset`,
  `revertPreset`, `detectPresetState`) and `presets.test.ts`.
- `src/shared/obd-core/obd/dtcDatabase/` (plan 05) or, before it lands, `obd/dtc.ts` `DTC_DICTIONARY`
  and `uds/vagDtcs.ts`.
- `.github/workflows/ci.yml` `verify` job; `package.json` scripts; `docs/plans/02-on-car-validation.md`
  (fixture `meta`/`expect`), `docs/plans/03-sniffer-capture.md` (capture CSV header).

## Design

### Repository files

| File                                                                                       | Content                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LICENSE`                                                                                  | MIT, copyright the owner, 2026.                                                                                                                                                                                                                                                                                                                                           |
| `CONTRIBUTING.md`                                                                          | Sections below.                                                                                                                                                                                                                                                                                                                                                           |
| `.github/PULL_REQUEST_TEMPLATE.md`                                                         | Checklist: what kind of contribution (profile / label pack / DTC texts / tweak / code), car + ECU part number, evidence (fixture path / capture path / "illustrative"), `npm run ci` green, docs updated, licence attestation ("I wrote these texts myself or they come from an MIT/BSD/public-domain source cited in the file header; nothing copied from GPL sources"). |
| `.github/ISSUE_TEMPLATE/vehicle-request.yml`, `bug-report.yml`, `data-correction.yml`      | Forms; the bug form asks for the plan 32 bundle.                                                                                                                                                                                                                                                                                                                          |
| `docs/contributing/vehicle-profile.md`, `label-pack.md`, `dtc-texts.md`, `coding-tweak.md` | Step-by-step guides (below).                                                                                                                                                                                                                                                                                                                                              |
| `scripts/validate-contrib.mjs`                                                             | The validator (below), run in CI `verify` after tests.                                                                                                                                                                                                                                                                                                                    |

### `CONTRIBUTING.md` outline

1. What you can contribute and where it lives (table: data type → folder → spec → test).
2. Ground rules: docs first; simulator first (every new DID/routine needs `sampleResponse` /
   simulator seeds); honesty badges (`experimental: true`, `illustrative` in notes) until confirmed;
   never writes to safety modules; never ship a seed/key algorithm.
3. Evidence levels: **illustrative** (no evidence, badged) → **observed** (a replay fixture under
   `src/shared/obd-core/transport/fixtures/<vehicleId>/` with `meta` + `expect`, or a sniffer CSV
   under `docs/captures/<vehicleId>/`) → **confirmed** (fixture asserted in CI and the vehicle doc's
   "Validated on" table filled). Promotion happens in the same PR that adds the evidence.
4. Licensing: contributions are MIT; DTC/label texts must be authored or come from a verified
   MIT/BSD/public-domain source cited in the file header; **python-OBD and other GPL code lists are
   off-limits** (same rule as plan 05); VCDS label files are proprietary — never copy them.
5. How to run checks locally: `npm run ci`, `node scripts/validate-contrib.mjs`.
6. Review checklist for maintainers (below).

### Guides (one page each)

- **Vehicle profile:** copy `docs/vehicles/fiat-punto-2008-12.md`, fill front-matter (`id`,
  `name`, `expectedProtocol`, `supportedPidCount`, `extended`, optional `vin`, `engineCode`,
  `make`, `observedProtocol`, `validatedOn`), add `src/shared/vehicles/<id>.ts`, register in
  `index.ts`, run `npm test -- vehicle-docs-sync`. Explain `knownFaults`, `vinPatterns`, and that
  user-learned profiles (plan 06) can be exported as JSON and turned into a registry profile by a
  maintainer.
- **Label pack:** `src/shared/labels/packs/<make>-<module>-<partPrefix>.ts` exporting a `LabelPack`
  (`id` = `<make>-<module>-<partPrefix>` lower-case, `partNumberPrefixes` without spaces, DID keys
  upper-case 4 hex), register in `registry.ts` `LABEL_PACKS`, add a `registry.test.ts` case.
- **DTC texts:** which file by family (`generic/p0.ts` …, `manufacturer/vag.ts`, `fiat.ts`), one
  code per line, canonical wording, no duplicates, cite source.
- **Coding tweak:** add to the profile's `codingPresets` with `reversible: true`, `edits` that
  reference an existing `codingModules` entry by `reqHeader`, simulator `sampleCoding` showing both
  states, a `presets.integration.test.ts` case, and the honest `description`.

### `scripts/validate-contrib.mjs`

Node ESM, no deps beyond `fs`/`path` (and `typescript` already in devDeps for parsing TS data
files via `ts.transpileModule` + `vm`, or simpler: `npx tsx`-free approach — compile the data
modules with `ts.transpileModule` and evaluate in a `vm` sandbox). Checks:

1. **Vehicle docs**: every `docs/vehicles/*.md` (except README) has front-matter with the required
   keys; `id` equals file name; `expectedProtocol` is a known `ProtocolId` (import the list from
   `src/shared/obd-core/obd/protocols.ts` via transpile); if `validatedOn` present, the "Validated
   on the car" table exists and `observedProtocol` is present.
2. **Fixtures**: every `fixtures/**/*.json` parses, has `pairs`, `meta.vehicleId` matching a doc,
   `meta.flow` non-empty, and ≤ 200 KB.
3. **Label packs**: ids unique; `partNumberPrefixes` unique across packs (warn on overlap, error on
   identical); DID keys `/^[0-9A-F]{4}$/`; `name` non-empty; every pack registered in `LABEL_PACKS`.
4. **DTC database** (plan 05 layout): keys `/^[PCBU][0-9A-F]{4}$/`, unique across all files, no
   empty descriptions, file header contains `License:` line; `vagDtcs` keys 5 digits.
5. **Captures**: `docs/captures/**/*.csv` first line starts with `# vehicle:`.
6. **Licence hygiene**: grep contributed data files for `GPL`, `python-obd`, `pyOBD` → error.

Exit code 1 with a grouped report. Add `"validate:contrib": "node scripts/validate-contrib.mjs"`
to `package.json` and a CI step after `npm test`. Unit-test the pure checkers by moving them into
`scripts/lib/contribChecks.mjs` and adding `scripts/__tests__/contribChecks.test.mjs`? Jest is
configured for `src/` only — instead keep them in `src/shared/lib/contribChecks.ts` (core
tsconfig, tested with `contribChecks.test.ts`) and have the script import the transpiled module
the same way it loads the data files.

### Maintainer review checklist (in `CONTRIBUTING.md`)

- [ ] Evidence level matches the badges in code and docs.
- [ ] No seed/key, no safety-module addresses, no cluster-mileage DIDs.
- [ ] Texts authored / licence cited; no VCDS label-file wording.
- [ ] Simulator seeds present; `npm run ci` and `validate:contrib` green.
- [ ] Vehicle doc "Validated on" table consistent with fixtures.
- [ ] Changelog line in `docs/implementation-log.md` ("Community: …").

## Steps

1. `LICENSE`, `CONTRIBUTING.md`, PR template, issue forms, four guides.
2. `src/shared/lib/contribChecks.ts` + test; `scripts/validate-contrib.mjs`; `package.json`
   script; CI step.
3. Run it against the current repo and fix findings (expect: label-pack ids fine; fixtures none;
   DTC headers missing `License:` until plan 05 adds them — the check is conditional on the
   `dtcDatabase/` directory existing).
4. `docs/README.md` index row for `contributing/`; root README "Contributing" section; `npm run ci`.

## Tests

- `contribChecks.test.ts`: front-matter parser (reuse the regex from `vehicle-docs-sync.test.ts`);
  duplicate DID/code detection; prefix overlap warning vs identical error; fixture size/keys;
  licence-string grep; a fixture `meta.vehicleId` without a doc fails.
- Existing `vehicle-docs-sync.test.ts` and `registry.test.ts` unchanged.

## Docs

- `CONTRIBUTING.md`, `docs/contributing/*.md`, `docs/vehicles/README.md` (link to the guide,
  evidence levels), `docs/features/adaptations.md` § label packs (link), `docs/release.md`
  (contrib checks are part of `verify`).

## Acceptance

- [ ] `node scripts/validate-contrib.mjs` passes on `main`; introducing a duplicate DTC key or a
      second pack with an identical prefix fails it with a readable message.
- [ ] CI `verify` runs the validator; the PR template appears on a new PR.
- [ ] A dry-run contribution following `docs/contributing/label-pack.md` (e.g. a Passat EDC15
      pack with two measurement labels, badged illustrative) passes all checks and the registry test.
- [ ] `LICENSE` present; root README links `CONTRIBUTING.md`.

## Out of scope

In-app import of community profiles/packs (roadmap v0.3 "Profile import / export" + plan 13);
a web catalogue of contributions.
