# Contributing data — guides

Step-by-step guides for the data a pull request can add. Start with the root
[CONTRIBUTING.md](../../CONTRIBUTING.md): what goes where, ground rules, evidence levels
(illustrative → observed → confirmed), licensing, the checks (`npm run validate:contrib`) and the
maintainer review checklist.

| Guide                                      | Adds                                                                    |
| ------------------------------------------ | ----------------------------------------------------------------------- |
| [vehicle-profile.md](./vehicle-profile.md) | A registry car: `docs/vehicles/<id>.md` + `src/shared/vehicles/<id>.ts` |
| [label-pack.md](./label-pack.md)           | Names for a module family's measurements, coding bits and adaptations   |
| [dtc-texts.md](./dtc-texts.md)             | Fault-code descriptions in the DTC database                             |
| [coding-tweak.md](./coding-tweak.md)       | A one-tap, reversible coding preset on a vehicle profile                |

Evidence that promotes data from illustrative to confirmed: replay fixtures
([testing.md → Recording results](../testing.md#recording-results)) and sniffer captures
([captures/README.md](../captures/README.md)). Adapter reports have their own flow:
[adapters/README.md](../adapters/README.md).
