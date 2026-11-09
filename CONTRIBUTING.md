# Contributing to Bolid Tester

Thanks for helping. Most of what makes this app useful for a particular car is **data, not code**:
a vehicle profile, a label pack, fault-code texts or a coding tweak. You can add any of them in a
pull request. CI checks the format mechanically, and a maintainer reviews the rest against the
checklist at the end of this page.

The docs in [`docs/`](./docs/README.md) are the source of truth: change the doc and the code in the
same pull request.

## 1. What you can contribute and where it lives

| Contribution               | Folder                                                        | Spec / guide                                                                                                | Checked by                                       |
| -------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Vehicle profile            | `docs/vehicles/<id>.md` + `src/shared/vehicles/<id>.ts`       | [docs/contributing/vehicle-profile.md](./docs/contributing/vehicle-profile.md)                              | `vehicle-docs-sync.test.ts`, `validate:contrib`  |
| Label pack                 | `src/shared/labels/packs/*.ts`                                | [docs/contributing/label-pack.md](./docs/contributing/label-pack.md)                                        | `registry.test.ts`, `validate:contrib`           |
| Fault-code (DTC) texts     | `src/shared/obd-core/obd/dtcDatabase/{generic,manufacturer}/` | [docs/contributing/dtc-texts.md](./docs/contributing/dtc-texts.md)                                          | `dtcDatabase.test.ts`, `validate:contrib`        |
| Coding tweak               | `codingPresets` in the vehicle profile                        | [docs/contributing/coding-tweak.md](./docs/contributing/coding-tweak.md)                                    | `presets.integration.test.ts`, `presets.test.ts` |
| Replay fixture (evidence)  | `src/shared/obd-core/transport/fixtures/<id>/`                | [docs/testing.md → Recording results](./docs/testing.md#recording-results)                                  | `fixtures.replay.test.ts`, `validate:contrib`    |
| Sniffer capture (evidence) | `docs/captures/<id>-<flow>-<date>.csv`                        | [docs/captures/README.md](./docs/captures/README.md)                                                        | `validate:contrib`                               |
| Adapter report             | `docs/adapters/reports/*.json`                                | [docs/adapters/README.md](./docs/adapters/README.md)                                                        | `adapters:check`                                 |
| Code, docs, bug fixes      | anywhere                                                      | [docs/architecture.md](./docs/architecture.md), [docs/plans/README.md](./docs/plans/README.md) (repo rules) | `npm run ci`                                     |

Not sure where something goes? Open an issue first: **Vehicle request**, **Bug report** or **Data
correction** (the forms ask for what we need).

## 2. Ground rules

- **Docs first.** A vehicle doc, a feature spec or a guide changes in the same pull request as the
  code it describes.
- **Simulator first.** Every new DID, routine or coding module needs simulator data so it can be
  exercised without a car: `sampleResponse` on an extended PID, `sampleCoding` on a coding module,
  seeds in `src/shared/obd-core/transport/scenarios.ts` where the profile alone is not enough. A
  test proves it before it goes near a car.
- **Honesty badges.** Per-car data is `experimental: true` and its comment or note says
  **illustrative** until it is confirmed (section 3). The app shows an amber "Illustrative — not
  yet confirmed on this car" badge for it; do not remove that until the evidence is in the
  repository.
- **Never write to safety modules.** No airbag, immobilizer, ABS write or cluster-mileage DIDs, and
  no coding module, adaptation or routine that targets them.
- **Never ship a seed/key algorithm.** Security access is a user-installed plugin
  ([coding → Security-access plugins](./docs/features/coding.md#security-access-plugins-plan-23));
  `noSeedKeys.test.ts` fails if a profile carries one.
- **Metric units only** (°C, km, km/h, kPa, bar, L, kg). No imperial units anywhere.
- **Plain English** in every user-visible string; expand jargon the first time.

## 3. Evidence levels

| Level            | What it means                                                                                                                                                                                                                                                      | How it shows                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| **Illustrative** | No evidence yet. Welcome, as long as it is marked.                                                                                                                                                                                                                 | `experimental: true`, "illustrative" in the comment / notes; amber badge in app |
| **Observed**     | Evidence is committed: a replay fixture under `src/shared/obd-core/transport/fixtures/<vehicleId>/` with `meta` and `expect` ([testing.md](./docs/testing.md#recording-results)), or a sniffer CSV under `docs/captures/` ([captures](./docs/captures/README.md)). | The item's `confirmed` names the fixture or capture                             |
| **Confirmed**    | The fixture is asserted in CI (`fixtures.replay.test.ts`) and the vehicle doc's "Validated on the car" table lists it, with `validatedOn` / `observedProtocol` filled.                                                                                             | Blue "Confirmed <date> (<source>)" badge                                        |

**Promotion happens in the same pull request that adds the evidence.** Set `confirmed: { on,
source, fixture, note }` on the item ([vehicles → `confirmed`](./docs/vehicles/README.md#confirmed--evidence-that-an-item-was-checked-on-the-car));
the sync test fails if `fixture` names a file that is not committed. Confirmation is always a
reviewed, hand-made edit: no tool promotes data by itself.

## 4. Licensing

- The project is [MIT](./LICENSE). By opening a pull request you agree your contribution is
  released under the same licence.
- **Fault-code and label texts must be your own words**, or come from a source that is verifiably
  MIT, BSD or public domain, **cited in the file header** with its URL and licence. Every DTC data
  file carries a `License:` line in its header (the validator checks it).
- **GPL code lists are off-limits.** python-OBD's `codes.py` (GPL-2), pyOBD and any other GPL /
  LGPL / AGPL list must not be copied, adapted or named as a source. The validator fails a data
  file that names one as its `Source:` / `License:` or carries it in its data.
- **VCDS label files are proprietary.** Never copy names, groupings or wording from `.lbl` / `.clb`
  files or from VCDS screens. Write labels from your own captures.
- Shareable JSON label packs follow the same rules
  ([exchange-formats → Licensing community packs](./docs/exchange-formats.md#licensing-community-packs)).

## 5. Run the checks locally

```bash
npm install --legacy-peer-deps
npm run ci                          # typechecks, lint, release checks, all tests, contribution checks
node scripts/validate-contrib.mjs   # only the contribution checks (= npm run validate:contrib)
npm test -- vehicle-docs-sync       # one test file by name
npm run format                      # Prettier, before you commit
```

`validate-contrib` checks, and exits 1 with a grouped report when one fails:

1. **Vehicle docs**: front-matter keys (`id`, `name`, `expectedProtocol`, `supportedPidCount`,
   `extended`), `id` equals the file name, the protocol is a known one, the "Validated on the car"
   rules.
2. **Replay fixtures**: valid JSON, a `pairs` object, `meta.vehicleId` names a vehicle doc (or
   `generic`) and its folder, `meta.flow` is set, at most 200 KB.
3. **Label packs**: ids unique; a part-number prefix used by two packs is an error (one prefix
   inside another is a warning: the longer one wins); DID keys are four upper-case hex digits;
   names are not empty; measuring groups have at most four DIDs; every pack is registered in
   `LABEL_PACKS`.
4. **DTC database**: keys like `P0101` (VAG native tables: five digits), no code in two files, no
   empty description, a `License:` line in every file header.
5. **Sniffer captures**: the CSV header has `# vehicle: <registry id>`.
6. **Licence hygiene**: no GPL / python-OBD / pyOBD as a source or in the data of a profile, pack or
   DTC file.

## 6. Review checklist for maintainers

- [ ] Evidence level matches the badges in code and docs (`experimental`, "illustrative",
      `confirmed`).
- [ ] No seed/key, no safety-module addresses (airbag, immobilizer, ABS writes), no cluster-mileage
      DIDs.
- [ ] Texts authored or licence cited in the file header; no VCDS label-file wording; nothing from
      GPL sources.
- [ ] Simulator seeds present (`sampleResponse`, `sampleCoding`, scenario seeds); `npm run ci` and
      `npm run validate:contrib` green.
- [ ] Vehicle doc "Validated on the car" table consistent with the committed fixtures.
- [ ] Metric units only; user-visible strings in plain English.
- [ ] Changelog line in `docs/implementation-log.md` ("Community: …").
