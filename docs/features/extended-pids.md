# Feature: extended-pids (experimental, flagged)

Profile-driven **manufacturer-specific** reads via **Mode 22** (UDS `readDataByIdentifier`). **VAG is
the first example.** This is opt-in and clearly marked experimental.

> ⚠️ **Experimental.** Manufacturer DIDs are **not standardized**. The example DIDs shipped in the
> profiles are **illustrative** and must be **confirmed on the real car** before the values are
> trusted. The simulator returns canned values so the feature can be exercised end-to-end without
> hardware.

## Applicability

- Only **CAN/UDS-capable** cars can answer Mode 22. In our examples that means the **Golf Plus 2009**.
- The **Passat B5.5** and older **Punto** are **K-line/KWP2000** — Mode 22 does **not** apply; their
  profiles declare no extended PIDs. (Genuine VAG extra data there needs VCDS-style measuring blocks,
  which a generic ELM327 cannot read.)

## UI

- **ExtendedPidsScreen** — only shown when the active profile declares `extendedPids` **and** the link
  is CAN. Each row: a **select toggle** (for logging), name, value, a **verification badge** (`VerificationBadge`, plan 25): green "Standard OBD2", blue "Confirmed <date> (<source>)" once the profile item carries `confirmed` evidence, amber "Illustrative — not yet confirmed on this car" otherwise, and the
  raw DID + response.
- **Measuring-block log** card — start/stop a recording of the selected DIDs over time (see below).
- Arriving from a fault-code **Guide** deep-link (`/extended?dids=1708,1701`) pre-selects and reads
  those DIDs, and highlights their rows ("from guide"). See [fault-codes](./fault-codes.md).

## Measuring-block logging (6b.6)

VCDS's "Log" button for module DIDs. While on the screen, tick the DIDs to record, press **Start
log**, and the app samples the selected DIDs once per second, buffering `{t, did, name, value, unit}`
rows at **module scope** (`api/measuringLog.ts`) so a long recording never re-renders the list — only
a small sweep counter updates. **Stop & share CSV** writes the log to `documentDirectory` and opens
the OS share sheet via the same dependency-tolerant `expo-file-system` / `expo-sharing` pattern the
DTC export and trip recorder use.

- **CSV columns:** `timestamp_iso, epoch_ms, did, name, value, unit`. Rows are sorted by time then
  DID; a null value (no data that sweep) is an empty field. The builder (`buildMeasuringLogCsv`) is
  pure and unit-tested.
- Recording ends on **Stop**, on screen unmount, or when the session drops (disconnect).
- The log keeps its own 1 s sweep, independent of the app-wide poll loop; both may run at once
  (the ELM queue serialises them).

## Live values (plan 14)

While the screen is **focused** on a supported link, `useExtendedPids` registers every declared DID
as a live key `22:<DID>` on the shared `liveDataStore` (`acquire`, `src/shared/state/liveDataStore.ts`
— no feature → feature import), so the app-wide poll loop in
[engine-host](./engine-host.md#split-sweep-mode-01--mode-22) reads them every sweep and the values
update without pressing anything. The registration is released on blur (`useIsFocused`): hidden
Tabs routes stay mounted, and sequential Mode 22 reads of every declared DID (15 on the Golf) would
otherwise slow Mode 01 refresh app-wide for the rest of the session. Chart panels register their
own keys, so a charted DID keeps plotting. **Read extended PIDs** stays as the one-shot read of
every DID that also shows the raw reply. A row shows the freshest value: the measuring log's sweep
**while logging** (a stopped log never freezes a card; `latest` is cleared on stop), else the live
value, else the one-shot read.

## Chart this

Each DID row has **Chart this**: it adds a chart panel `{ id: 'p<n>', pids: ['22:<DID>'],
windowMs: 60 000 }` to the shared panel store (`src/shared/state/chartsStore.ts`) and opens
[Charts](./live-charts.md). The panel keeps plotting after leaving this screen, because the chart
registers its own keys.

## Measuring groups

VCDS users think in numbered groups of up to four values. A label pack can declare
`measuringGroups` (see [adaptations → label packs](./adaptations.md#label-packs-srcsharedlabels));
the screen shows a **Measuring groups** section at the top with one card per group: the group
number, name, description, an "illustrative" badge and up to four live tiles (`ValueCard`).

- **Pack resolution:** the connection service reads the engine part number once per session
  (`22 F187`, `session.readPartNumber()`) right after connect — only on CAN and only when the active
  profile declares extended PIDs — and caches it as `sessionStore.info.partNumber`. When the
  profile only gains DIDs after connect (VIN auto-select, or picking the Golf by hand), EngineHost
  reads it then ([engine-host](./engine-host.md) → "Engine part number"). The session memoises
  the outcome — a `null` "no answer" included — so `22 F187` is sent at most once per connection.
  `useEnginePartNumber()` returns it; in the simulator it falls back to the profile's engine module
  `sampleIdent.F187`. `findLabelPack(partNumber)` picks the pack; no pack ⇒ no section.
- **Log group** starts the measuring-block log with exactly that group's DIDs; **Chart group** adds
  a panel with up to four series (one per DID) and opens Charts.
- A group DID the profile does not declare shows "No definition for `<DID>` in this profile." and
  is never polled, logged or charted.
- The Golf pack (`03L906022*`) ships three **illustrative** groups — `075` DPF (soot mass, soot
  load, km since regen, regen count), `099` temperatures (EGT, oil), `120` EGR / injection (EGR
  position, injection quantity, cylinder 1–2 corrections) — to be pruned to real DIDs after a
  capture (plan 25).
- Everything uses the default (engine) header. Groups for other modules and KWP `21 <group>` over
  TP2.0 are deferred until addresses and timing are confirmed on the car.

## AI agent

- AI agent: `read_extended` — `agent/agentTools.ts` contributes the tool (up to 8 declared DIDs, by
  default the first 8 the profile declares, read once through the read-only facade's
  `pollExtendedOnce` and decoded with the profile decoder; one line per DID,
  `<did> <name>: <value> <unit>`, ` (unconfirmed)` for an unverified DID; an undeclared DID is named
  and never sent) and the `extended_data` skill to the [AI agent](./ai-diagnose.md#agent). Offered on
  CAN when the profile declares extended PIDs (the screen's own gate).

## hooks

- `useExtendedPids()` — reads the profile's `extendedPids`, issues the Mode 22 requests, exposes
  values + raw frames, and the profile's DID definitions (`pids`) for the selectable list.
- `useExtendedPids()` also returns `live` (DID → latest `LiveValue` from the poll loop, registered
  only while the screen is focused).
- `useMeasuringLog()` — owns the recording lifecycle: the 1 s sweep, the module-level row buffer, and
  the CSV write + share on stop.
- `useEnginePartNumber()` — the cached engine part number (simulator fallback above).
- `model/measuringGroups.ts` (pure, tested) — `resolveMeasuringGroups(pack, extendedPids)` (labels:
  pack measurement name → profile DID name → `DID <did>`), `resolveEnginePartNumber`,
  `engineModuleOf`.

## api (service layer)

- No service of its own: the one-shot read and the log call `session.readExtended(did)` (bytes after
  `62 <did>`) and decode with the profile's `decode`; live values come from the engine-host sweep
  (`session.pollExtendedOnce`). All on the default header — no `ATSH` / `ATCRA`.
- `api/measuringLog.ts` — the pure `buildMeasuringLogCsv(rows)` builder plus the module-level row
  buffer (`resetMeasuringLog` / `appendMeasuringRow` / `getMeasuringLog` / `measuringLogSize`).

## model

- No store: live values sit in `liveDataStore.values` under `22:<DID>` keys, one-shot readings and
  selections are screen state, chart panels go to the shared `chartsStore`.
- `model/measuringGroups.ts` — the pure group resolution described under hooks.

## Behavior

- Hidden entirely unless the profile opts in and the protocol is CAN.
- Every value is labeled experimental; raw frames are always shown for debugging/confirmation.

## Acceptance

- For the Golf simulator, the seeded experimental DID returns a plausible value with the amber
  "Illustrative — not yet confirmed on this car" badge (blue once the DID carries `confirmed`).
- Golf simulator: values update live without a manual read; three measuring groups show; **Chart
  group** opens Charts with a four-series panel; **Log group** records only that group's DIDs
  (`ExtendedPidsScreen.test.tsx`).
- Never offered for the Passat/Punto profiles.
