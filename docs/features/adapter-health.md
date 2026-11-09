# Feature: adapter-health

A one-tap **adapter health check** that grades your ELM327 so "is my clone junk?" support questions
become a screenshot. It reads the adapter's identity — firmware (`ATI`), supply voltage (`ATRV`),
negotiated protocol (`ATDPN`) — then times a short burst of `0100` commands and turns the whole thing
into a plain **good / ok / poor** grade with human-readable notes.

> Honest scope: this measures how the _adapter_ behaves (firmware string, link voltage, command
> latency), not the health of the car. A fast clone is still graded "ok" — it works, but genuine ELM327
> silicon is rare, so we don't promise flawless. Thresholds are conservative and split CAN vs K-line.

## What it does

- **Firmware (`ATI`)** — the version string. Common inflated clone strings (`v1.5`, `v2.1`) are flagged;
  genuine chips topped out at v1.x years ago.
- **Voltage (`ATRV`)** — the vehicle supply as the adapter sees it. Below ~11.5 V warns of a weak
  battery / ignition off (live readings may drop out).
- **Protocol (`ATDPN`)** — the auto-detected bus, used only to pick the latency budget (CAN is fast;
  K-line / J1850 is slower by design and gets a more forgiving threshold).
- **Latency burst** — ~10 timed `0100` round trips; reports min / median / max ms and how many
  answered. The **median** drives the grade.

## UI

- **AdapterHealthScreen** — a **Run health check** button (requires a connected session) that steps
  through the identity reads and the burst (progress is shown), then displays the grade, the identity
  card, the latency tiles, and the per-check notes. **Share as text** writes a plain-text report to a
  file and opens the OS share sheet (`expo-sharing`; a download on the web) — the pasteable support
  artifact. **Share JSON (for the compatibility matrix)** saves the same run as a structured
  schema-v1 report named `<slug>__<yyyy-mm-dd>.json` (below) to add to
  [`docs/adapters/reports/`](../adapters/README.md).
- **Community line** — under the grade (`testID="adapter-community"`): when the advertised name of
  the adapter the run was made on (`report.context.deviceName`, firmware as the tie-break) is in the
  bundled **Known adapters** list, "Community: 3 community reports · typically GOOD · ~28 ms"; otherwise "No
  community reports for this adapter yet — share the JSON to add one." The list is generated from
  the committed reports, so today it is empty.

## hooks

- `useAdapterHealth()` — runs `runHealthCheck(session.client)` and exposes
  `{ run, share, running, phase, report, sharing }`. Commands are one-off and serialized by the ELM
  client behind whatever the EngineHost poll loop is doing — no extra loop. `share(format)` takes
  `'txt'` (default) or `'json'`.
- `adapterReportContext()` — the JSON report's context, read from the shared stores **when the run
  starts** and kept on the report (`AdapterHealthReport.context`), so a report kept across a
  reconnect never pairs one adapter's measurements with another adapter's name or link:
  `APP_VERSION`, `Platform.OS` / `Platform.Version`, `sessionStore.deviceName`, the active profile's
  registry id (`curatedProfileId` — a garage car reports its base profile, never its local `user:`
  id), `link` = `reportLinkFor(linkStore.kind, platform)` and the negotiated BLE link
  (`linkStore.link`: service, write mode, MTU).

## api (pure)

- `gradeAdapter(input)` → `{ grade, latency, notes, cloneSuspected }` — pure, unit-tested. Latency sets
  the baseline; a clone tell caps an otherwise-"good" adapter at "ok"; a non-answering adapter is
  "poor". `summarizeLatency` computes min / median / max.
- `formatAdapterReport(report)` → the shareable plain-text block. Pure, so it's testable and reused by
  the share flow.
- `runHealthCheck(client, { burst?, onPhase?, shouldStop?, now? })` — the command sequence
  (`version()` / `voltage()` / `protocolNumber()`, then `burst` timed `command('0100')`s, 10 by
  default) graded by `gradeAdapter`. Failed identity reads degrade to "" / null / Unknown; a failed
  `0100` is an attempt without a latency. Driven by the hook and, in tests, by the simulator.
- `buildAdapterReportJson(report, ctx)` → `AdapterReportJson` (schema 1, plan 29):
  `{ schema, app: { version, platform, os? }, adapter: { deviceName, firmware, link, service?,
writeWithoutResponse?, mtu? }, vehicle: { profileId, protocol }, measurements: { voltage,
latenciesMs, attempts, latency }, grade: { grade, cloneSuspected, notes }, ranAt }` (ISO).
  **Privacy:** `vehicle` is only the profile id and the protocol — no VIN, no location.
  `adapter.deviceName` is `reportDeviceName(ctx.deviceName)`: the connect flow's stand-in names
  ("Wi-Fi ELM327", "Bluetooth LE adapter", "Classic Bluetooth adapter" — `PLACEHOLDER_DEVICE_NAMES`)
  name the link, not the adapter, so they are written as null (slug `unknown__<firmware>`) and never
  match another adapter in the Known adapters list.
  `reportLinkFor(kind, platform)`: the simulator (no link kind) → `mock`, Bluetooth LE in a browser →
  `web-ble`, else `ble` / `wifi` / `spp`. The schema type, `validateAdapterReport`, `adapterSlug`
  ("IOS-Vlink" + "ELM327 v2.2" → `ios-vlink__elm327-v2-2`; no name → `unknown__…`) and
  `reportFileName` live in `@/shared/adapters` because the matrix build script shares them.

## Compatibility matrix (plan 29)

- Reports contributed to `docs/adapters/reports/` are aggregated by `npm run adapters:build`
  (`scripts/build-adapter-matrix.mjs`) into [`docs/adapters/matrix.md`](../adapters/matrix.md), one
  page per adapter and `src/shared/adapters/knownAdapters.json` (the in-app **Known adapters** list).
  CI runs `npm run adapters:check`. Simulator (`mock`) and malformed reports are refused. How to
  contribute, the columns and the privacy rules: [docs/adapters/README.md](../adapters/README.md).

## model

- `adapterHealthStore` (Zustand): `running`, `phase`, `report`. Not persisted — a check is a one-off.

## Behavior

- Works in the **simulator** (`ELM327 v2.2` from `ATI`, steady `12.3 V` from `ATRV`, CAN, and
  `0100` answers), so the full run/grade/share flow — text and JSON (`link: "mock"`, which the
  matrix build refuses) — is exercised with no hardware; scripted inputs drive the unit tests.
- Tied to an active session; the grading math itself is hardware-free.

## Acceptance

- A connected session runs the check and yields a grade + latency stats + notes.
- A `v1.5`/`v2.1` firmware string is flagged as a suspected clone and caps the grade at "ok".
- K-line gets a more forgiving latency budget than CAN.
- Sharing produces a plain-text report; unavailable share modules are a safe no-op.
- **Share JSON** produces a schema-v1 report that passes `validateAdapterReport`, with no VIN or GPS
  data; the screen shows the community line for a known adapter and the "No community reports" line
  otherwise.
