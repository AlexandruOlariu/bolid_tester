# Store listing assets

Everything the Google Play and App Store listings need, kept in the repository and checked by CI
([plan 30](../docs/plans/30-store-release-prep.md)). The rollout procedure, go / no-go criteria
and stability targets are in [docs/release.md → Store rollout](../docs/release.md#store-rollout).
Store accounts, uploads and approvals are the owner's; nothing here contacts a store.

```
store/
├── listing/<lang>/          en, ro — the same files in both (checked)
│   ├── title.txt            ≤ 30   Play title / App Store name
│   ├── subtitle.txt         ≤ 30   App Store subtitle
│   ├── short.txt            ≤ 80   Play short description
│   ├── full.txt             ≤ 4000 Play full description / App Store description
│   ├── keywords.txt         ≤ 100  App Store keywords (comma-separated, no spaces after commas)
│   └── whats-new/<ver>.txt  ≤ 500  release notes (Play's limit; App Store allows more)
├── graphics/
│   ├── feature-graphic.svg  hand-editable source (brand green, logo, tagline)
│   ├── feature-graphic.png  1024 × 500, generated from the SVG
│   └── icon-512.png         512 × 512, generated from assets/icon.png
├── screenshots/<set>/<lang>/NN-<screen>.png
│   ├── android/phone        1080 × 2400, 6–8 per language (a release needs ≥ 6)
│   ├── android/tablet-10    1600 × 2560, optional (plan 21 layouts)
│   └── ios/6.7              1290 × 2796, optional until the iOS listing
└── compliance/
    ├── play-data-safety.md  Play Data safety answers, each row citing the code
    └── apple-privacy.md     App Store privacy-label answers, each row citing the code
```

## How each file is produced

| File                               | Made by                                                                                                                                                                    |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `listing/**`                       | Hand-written. English first, Romanian per the [glossary](../docs/i18n.md#romanian-glossary-keep-consistent). Reuses the README "Is / Is not".                              |
| `graphics/feature-graphic.svg`     | Hand-made once (the logo drawing is `src/shared/ui/AppLogo.tsx` scaled 5×). Edit it in any SVG editor.                                                                     |
| `graphics/feature-graphic.png`     | `npm run store:assets` (sharp renders the SVG; flattened, no transparency — Play rejects alpha).                                                                           |
| `graphics/icon-512.png`            | `npm run store:assets` (downscale of `assets/icon.png`).                                                                                                                   |
| `screenshots/android/phone/<lang>` | `scripts/screenshots.sh [en\|ro]` on an emulator: status-bar demo mode, `.maestro/screenshots.yaml` in simulator mode, then a resize to 1080 × 2400 and `--release` check. |
| `screenshots/ios/6.7/<lang>`       | The same flow on an iPhone 15 Pro Max simulator (`OUT=store/screenshots/ios/6.7/<lang>`), an EAS simulator build (plan 09).                                                |
| `compliance/*.md`                  | Hand-written from the code; `storeConfig.test.ts` checks every row cites code that exists.                                                                                 |

### Screenshots, in store order

The flow opens a fresh install, switches the app language (Settings → General → Language), selects
the simulator with the Golf profile and two injected faults (`P2183, P2015`), connects, and opens
each screen by deep link (`bolidtester://<route>`):

1. `01-live` — Live dashboard, engine running
2. `02-faults` — Faults with the two codes and readiness
3. `03-inspection` — Used-car inspection verdict
4. `04-charts` — Charts
5. `05-module-scan` — Module scan (Golf simulator)
6. `06-battery` — Battery & charging (the trip map needs a recorded GPS trip, so Battery takes the slot)
7. `07-maintenance` — Maintenance log
8. `08-connect` — Connect screen in Bluetooth mode with the first-run card

Needs Maestro and an emulator with a release / preview build installed
([docs/testing.md → End-to-end](../docs/testing.md)); no car and no adapter.

## Checks

```bash
npm run check:store          # every push (CI verify): text limits, EN = RO files, graphic sizes,
                             # every screenshot in a <set>/<lang>/ folder and at its set's
                             # size (PNG headers only)
npm run store:release-check  # before an upload: also ≥ 6 phone screenshots per language
npm run store:assets         # regenerate the graphics, resize screenshots, then check
```

The rules (limits, sizes, minimums) live in `src/shared/lib/storeAssets.ts`; `storeAssets.test.ts`
runs them over this tree in `npm test` too.

## Listing settings (Play Console / App Store Connect)

| Setting               | Play                                                                                                         | App Store                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| App id                | `com.bolidtester.app`                                                                                        | bundle id `com.bolidtester.app`; App Store id → `expo.extra.appStoreId` (enables **Rate this app** on iOS) |
| Category              | Auto & Vehicles                                                                                              | Utilities (secondary: Productivity)                                                                        |
| Content rating        | IARC questionnaire → Everyone (no violence, no user content, no gambling, no location sharing between users) | 4+                                                                                                         |
| Target audience       | 18+ (keeps the app out of the Families policy; nothing is age-gated)                                         | —                                                                                                          |
| Ads                   | No ads                                                                                                       | —                                                                                                          |
| Price                 | Free                                                                                                         | Free                                                                                                       |
| Privacy policy URL    | https://github.com/AlexandruOlariu/bolid_tester/blob/HEAD/docs/privacy-policy.md                             | same                                                                                                       |
| Support URL / e-mail  | https://github.com/AlexandruOlariu/bolid_tester/issues                                                       | same                                                                                                       |
| Data safety / privacy | [compliance/play-data-safety.md](./compliance/play-data-safety.md)                                           | [compliance/apple-privacy.md](./compliance/apple-privacy.md)                                               |
| Languages             | English (default), Romanian                                                                                  | English (primary), Romanian                                                                                |

### Review notes (both stores)

> Bolid Tester is an OBD2 car diagnostics app. Full functionality needs an ELM327-compatible
> Bluetooth LE OBD2 adapter plugged into a car. To review without one, use the built-in simulator:
> **Settings → Developer & simulator → Simulator (no car)**, then **Connect → Connect to simulator**.
> Every screen then works with simulated data (a banner shows the simulator is on). No login is
> needed. Location is used only while recording a trip with GPS; Bluetooth only to reach the adapter.

Play "App access": _All functionality is available without special access_ + the notes above.
App Store: the notes above plus a ~20-second screen recording of a real Bluetooth connection (owner,
on the Golf — plan 30 owner actions).

## Badges (README "Get the app")

Store badges in the root README stay placeholders until the listings are live; then link them to
`https://play.google.com/store/apps/details?id=com.bolidtester.app` and
`https://apps.apple.com/app/id<appStoreId>` (`src/shared/lib/storeLinks.ts` builds the same URLs).
