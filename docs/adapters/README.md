# Adapter compatibility matrix

"Will my adapter work?" answered by real runs of the app's **Adapter health** check. Every report in
[`reports/`](./reports/) is one run on one adapter; a script turns them into the
[**matrix**](./matrix.md), one page per adapter, and the **Known adapters** list bundled into the
app (the "known good" chip on the Connect screen's scan list and the "3 community reports ·
typically GOOD" line on the health screen). Plan: [29](../plans/29-adapter-compatibility-matrix.md).

> There are no reports yet. The first ones come from the owner's Vgate iCar Pro on Android (and on
> iOS and the web once those builds exist); anyone with another adapter can add theirs the same way.

## Add a report

1. Connect the app to your **real** adapter (Bluetooth LE, Wi-Fi or Classic Bluetooth) with the
   ignition on, then open **Info → Adapter health** and tap **Run health check**.
2. Tap **Share JSON (for the compatibility matrix)**. The file is named
   `<slug>__<yyyy-mm-dd>.json`, e.g. `ios-vlink__elm327-v2-2__2026-11-09.json`: the slug is the
   adapter's advertised name plus its firmware (`ATI`), lower-cased with every other character
   turned into `-`. Simulator runs are marked `"link": "mock"` and are refused.
3. Add the file to `docs/adapters/reports/` (for a second run on the same day, add `-2` before
   `.json`), then rebuild:
   ```bash
   npm run adapters:build    # regenerates matrix.md, the adapter pages and knownAdapters.json
   npm run adapters:check    # what CI runs: fails if anything generated is out of date
   ```
4. Commit the report **and** the regenerated files in one pull request.

Never edit `matrix.md`, the `<slug>.md` pages or `src/shared/adapters/knownAdapters.json` by hand:
CI's `adapters:check` step compares them byte for byte with a fresh build (and Prettier skips them,
see `.prettierignore`). Fix a report instead, or delete it, and rebuild.

## What is in a report (schema v1)

| Field          | Content                                                                                                    |
| -------------- | ---------------------------------------------------------------------------------------------------------- |
| `app`          | App version, platform (`android` / `ios` / `web`), OS version                                              |
| `adapter`      | Advertised name, firmware (`ATI`), link (`ble` / `wifi` / `spp` / `web-ble`), BLE service, write mode, MTU |
| `vehicle`      | **Only** the vehicle profile id (a garage car reports its base profile) and the detected protocol          |
| `measurements` | Supply voltage (`ATRV`), every `0100` round-trip time in ms, attempts, min / median / max                  |
| `grade`        | `good` / `ok` / `poor`, whether a clone is suspected, and the notes the health screen showed               |
| `ranAt`        | When the check ran (ISO date and time, UTC)                                                                |

**Privacy.** A report carries no VIN, no location, no phone or adapter identifiers beyond the name
the adapter advertises to everyone nearby. The build script rejects any field not listed above —
at the top level and inside `app`, `adapter`, `vehicle` (only `profileId` and `protocol`),
`measurements`, `measurements.latency` and `grade` — so a hand-edited file cannot add them.

**Unnamed adapters.** A Wi-Fi adapter advertises no name, and a Web Bluetooth or Classic Bluetooth
pick may come without one; the app then shows a stand-in ("Wi-Fi ELM327", "Bluetooth LE adapter",
"Classic Bluetooth adapter"). Those describe the link, not the adapter, so the report writes
`"deviceName": null` (slug `unknown__<firmware>`, grouped by firmware only), the build script
refuses a report that carries a stand-in, and the app never shows such an adapter another adapter's
community grade.

## What the grades mean

The grade is the health check's (see [adapter-health](../features/adapter-health.md)): the median
`0100` latency sets it (CAN: ≤ 50 ms **GOOD**, ≤ 150 ms **OK**, slower **POOR**; K-line and J1850
get 150 / 400 ms), a firmware string that only clones report (`v1.5`, `v2.1`) caps it at **OK**, and
an adapter that does not answer is **POOR**.

## The matrix columns

| Column        | Meaning                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------- |
| Adapter       | Advertised name of the latest report                                                              |
| Firmware      | `ATI` of the latest report (the slug groups by name **and** firmware)                             |
| Link          | Every link the reports used                                                                       |
| Reports       | How many runs                                                                                     |
| Typical grade | The most common grade; a tie goes to the worse grade                                              |
| Median ms     | The median of the reports' median `0100` latencies                                                |
| Protocols     | The vehicle protocols seen                                                                        |
| Platforms     | The app platforms seen                                                                            |
| Page          | The per-adapter page: every report and every note                                                 |
| Guide         | A hand-written guide when one exists (the `EXTRA_DOCS` map in `scripts/build-adapter-matrix.mjs`) |

Rows are sorted by typical grade (good first), then by name. The header names the number of
reports and the date of the latest one — never today's date, so the check is stable.

## How it is built

- `src/shared/adapters/adapterMatrix.ts` — the pure part shared by the app and the script: the
  schema type, `validateAdapterReport`, `adapterSlug`, the grouping and the renderers. The script
  imports it through Node's type stripping (Node ≥ 22.18; CI uses 24).
- `scripts/build-adapter-matrix.mjs [--check] [--reports <dir>] [--out <dir>]` — reads every
  `reports/*.json`, exits 1 with one line per problem for a malformed, wrong-schema or simulator
  report, writes the outputs (removing the page of an adapter that has no reports any more), or with
  `--check` exits 1 when any output differs. `--reports` / `--out` point it at other directories
  (the tests use them).
- `src/shared/adapters/index.ts` — `KNOWN_ADAPTERS`, `matchKnownAdapter(name, firmware?)` (exact
  name match, firmware breaks a tie), `communitySummary`, `knownAdapterChip`.
