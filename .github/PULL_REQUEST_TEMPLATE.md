<!-- Thanks for contributing! See CONTRIBUTING.md. Keep the boxes that apply, delete the rest. -->

## What kind of contribution

- [ ] Vehicle profile
- [ ] Label pack
- [ ] Fault-code (DTC) texts
- [ ] Coding tweak
- [ ] Evidence for existing data (replay fixture or sniffer capture)
- [ ] Code / docs / bug fix

## Car and module

- Car (make, model, year, engine code):
- Module and ECU part number (`F187`, e.g. `03L906022LM`):
- Protocol the adapter negotiated (if known):

## Evidence

- [ ] Replay fixture: `src/shared/obd-core/transport/fixtures/<vehicleId>/<flow>.json`
- [ ] Sniffer capture: `docs/captures/<vehicle>-<flow>-<date>.csv`
- [ ] None yet: the data is badged **illustrative** (`experimental: true`, "illustrative" in the
      comment / notes)

## Checks

- [ ] `npm run ci` is green (includes `npm run validate:contrib`)
- [ ] Docs updated in the same pull request (vehicle doc, feature spec or guide)
- [ ] Simulator data added for every new DID / routine / coding module (`sampleResponse`,
      `sampleCoding`, scenario seeds)
- [ ] No seed/key algorithm, no safety-module writes (airbag, immobilizer, ABS), no cluster-mileage
      DIDs
- [ ] Metric units only; user-visible strings in plain English

## Licence

- [ ] I wrote these texts myself, or they come from an MIT / BSD / public-domain source cited in
      the file header. Nothing is copied from GPL sources (such as python-OBD) or from VCDS label
      files. I release this contribution under the project's MIT licence.
