# Implementation plans — handoff guide

> These plans are written so that **another engineer or coding agent can pick any one up cold** and
> ship it without re-deriving the design. Each plan names the exact files to read, the exact files to
> create or change, the types and signatures, the simulator changes, the tests to write, the docs to
> update, and the acceptance checks. The product rationale is in [`../audit-2026-11.md`](../audit-2026-11.md)
> and [`../roadmap.md`](../roadmap.md). **Every roadmap item from v0.2 to v1.0 has a plan here.**

## Two decisions every plan assumes

1. **Nothing blocks on the car.** All code, simulator scenarios, tests and docs land without real
   hardware. Anything that needs the Golf / Punto / Passat, a VCDS session, an iPhone or a store
   account sits under a final section titled **"Deferred until an on-car session"** (or "Owner
   actions") with a precise procedure, so the owner can do it later and the agent knows exactly what
   to do with the results. A plan is complete when everything above that section is shipped.
2. **Metric only.** No imperial units anywhere; the dead conversion path is deleted in plan 07.

## Start of every session

1. Read `CLAUDE.md`, then orient with the context graph (never grep broadly first):
   ```bash
   # Windows: PYTHONIOENCODING=utf-8 avoids cp1250 encode errors on arrows/emoji in summaries
   PYTHONIOENCODING=utf-8 python .claude/skills/bolid-context/scripts/graph.py context <term>
   PYTHONIOENCODING=utf-8 python .claude/skills/bolid-context/scripts/graph.py find <term>
   ```
2. Confirm the baseline is green before touching anything (takes ~1 min):
   ```bash
   npm run ci          # typecheck (core) + typecheck:app + lint + jest — 504 tests / 71 suites today
   ```
3. Open the plan, read its **Read first** list in full, then work the **Steps** in order.

## Execution order

Work in waves; plans inside a wave are independent and can run on parallel branches. A plan's
"Depends on" column names the plans whose code it builds on.

### Wave 1 — foundations (all independent)

| #   | Plan                                                          | Depends on | Deferred / owner part                                |
| --- | ------------------------------------------------------------- | ---------- | ---------------------------------------------------- |
| 01  | [Production first-run](./01-production-first-run.md)          | —          | —                                                    |
| 03  | [Sniffer save & share](./03-sniffer-capture.md)               | —          | VCDS + Y-splitter recording session                  |
| 05  | [DTC database + detail sheet](./05-dtc-database.md)           | —          | —                                                    |
| 08  | [Signed release, versioning, OTA](./08-signed-release-ota.md) | —          | Keystore, four GitHub secrets, Expo account          |
| 10  | [Component + e2e tests](./10-component-e2e-tests.md)          | —          | —                                                    |
| 12  | [BLE robustness + diagnostics](./12-ble-robustness.md)        | 01         | Confirming drop / wake behaviour on the real adapter |

### Wave 2 — data, workshop prep, reports

| #   | Plan                                                                          | Depends on        | Deferred / owner part                                  |
| --- | ----------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------ |
| 02  | [Fixture pipeline now, on-car validation later](./02-on-car-validation.md)    | 01                | Driving the three cars; exporting one fixture per flow |
| 04  | [Doc debt zero](./04-doc-debt.md)                                             | 01, 03            | —                                                      |
| 06  | [Garage + learned profiles](./06-garage-learned-profiles.md)                  | 05                | —                                                      |
| 13  | [Profile & label-pack import/export](./13-profile-labelpack-import-export.md) | 06, 25 (optional) | —                                                      |
| 14  | [Mode 22 charts + measuring groups](./14-mode22-charts-measuring-groups.md)   | —                 | KWP `21` groups ride on TP2.0 (deferred)               |
| 15  | [Unified vehicle report](./15-unified-vehicle-report.md)                      | 05, 06            | —                                                      |
| 17  | [Trip detail map](./17-trip-detail-map.md)                                    | —                 | One real GPS trip to eyeball the track                 |
| 18  | [Backup & restore](./18-backup-restore.md)                                    | 06                | —                                                      |
| 19  | [AI provider presets + multi-turn](./19-ai-provider-presets.md)               | —                 | Cloud API keys (optional)                              |
| 22  | [KWP login UI + code book](./22-kwp-login-code-book.md)                       | 06                | Real login codes                                       |
| 23  | [Security-access plugins](./23-security-access-plugins.md)                    | 13, 06            | Algorithm files (never shipped)                        |
| 24  | [Adaptation restore](./24-adaptation-restore.md)                              | —                 | —                                                      |
| 25  | [Post-capture confirmation](./25-post-capture-confirmation.md)                | 02, 03            | Sniffer captures from the Golf                         |

### Wave 3 — IA, transports, polish

| #   | Plan                                                                       | Depends on                      | Deferred / owner part             |
| --- | -------------------------------------------------------------------------- | ------------------------------- | --------------------------------- |
| 07  | [Information architecture + metric only](./07-information-architecture.md) | 04, 06                          | —                                 |
| 16  | [Per-car timeline](./16-per-car-timeline.md)                               | 15, 06                          | —                                 |
| 20  | [Accessibility pass](./20-accessibility-pass.md)                           | 10 (harness; can start without) | —                                 |
| 21  | [Tablet layout](./21-tablet-layout.md)                                     | 07                              | A tablet to verify                |
| 26  | [Wi-Fi TCP transport](./26-wifi-tcp-transport.md)                          | 12                              | A Wi-Fi ELM327 to verify          |
| 27  | [Classic Bluetooth SPP transport](./27-bluetooth-spp-transport.md)         | 12, 26                          | An SPP adapter to verify          |
| 28  | [Web Bluetooth PWA](./28-web-bluetooth-pwa.md)                             | 12, 26                          | —                                 |
| 29  | [Adapter compatibility matrix](./29-adapter-compatibility-matrix.md)       | —                               | Adapter reports from real devices |
| 32  | [Feedback / log bundle](./32-feedback-log-bundle.md)                       | 18 (optional)                   | —                                 |

### Wave 4 — platforms, languages, release

| #   | Plan                                                          | Depends on             | Deferred / owner part                  |
| --- | ------------------------------------------------------------- | ---------------------- | -------------------------------------- |
| 09  | [iOS via EAS](./09-ios-eas.md)                                | 08                     | Apple Developer account, a test iPhone |
| 11  | [Localization EN + RO](./11-i18n.md)                          | 07                     | Review of Romanian copy                |
| 31  | [Opt-in crash reporting](./31-opt-in-crash-reporting.md)      | 08, 32                 | Vendor account if a vendor is chosen   |
| 30  | [Store release prep](./30-store-release-prep.md)              | 08, 09, 10, 11, 31, 32 | Store accounts, listing approval       |
| 33  | [Community contribution flow](./33-community-contribution.md) | 02, 03, 05, 13         | —                                      |

## Repo rules the plans assume

- **Docs first.** Specs live in `docs/features/<slug>.md` and map 1:1 to `src/features/<slug>`
  (aliases: `inspection` → `used-car-inspection.md`, `maintenance` → `maintenance-log.md`). Change
  the spec in the same change as the code. Vehicle docs are checked by `vehicle-docs-sync.test.ts`.
- **Simulator first.** Any new command the app sends must be answered by `MockTransport`
  (`src/shared/obd-core/transport/MockTransport.ts`) and covered by a test before it goes near a car.
- **Layering.** `src/shared/obd-core` has no React Native imports and is typechecked by
  `tsconfig.json` (core) — keep it pure. Features import only `@/shared/*`; the single exception is
  `features/engine-host`, which composes several feature stores. New cross-feature needs go through
  a shared store or EngineHost, never feature → feature.
- **Persistence.** Durable stores use `zustand/persist` with `fileStateStorage` from
  `src/shared/state/persistStorage.ts`, a `name` of the form `bolid.<area>`, an explicit `version`,
  and a `migrate`/`merge` when the shape changes. Never persist secrets outside `secureApiKey.ts`.
- **Errors.** Recoverable failures go through `logError({ source, error, severity?, context? })`
  from `src/shared/state/errorLogStore.ts`; never `console.*`.
- **Native modules** that may be absent in tests are imported with a variable specifier
  (`await import('expo-sharing' as string)`) — copy the pattern in
  `src/features/error-log/hooks/useErrorLogExport.ts`.
- **Writes to the car** stay gated: backup → write → verify, `resetAddressing()` in `finally`,
  interlocks fail closed, never immobilizer / airbag / cluster-mileage. Never ship a seed/key.
- **Style.** `npm run format` (Prettier) before committing; `eslint` must be 0; no `any`, no TODOs.
- **Commits.** Imperative subject (`feat: …`, `fix: …`, `docs: …`, `test: …`), one logical change
  each. Append an entry to `docs/implementation-log.md` (newest first) when a plan lands, and flip
  its item in `docs/roadmap.md` to ✅. Do not commit `android/` (gitignored), keystores, or `.env`.
- **Windows.** The shell is PowerShell; Git Bash is available. Gradle builds need the junction trick
  in `.claude/skills/android-apk/SKILL.md`. Jest and tsc run fine natively.

## Definition of done (every plan)

- [ ] Everything above the plan's "Deferred" section is shipped: code + tests + docs in the same
      change; `npm run ci` green locally.
- [ ] New simulator behaviour has a unit or integration test that fails without the change.
- [ ] Every user-visible string is plain English, no jargon without expansion (i18n lands in plan 11).
- [ ] `docs/implementation-log.md` entry written; `docs/roadmap.md` status flipped (✅ for the shipped
      part, with "on-car pending" noted where a deferred section remains).
- [ ] Context graph rebuilt (`graph.py build`) when files or docs were added; `curated.json` gets a
      concept only for durable domain knowledge, not for plumbing.
- [ ] The plan's own **Acceptance** checklist is ticked in the PR description.

## Things only the owner can do (collect early, none block the code)

- Drive the three reference cars with the Vgate adapter and export fixtures (plan 02); later, run a
  VCDS session through an OBD2 Y-splitter while the sniffer records (plans 03, 25).
- Generate and safely store the Android release keystore; add the four GitHub secrets (plan 08).
- Create the Expo (EAS) project, the Apple Developer account and the store accounts (plans 08, 09, 30).
- Review Romanian translations (plan 11).
- Optionally: a Wi-Fi and an SPP ELM327 adapter and a tablet to verify plans 26, 27, 21.
