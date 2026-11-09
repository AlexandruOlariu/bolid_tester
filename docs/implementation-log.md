# Implementation Log

A running record of what was actually built, newest first. (Documentation-driven: specs live in the
other docs; this file is the "what we did" history.)

---

## Plan 24 — Adaptation restore from a full-car backup (2026-11-09)

[Plan 24](./plans/24-adaptation-restore.md) landed: the "clone my car" snapshot now restores
**adaptation channels** as well as coding — per channel or per module, behind the adaptations unlock,
through the same bounds guard and backup → write → verify path every other adaptation write uses,
with a backup-vs-car comparison first. Everything above the plan's deferred section is shipped and
exercised in the simulator; **on-car pending**: the first real use on the Golf is a no-op restore
(backup, Compare → all `equal`), then a one-step change restored and re-read, recorded in the
vehicle doc.

- **Core (`obd-core/coding/adaptationValue.ts`).** `AdaptationBounds` (scaling + `min` / `max` /
  `unit`) and `adaptationBoundsError(ch, raw)` — the single write guard: refuses raw bytes that are
  not `byteCount` wide, or decode (signed-aware) below `min` / above `max`; never clamps.
  `adaptationService.checkBounds` is now a one-line wrapper over it, so `writeChannel` and the
  restore planner share one implementation.
- **Planner (`features/coding/api/adaptationRestore.ts`, pure).** `planAdaptationRestore(snapshot,
liveChannels, current, { unlockable })` → `RestorePlanItem[]` with the plan's rules in order:
  `no-channel` → `no-snapshot-raw` → `out-of-bounds` (bounds message as `reason`) → `locked` →
  `equal` (byte-for-byte) → `restore`; values decoded with the live channel's scaling.
  `summarizeRestorePlan` (restore count + every skip reason, zero-filled), `noSecurityUnlock`
  (default: `ch => !ch.security`), `currentModuleFromReads` (fresh reads shaped as a
  `CarBackupModule` via `buildCarBackup`) and `restoreHeadline` ("2 adaptations differ, coding
  unchanged" from `diffBackupModule`).
- **Hook (`hooks/useAdaptationRestore.ts`).** `readCurrent(module)` reads every profile channel of
  the module through `readChannel` (plus the module's long coding when the snapshot has one, keyed
  by its coding DID, `resetAddressing()` in `finally`); `plan`; `restoreOne(item)` /
  `restoreAll(items, onProgress?)` write through `writeChannel`, push the replaced value onto
  `adaptationsStore.backups` (so the Adaptations screen can undo a restore), log failures, and stop
  at the first failure. The adaptations unlock is re-read from the store at write time (fails
  closed); `writeChannel` re-checks bounds and refuses security channels.
- **UI (`ui/AdaptationRestorePanel.tsx`, in `CodingBackup.tsx`).** The informational "restore them
  from the Adaptations screen" paragraph is replaced by **Compare with car** → headline + one row
  per channel (name (DID) · backup → car now with units · chip: restore / equal / not in profile /
  not in backup / out of bounds / locked; equal rows greyed; skip reason shown), per-row
  **Restore** with the inline confirm ("Write 850 rpm to Idle speed offset (DID 3001)? A backup of
  the current value is taken first."), **Restore all (N)** with the list, progress and "Not
  restored: …" on failure; re-compares after every write. Locked → buttons disabled plus "Locked —
  unlock adaptations on the Adaptations screen…"; press handlers also check the gate.
- **Simulator.** No new scenario fields (`2E` on channel DIDs is already accepted via
  `adaptationSeeds` → `coding`).
- **Tests (+40 tests incl. the review follow-ups, +3 suites: 1051 tests / 129 suites).** `adaptationValue.test.ts` (inside /
  edges / below / above / scaled / no bounds / wrong width / signed), `adaptationRestore.test.ts`
  (every skip reason, header matching, failed current read → restore, locked vs unlockable, bounds
  before lock, summary counts, headline variants), `adaptationRestore.integration.test.ts`
  (simulated Golf: 850 → 900 → plan `3001` restore / `3002` equal → restore verified → 850; a 1024
  rpm snapshot refused by the planner and by `writeChannel`, car untouched),
  `ui/CodingBackup.test.tsx` (Create backup → change 3001 → Compare shows `850 rpm → 900 rpm ·
restore` and `3002 · equal`; locked → disabled + explanation; unlocked Restore → "Write verified.",
  both rows equal, backup recorded, car reads 850; Restore all; out-of-bounds row with the bounds
  message and no Restore). `test/resetStores.ts` now also resets the car-backup, coding and
  adaptations stores.
- **Docs.** `features/coding.md` (6b.8: restore flow, skip reasons, gating, tests, on-car pending),
  `features/adaptations.md` (shared bounds guard; the backup screen writes through the same service
  and unlock), `vcds-parity-roadmap.md` 6b.8, `roadmap.md` (✅, on-car pending). Context graph:
  `concept:adaptation-channels` updated; graph rebuilt.
- **Deviations.** (1) Plan 23 (security-access plugins) has not landed, so there is no
  `resolveSeedToKey` to pass into `writeChannel`: the hook plans with `noSecurityUnlock` and
  `writeChannel` keeps refusing security channels — they always show as `locked`. (2)
  `adaptationBoundsError` also refuses raw bytes whose length is not the channel's `byteCount`
  (fail closed for a snapshot taken under an older profile revision); such values plan as
  `out-of-bounds`. (3) `readCurrent` also reads the module's long coding (keyed by its coding DID)
  so the header can say "coding unchanged / changed" as the plan's example does; the planner ignores
  that key. (4) `restoreAll` takes an optional `onProgress(done, total)` for the progress line, and
  the hook also returns `unlocked` and `connected` for the UI. (5) The restore UI is its own
  component (`AdaptationRestorePanel.tsx`) rendered from `CodingBackup.tsx`'s module block, and a
  component test was added beyond the plan's test list to cover the acceptance checks on screen.
- **Review follow-ups.** (a) The panel and hook now require a **CAN** session (`available =
!!session && isCan(session.currentProtocol)`, as `useAdaptations` does) instead of any session;
  the hook returns `available` in place of `connected`, and `readCurrent` returns `null` when it
  cannot read. (b) New non-persisted `model/backupWorkStore.ts` — one shared gate (`tryBegin` /
  `end`) taken by backup create, the module block's coding restore, and adaptation compare /
  restore, so they never interleave addressing and writes; a second action is refused with "Another
  module read or write is still running…". This is a Backup-section gate, not a session-wide lock:
  `DiagnosticSession` still has none, so the Coding module editor / Adaptations screen are not
  serialized against it (pre-existing, unchanged). (c) `backupVehicleMismatch(backup.vehicle,
{ profileId, vin })` in `api/carBackup.ts`: a snapshot taken under another profile / garage car,
  or with a different known VIN, shows a warning and every restore in it (coding and adaptations)
  is disabled; compare / export still work. (d) The panel's compare / restore handlers catch
  rejections (logged, "Failed: …", stale table dropped), and every press handler re-checks its gate.
  (e) `restoreHeadline` now takes the plan items and counts byte-level differences only among
  channels with both a snapshot and a live read; the rest is "N not compared", so the headline
  matches the rows. (f) Tests: Restore all stopping at the first failure ("Stopped at 3001: …
  Not restored: Idle speed offset (3001), EGR base duty (3002).", `writeChannel` called once),
  non-CAN, VIN mismatch, the shared gate, a throwing compare (`CodingBackup.test.tsx`);
  `backupVehicleMismatch` (`carBackup.test.ts`); headline vs rows (`adaptationRestore.test.ts`).

## Plan 19 — AI provider presets, follow-up questions, guide citations (2026-11-09)

[Plan 19](./plans/19-ai-provider-presets.md) landed: the AI assistant works with a **local server**,
**OpenAI**, **Anthropic** (native Messages API) or a **custom** OpenAI-compatible server, each with
its own defaults and its own keystore slot; the owner can ask **follow-up questions** about a report
in a bounded conversation; findings **cite the per-car fault guides** with the same deep-link
buttons as the Faults screen, and the model is told about them. The plan has no deferred section;
the only owner step is optional (Test connection against a real cloud key).

- **Core (`shared/obd-core/analysis/aiProviders.ts`, exported from `obd-core/index.ts`).**
  `AI_PROVIDER_PRESETS` (`local` / `openai` / `anthropic` / `custom`: wire, base URL, default model,
  JSON mode, `needsKey`, `canListModels`, hint), `inferProvider` (api.openai.com / api.anthropic.com
  / blank / other), `resolveProvider`, `applyProviderPreset` (applied only on a switch; remembers the
  previous provider's URL / model / output mode in `ai.remembered`, never a key), `aiConfigProblem`
  (plain-words reason the AI can't run), `MOCK_AI_URL` / `isMockAiUrl`, and the Anthropic shaping:
  `buildAnthropicRequestBody` (system split out, consecutive same-role turns merged, leading
  assistant turn fixed, `max_tokens` default 8192, no sampling params / prefill / `response_format`),
  `extractAnthropicContent`, `anthropicStopReason`, `anthropicHeaders`.
- **Core (`aiDiagnosis.ts`).** `DiagnosticSnapshot.guides?: KnownCheck[]`; `summarizeSnapshot(s,
guides = s.guides)` appends "Known checks for this car"; the system prompt gains "When a finding
  relates to a listed known check, mention it in `detail`" (prompt split into intro / rules / report
  rules so the follow-up prompt reuses them); `buildFollowUpSystemPrompt` (no schema hint, ≤ 120
  words, cite codes by id), `MAX_FOLLOWUP_TURNS = 8`, `buildFollowUpMessages`, `SUGGESTED_FOLLOWUPS`
  and `followUpSuggestions(report, focusCode)`.
- **I/O (`shared/ai`).** `http.ts` (moved `AiClientError` + `fetchJson`, injectable `fetch` via
  `setAiFetch`, 401/403/404/429 hints), `anthropicClient.ts` (`GET /v1/models?limit=100`,
  `POST /v1/messages`, refusal → error, key required), `openaiClient.ts` (uses `http.ts`, exports
  `requireBase`), dispatcher `getAiClient(settings): AiClient { listModels, chat(messages, { json }) }`
  in `index.ts` (wire from the preset; `json: false` forces plain text on the OpenAI wire), and the
  dev mock `__mocks__/mockAiServer.ts` for `mock://ai`.
- **Settings.** `AiSettings.provider` (default `local`) + `remembered`; `SETTINGS_VERSION` 5 with
  v4 → v5 `provider = inferProvider(baseUrl)`; `merge` infers a missing provider. `setAi({ provider })`
  applies the preset only on a real switch and swaps in that provider's key (this session's memory at
  once, then its keystore slot unless the user typed meanwhile). `secureApiKey.ts`: one slot per
  provider `bolid.ai.apiKey.<provider>` (`apiKeyStoreKey`, `secureGetApiKey(provider)`,
  `secureSetApiKey(provider, key)`), legacy single slot read + deleted
  (`secureGetLegacyApiKey` / `secureDeleteLegacyApiKey`), `planApiKeyHydration(provider, fileKey,
slotKey, legacyKey)` → migrate (file / legacy-slot) · load · none, with `dropLegacy`.
  `AiSection`: Provider segment + hint, URL input (local / custom) or read-only URL with **Edit** →
  Custom, API key field (`secureTextEntry`, keystore note), Model + Detect, Structured output hidden
  for Anthropic, Test connection through the dispatcher.
- **AI Diagnose.** `gatherSnapshot()` collects `knownChecksFor(curatedProfileId(profile), codes)`;
  `analyze()` uses `aiConfigProblem` + `getAiClient(ai).chat(…, { json: true })`; `followUp()` (friendly
  error for an on-device report / missing setup / empty answer). Store: `conversation`, `asking`,
  `askError`, `pushTurn`, `clearConversation` (cleared by a new report and `reset()`). Hook: `ask()`,
  `clearConversation()`, `guideProfileId`. Screen: `FindingCard` shows "Known check for this car" +
  `GuideLinks` for curated guides; **Ask about this report** card (chips, input + send, bubbles,
  Clear; disabled with a hint for a local report). `GuideLinks` is exported from
  `@/features/fault-codes`.
- **Docs.** `ai-diagnose.md` (providers table, Anthropic wire, follow-ups, guide citations, mock AI
  server, data flow, layers), `settings.md` (AI section, per-provider keys, v5 migration),
  `privacy-policy.md` + `privacyPolicy.ts` (data sent to the chosen provider, follow-ups, cloud
  providers, one key per provider). Context graph: `concept:ai-diagnose-flow` updated + linked to
  `core:analysis/aiProviders`.
- **Tests (+63 tests, +3 suites: 1011 tests / 126 suites, review fixes included).** `aiProviders.test.ts` (hosts and blanks,
  presets, local → anthropic → local restores URL / model / mode, remembered cloud model, URL
  carry-over rules, config problems, Anthropic body / content / headers / stop reason),
  `aiDiagnosis.test.ts` (known-checks section, system rule, follow-up structure, bounded to 8, no
  schema hint, suggestions + focus), `secureApiKey.test.ts` (per-provider slots with an in-memory
  keystore, legacy migration plan), `settingsStore.test.ts` (v5, v4 → v5 inference, v4 OpenAI blob
  rehydration, provider switch keeps per-provider keys and the local URL, keystore load on switch,
  legacy-slot and plaintext-file hydration), `shared/ai/aiClient.test.ts` (dispatcher: Anthropic →
  `/v1/messages` + `x-api-key` + version, models list, refusal, 401 hint, URL inference; OpenAI →
  bearer + `response_format`, `json: false`, local without auth; `mock://ai` only with `__DEV__`),
  `AiDiagnoseScreen.test.tsx` (mock://ai on the simulator Golf with P0401 + P2015: guide notes,
  Related data → `/extended?dids=170E%2C170F`, Open routine → `/routines`, snapshot guides; chips
  and free text append bubbles, Clear; 6th prompt drops the 1st turn; focus chip first; local report
  disables follow-ups), `SettingsScreen.test.tsx` (Anthropic fills URL + model, hides Structured
  output, shows the key field; Edit → Custom; Test connection hits the Anthropic models list with the
  key).
- **Deviations.** (1) `anthropic-version: 2026-10-21` instead of the plan's `2023-06-01`: the
  current API version per the `claude-api` reference; the app sends none of the fields it removed.
  (2) Raw `fetch` (as the plan specifies) rather than the `@anthropic-ai/sdk` package: no new
  dependency in the React Native bundle, one shared timeout / error path, injectable for tests.
  (3) `buildAnthropicRequestBody` default `max_tokens` is 8192, not 2048: current Claude models
  think adaptively by default and thinking counts against `max_tokens`, so 2048 could truncate the
  JSON report. Server-side refusal fallbacks are not sent (the model is user-selectable and older
  models reject the parameter); a `refusal` stop becomes an error and the local report. (4) Extra
  header `anthropic-dangerous-direct-browser-access: true` so a web build (plan 28) can call the API
  with the user's own key. (5) OpenAI default model `gpt-5-mini` could not be confirmed against a
  live `GET /v1/models` (no network calls allowed); **Detect model** replaces it. (6) The custom
  preset has `needsKey: false` (key optional, field shown) — custom servers vary. (7)
  `applyProviderPreset` lives in core (generic over the preset fields) and remembers URL / model /
  mode per provider in `ai.remembered`, which is how "keeps the user's local URL when switching
  back" works. (8) The `GuideLinks` extraction already existed (`fault-codes/ui/DtcGuideParts.tsx`,
  plan 05) — only exported from the slice index; its buttons are labelled **Related data** / **Open
  routine** (the plan's "Measuring blocks" / "Routine"). Guide notes show only for curated guides,
  not `GENERIC_GUIDE`, and one per distinct guide. (9) Plan 05's `focus` param makes "What does
  <focus> mean for this car?" the **first suggestion chip** rather than sending a question
  automatically (no unrequested network call; the focused report already explains the code). (10)
  The conversation stays on screen in full; only the prompt is bounded to `MAX_FOLLOWUP_TURNS`
  messages. (11) The mock server is selected only when `__DEV__` is on, but it is a static import, so
  it is in the bundle (inert in release builds) rather than excluded. (12) `secureApiKey.ts` gained a test seam, `setSecureStoreModule`, so the keystore tests inject an in-memory double instead of relying on the variable-specifier `import()` under Jest (it resolved intermittently in parallel runs). (13) Plan 18 (backup) has not
  landed yet; the "backup never contains a key" acceptance holds because keys never enter the
  persisted settings blob (`redactApiKey`), which is what a backup would read.
- **Review fixes.** (a) `hydrateApiKey` deletes the legacy single slot only when its key is safe: on
  a `load`, or when `secureSetApiKey` into the provider slot returned true — a failed write keeps the
  legacy slot so the next start retries (test: failing keystore write keeps `bolid.ai.apiKey`).
  (b) `useAiDiagnose().ask()` drops an answer (or error) that resolves after the report changed
  (`setReport` resets the conversation) or the conversation was cleared, instead of pushing it into
  the new report's conversation (screen test: a late answer after `setReport` is not shown).
  (c) Settings `AiSection` Test connection / Detect model drop their result when the provider or base
  URL changed while the request ran, so an old provider's model never lands in the new provider's
  settings (screen test: Detect on Local, switch to Anthropic, model stays `claude-sonnet-5-5`).

---

## Plan 17 — Trip detail map (2026-11-09)

[Plan 17](./plans/17-trip-detail-map.md) landed: a saved trip opens on its own screen with the GPS
track drawn as a coloured SVG polyline, the GPS-vs-OBD distance check with a plain verdict, and a
speed-over-time strip — all demoable in the simulator through a synthetic GPS loop. The deferred
on-car part (validating the 3 % / 8 % thresholds against the Golf's known-good odometer) is
untouched.

- **Core (`shared/obd-core/analysis/track.ts`, exported from `obd-core/index.ts`).** `trackBounds`,
  `projectTrack` (equirectangular, lon × cos(latMid), fitted and centred in the padded box, north
  up), `scaleBar` (nice 100 m … 100 km bar ≤ ⅓ of the width), `formatBarLength`, `nearestPoint`
  (tap hit-test, 24 px), `alignSamplesToTrack` (binary search, ties → earlier; speed from the GPS
  fix with `010D` fallback, `010C`, `015E`), `colourSegments` / `legendFor` (fixed metric buckets on
  a 5-step accent → red palette, fuel by trip quartiles, grey for null), `gpsVsObd` (`ok` < 3 %,
  `check` < 8 %, `mismatch` ≥ 8 %, `unknown` with < 2 fixes / no `010D`; constants
  `GPS_OBD_OK_PCT` / `GPS_OBD_CHECK_PCT`), `speedProfile` (≤ 300 points) and
  `syntheticLoopPoint` (2 km rounded rectangle from 44.4268 N, 26.1025 E) with
  `syntheticLoopAdvance` (the loop position a given straight-line step away). `trip.ts` exports
  `obdDistanceKmFromSamples` (the private `obdDistanceKm` is now a one-line wrapper).
- **Loading.** `useTripRecorder.loadTrip(header)` reads the CSV once → `{ samples, track }`;
  `loadTripSamples` delegates to it. Same `csv-read` error logging.
- **Synthetic GPS.** `trackRecorder.startTrackCapture()` with `adapterSource === 'mock'` starts a
  timer (fix at start, then every 5 s) that advances along the loop by the live `010D` speed (40 km/h
  default), each step a chord of speed × time (`syntheticLoopAdvance`) so GPS = OBD distance even
  through the corners; `stopTrackCapture()` adds a closing fix at the stop time. `isSyntheticTrack()`;
  `stopRecording` stores `TripSummary.syntheticTrack: true` (optional field, no persist migration).
- **UI.** New hidden route `/trip-detail` (`src/app/trip-detail.tsx`, `_layout` `href: null`, title
  "Trip") → `TripDetailScreen`: stats cards, GPS-vs-OBD card (distances, Δ %, average speeds,
  verdict + note), `TrackMap` (3:2 SVG on `$color2`, segment lines, start/end markers, scale bar,
  "N ↑", Speed · RPM · Fuel · None control, legend chips, tap → tooltip card with time, km/h, rpm,
  L/h), `SpeedStrip`, "simulated GPS" badge, empty states ("No GPS track for this trip.", no
  samples, trip not found). `TripScreen` rows' **Open** now navigates there (inline expand
  removed) and no longer imports `@/shared/lib/units` — distances are km, metric only.
- **Tests (+58 tests, +3 suites: 948 tests / 123 suites after the review fixes).** `track.test.ts` (projection fit and
  y-flip, aspect, `scaleBar` 500 m at 320 px, nearest-sample ties, segment count/grey, buckets,
  legends, verdicts at ±2 / ±5 / ±12 % and around the thresholds, `unknown`, `speedProfile` cap,
  loop closure and 2 km length), `trip.test.ts` (`obdDistanceKmFromSamples` = `tripStats` distance),
  `trackRecorder.test.ts` (mock source → points advance with the live speed, closing fix, 40 km/h
  default; BLE path unchanged), `useTripRecorder.test.ts` (core: `loadTrip` one read, old CSV,
  missing file; simulator `stopRecording` writes the track and flags the summary),
  `TripDetailScreen.test.tsx` (60 s simulator recording → `ok` + badge + 12 segments, a 3 min
  recording draws the closed loop, a hand-built lap closes,
  overlay recolour + legend, tap tooltip, mismatch card, pre-GPS trip, missing CSV / unknown id),
  `TripScreen.test.tsx` (Open → `/trip-detail` with the id; km regardless of the legacy units
  setting). Context graph: new `concept:gps-obd-check`.
- **Deviations.** `scaleBar` takes an optional 4th `height` argument so the bar matches a
  height-bound fit (the plan's signature only had width), and its nice lengths continue past 5 km
  (10 / 20 / 50 / 100 km) for long drives. Extra pure helpers `nearestPoint` and
  `formatBarLength`. The synthetic generator advances by speed × the actual elapsed time (≈ 5 s per
  tick) and adds a closing fix on stop, so GPS and OBD distances cover the same span (otherwise up to
  5 s of driving is lost and a 60 s trip could miss the `ok` band). "simulated GPS" is persisted as
  `TripSummary.syntheticTrack` because `isSyntheticTrack()` alone cannot tell a reopened trip's
  origin. The UI test stubs `loadTrip` with the in-memory files because the UI Jest project cannot
  run the variable-specifier `import()`; the real read is tested in the core project. Speed values
  for the overlay come from the nearest sample with no maximum time gap.
- **Review fixes.** (1) The plan's "simulator trip with ≥ 10 fixes renders a closed loop" and its
  60 s demo cannot hold on a 2 km loop at 40 km/h (10 fixes ≈ 500 m, the first straight): the loop
  closes after one lap, about 3 min. Kept the plan's 2 km geometry, corrected the docs (3 min demo)
  and added a real 3 min simulator recording test asserting the closed loop. (2) Fuel-rate buckets
  collapsed on a steady fuel rate (quartiles `[v, v, v]` → every segment red, repeated legend labels
  and duplicate React keys): edges are now rounded to the legend's 0.1 L/h and kept only when
  distinct and above the minimum, so a steady trip is one middle-colour bucket labelled with its
  value; legend chips are keyed by index. (3) Arc-length steps cut the 60 m corners, so a steady
  90 km/h simulator drive read > 3 % short (`check`): steps are now chords of speed × time
  (`syntheticLoopAdvance`, bisection), and tests drive 40 / 90 / 130 km/h for 10 min and assert
  `ok` with |Δ| < 0.5 %.

---

## Plan 14 — Mode 22 charts and measuring groups (2026-11-09)

[Plan 14](./plans/14-mode22-charts-measuring-groups.md) landed: extended (Mode 22) DIDs flow
through the one demand-driven poll loop, so they plot in Charts, update live on the Extended PIDs
screen, and can be viewed as VCDS-style measuring groups from label packs. All in the simulator;
the deferred on-car part (which Golf DIDs answer, module-scoped groups, KWP `21` over TP2.0, a
DIDs-per-sweep cap) is untouched.

- **Keys (core).** `shared/obd-core/obd/liveKeys.ts`: a live key is a Mode 01 PID or
  `'22:<DID>'` — `extendedKey`, `isExtendedKey`, `didOfKey`, `splitPollKeys` (order kept,
  de-duplicated) and `labelForLiveKey(key, extendedDefs)` (`Engine RPM (rpm)`, `DPF soot mass
(calc.) (g) · 1701`, `DID 1701` when undeclared). Exported from `obd-core/index.ts`.
- **Session.** `DiagnosticSession.pollExtendedOnce(dids)`: sequential `22 <did>` on the current
  header, bytes after `62 <did>` (DID echo checked) or null; off CAN it sends nothing.
  `readPartNumber()` reads `22 F187` as printable ASCII and memoises the outcome per session
  (`null` included; a thrown read is forgotten), so `22 F187` goes on the bus at most once per
  connection. `SessionInfo.partNumber?` (additive).
- **EngineHost.** The sweep is `computePollPids` → `planSweep(keys, declaredDids, isCan)` (keeps a
  DID only on CAN when the active profile declares it) → `pollOnce(pids)` + `pollExtendedOnce(dids)`
  → `decodeExtendedSnapshot` (`engine-host/extendedSnapshot.ts`, pure) → one merged `setValues`.
  Alerts see the merged snapshot; trip samples stay Mode 01. Never re-addresses. The two reads have
  separate `try`s: a throwing extended read logs `live-data/extended` (deduped) and drops only that
  sweep's DIDs, so the Mode 01 snapshot is still published, alerted on and trip-sampled.
- **Extended PIDs screen.** `useExtendedPids` registers every declared DID key on the shared
  `liveDataStore` while the screen is **focused** (`useIsFocused`; released on blur, since hidden
  Tabs routes stay mounted and 15 sequential DIDs per sweep would slow Mode 01 app-wide) — `live`
  values; `refresh()` stays the raw one-shot read. A DID card prefers the measuring log's value
  only while a log runs (`useMeasuringLog` clears `latest` on stop), so a finished log never
  freezes a card. **Chart this** per row.
  **Measuring groups** section: `useEnginePartNumber()` (the connect-time `info.partNumber`,
  simulator fallback to the engine module `sampleIdent.F187`) → `findLabelPack` →
  `resolveMeasuringGroups` (`model/measuringGroups.ts`); one card per group with up to four
  `ValueCard`s, **Log group** (measuring log with only that group) and **Chart group**; undeclared
  DIDs read "No definition for … in this profile".
- **Connect.** `connectionService` reads the part number once after `session.connect()`, only on CAN
  and only when the active profile declares extended PIDs; a failure is logged
  (`connection/part-number`) and never fails the connect. When the profile gains DIDs later in the
  session (VIN auto-select runs after connect; or a manual switch to the Golf) and none is cached,
  EngineHost reads it then and stores it with the new `sessionStore.setPartNumber(session, pn)`.
  The VIN auto-select effect is now keyed on session + VIN, so that `info` patch never re-runs it.
- **Live store.** `liveDataStore` moved to `src/shared/state/liveDataStore.ts` (the
  `features/live-data/model` path re-exports it), so extended-pids registers its DID keys without
  a feature → feature import; live-charts' `useChartSeries` and EngineHost import the shared path.
- **Sensor readings.** The "Other" group skips extended `22:<DID>` keys, which now share the live
  store — experimental manufacturer values never appear among the standard sensors.
- **Charts.** The panel store moved to `src/shared/state/chartsStore.ts` (feature path re-exports
  it) with `addPanel` (`p<n>` ids, ≤ 4 series) and `removePanel`. `ChartsScreen` gained **Add
  panel** (picker from `chartKeyOptions`: effective Mode 01 PIDs, plus extended keys on CAN with
  DIDs) and **Remove**; header, stats and inspect lines use labels. `seriesToCsv(series, labels?)`
  adds a trailing `label` column (RFC 4180 quoting); without labels the old format is unchanged.
- **Label packs.** `MeasuringGroup` + `LabelPack.measuringGroups` (≤ 4 DIDs, key = VCDS group
  number); `measuringGroups(pack)` sorted numerically, DIDs upper-cased and capped. The Golf EDC17
  pack ships three illustrative groups: `075` DPF, `099` temperatures, `120` EGR / injection.
- **Simulator.** `buildScenario` seeds the engine module's `sampleIdent.F187` (ASCII) into
  `extendedDids` for profiles that declare DIDs, so the Golf answers `22 F187` = `03L906022LM` on the
  default header. Connect-flow sim fixtures are unchanged (the part number is read by the service,
  not by `DiagnosticSession.connect`).
- **Tests (7 new suites; 890 tests / 120 suites after the review fixes).** `liveKeys.test.ts`, `extendedSnapshot.test.ts`
  (decode, omission rules, one EngineHost-equivalent sweep on the Golf simulator),
  `sessionExtras.integration.test.ts` (`pollExtendedOnce` bytes / null, F187, no traffic on the
  Passat), `pollPids.test.ts` (mixed keys, `planSweep`), `registry.test.ts` (groups sorted, label
  fallback, cap), `measuringGroups.test.ts`, `chartKeys.test.ts`, `chartCsv.test.ts` (label column,
  quoting), and UI tests `EngineHost.extended.test.tsx` (Golf `22:1701` live; Punto / Passat send no
  `22` with a stale panel), `ExtendedPidsScreen.test.tsx` (part number at connect, live values,
  three groups, Chart group → 4-series panel + `/charts`, Chart this, Log group records only its
  DIDs, no pack ⇒ no groups, cards follow live values after a log stops, no DID registration
  while unfocused), `ChartsScreen.test.tsx` (picker → DID panel updates live with labels;
  Punto offers no DIDs; remove). Review fixes added `EngineHost.extended.test.tsx` cases (a
  throwing extended read keeps `010C`; Generic → Golf after connect reads F187) and a
  `SensorReadingsScreen.test.tsx` case (no `22:` value under "Other"); second review fixes added
  a `sessionExtras.integration.test.ts` case (an unanswered F187 is sent once across repeated
  `readPartNumber()` calls) and a `chartBuffer.test.ts` case (`pushIfNewer`). `test/mocks/router.ts`
  gained `useIsFocused` (`setMockFocused`, reset by `resetStores`).
- **Docs.** [extended-pids](./features/extended-pids.md) ("Live plot (deferred)" removed; Live
  values, Chart this, Measuring groups; stale `extendedPidService` / `extendedStore` lines
  corrected), [live-charts](./features/live-charts.md) (keys, picker, labels, CSV label column,
  shared store), [adaptations → label packs](./features/adaptations.md#label-packs-srcsharedlabels)
  (`measuringGroups`), [engine-host](./features/engine-host.md) (split sweep, default-header-only
  rule, composition list), [connection](./features/connection.md) (part-number read),
  [simulator](./simulator.md) (F187 seed); roadmap v0.3 "Mode 22 in charts" and v0.6
  "Measuring-block groups" ✅ (on-car pending).

**Deviations from the plan.**

- **No alert rule editor exists** (the Alerts screen only lists, toggles and deletes rules), so
  nothing lists extended keys there. A rule whose `pid` is an extended key already works: the alert
  engine evaluates the merged snapshot, and `planSweep` polls its DID.
- **CSV labels are a trailing `label` column, not a second header row:** the chart CSV is long
  format (one row per sample, keys in the `pid` column, not as column names), so a label row has
  nothing to line up with. Each row carries key + label instead.
- **The charts picker did not exist**; it was built (Add panel / Remove), and the panel store moved
  to `src/shared/state/chartsStore.ts` so "Chart this" adds no feature → feature import. Panels stay
  in memory (no persistence yet, as before).
- **Part-number read is gated on the profile declaring DIDs**, not only on CAN, so a DID-less CAN
  car (the Punto) sends no Mode 22 at all. It runs before `setConnected` so `info` carries it from
  the first publish. `DiagnosticSession.readPartNumber()` was added for it. Because that gate
  depends on the profile at connect time, EngineHost re-tries the read once the active profile
  declares DIDs (review fix); the resulting `info` patch is why the VIN auto-select effect now
  keys on session + VIN instead of the `info` object. Second review fix: an unanswered connect-time
  read used to be repeated by that retry (and again on each profile switch), costing a NO DATA
  timeout each; `readPartNumber()` now memoises its result per session, so it really is once.
- **Charts skip re-published values** (second review fix, not in the plan): a sweep whose Mode 01
  phase fails but whose DIDs answer merges the fresh `22:` values into the old Mode 01 entries,
  which keep their `ts`. `useChartSeries` pushed `values[pid]` on every `values` change, so that
  (and, already before plan 14, every pan / zoom re-render) appended duplicate points and CSV rows.
  It now uses `ChartBuffer.pushIfNewer` (points must be newer than the last one).
- `labelForLiveKey(key, extendedDefs)` takes the profile's DID definitions (a structural
  `LiveKeyDef[]`) instead of the profile, so obd-core imports nothing from `vehicles`.
- The full-sweep integration test lives in `engine-host/extendedSnapshot.test.ts` (obd-core tests
  cannot import the feature's decoder); `sessionExtras.integration.test.ts` covers the session side.
- The Golf `120` group includes `170A` / `170B` (no pack `measurements` label) to exercise the
  profile-name fallback.
- **`liveDataStore` moved to `shared/state`** (review fix; not in the plan) instead of
  extended-pids importing `live-data`'s `useLiveData`: the screen registers its DID keys on the
  shared store itself, focus-gated, so plan 14 adds no feature → feature import.
- **Extended-key filter in Sensor readings** (review fix): the plan assumed every consumer treats
  keys as opaque, but its "Other" group renders the whole live map.

---

## Plan 06 — Garage and learned profiles (2026-11-09)

[Plan 06](./plans/06-garage-learned-profiles.md) landed: users keep several cars, learn one from a
live connection or add it by hand, and every per-car feature follows the active car. The plan has
no deferred or owner section.

- **Core (pure, core-typechecked).** `src/shared/vehicles/userVehicle.ts`: `UserVehicle`,
  `LearnedIdentity`, `buildUserProfile` (identity from the user record, learned protocol / PIDs /
  VIN pattern, the experimental arrays only from a non-generic base, never `knownFaults`),
  `learnedFromSessionInfo`, `defaultVehicleName` ("Volkswagen 2009"), `makeForVin`,
  `pickVehicleForVin`, `isUserVehicleId`, `curatedProfileId`. `resolve.ts`: `resolveProfile(id,
garage)` (registry → garage car on its base → `generic`) and `simulatorSourceFor(id, garage)`.
  `VehicleProfile` gains an optional `baseProfileId`; `vehicleLabel` does not repeat a year a garage
  name already carries.
- **Store.** `src/shared/state/garageStore.ts` (`bolid.garage` v1): `add` / `update` / `remove` /
  `setLearned`, a sanitising `merge`, `garageExportJson`. Added to the splash hydration gate and the
  UI-test store reset.
- **Active profile.** `src/shared/state/activeProfile.ts` (re-exported by
  `features/vehicle-select/api/activeProfile.ts`): `getActiveProfile()` / `useActiveProfile()` with
  a shared one-entry cache. `vehicleStore` moved to `src/shared/state/vehicleStore.ts` alongside it
  (`model/vehicleStore.ts` re-exports it; same `bolid.vehicle` v1 file). Every former
  `getVehicleProfile(selectedProfileId)` site moved to them: EngineHost, `dtcService`,
  `diagnoseService`, `useAiDiagnose`, `useLiveData`, `DashboardScreen`, `SensorReadingsScreen`,
  `FaultCodesScreen` / `DtcDetailSheet`, and the adaptations, coding (+ car backup), dpf,
  extended-pids, module-scan, routines, sensor-tests and service-reset hooks. `grep
"getVehicleProfile(useVehicleStore"` returns nothing.
- **Learn this car.** `api/learnVehicle.ts`: `learnFromConnectedCar({ existingId?, baseProfileId? })`,
  `deleteGarageVehicle` (falls back to `generic` when selected, resets the simulated vehicle to the
  car's base when it was simulated; history, scans and trips are kept)
  and `autoSelectGarageCarForVin`.
- **VIN auto-select.** `settings.autoSelectByVin` (default on), settings **v4** via
  `migrateSettings` (v3 → v4 fills it, keeps every v3 field); Settings → "Recognise my cars by VIN".
  EngineHost checks each new `SessionInfo` and selects the matching garage car ("Car recognised"
  info notification).
- **Per-car stores.** `maintenanceStore` → **v2** `byVehicle` buckets keyed `vin:<VIN>` (learned
  garage car, with its `id:` key as an alias) or `id:<profile id>`. The v1 migration moves the
  global logbook under the car selected at upgrade; when the vehicle store has not hydrated yet it
  is parked under `legacy:v1` and adopted once both stores have. Tested from the exact v1 file shape
  in both hydration orders; the vehicle selection is untouched. `MaintenanceScreen` shows whose
  logbook it is and is keyed by car. `TripSummary.vehicleId` (set on stop) + per-car filter chips
  on the Trips screen (older trips group by their `header.profileId`, "Removed car" for a deleted
  garage car).
  History, scans and the dashboard layout needed no shape change.
- **UI.** `VehicleSelectScreen`: garage recognition card, **My garage** (copy, **Add from connected
  car** — disabled with a hint when not connected — **Add manually**, cards with VIN suffix / year /
  fuel / protocol / PID count, **Edit** / **Delete** with an `Alert` confirm, long-press edits),
  **Built-in profiles**. `VehicleEditorSheet` (name, year, fuel, base profile, notes; **Share garage
  as JSON** footer via `useGarageExport`); form rules in `model/vehicleDraft.ts`.
- **Simulator.** The Settings simulated-vehicle picker lists garage cars; `connectionService`
  builds a garage car's scenario from its base with the learned VIN, PID set and calibration id
  (`simulatorSourceFor`). A car learned from the simulated Golf reconnects with the same VIN and PIDs.
- **Tests (60 new, 8 new suites).** `userVehicle.test.ts`, `resolve.test.ts` (incl. the learned-Golf
  reconnect through `MockTransport`), `garageStore.test.ts`, `maintenanceStore.test.ts` (v1 file →
  v2 in both hydration orders, per-car isolation, alias fold), `learnVehicle.test.ts` (through the
  real `connectionService`: learn the Golf, history under its VIN, Punto not auto-selected and added
  as a second car, garage car as the simulated vehicle, delete fallback), `tripStore.test.ts`,
  `EngineHost.test.tsx` (auto-select on / off / other VIN), `MaintenanceScreen.test.tsx`, plus new
  cases in `VehicleSelectScreen.test.tsx` and `settingsStore.test.ts` (v4). 819 tests / 110 suites.
- **Docs.** [vehicle-select](./features/vehicle-select.md) rewritten (garage, learn, editor,
  resolution, auto-select, export, simulator); [vehicles/README](./vehicles/README.md) "User
  vehicles vs registry profiles"; [maintenance-log](./features/maintenance-log.md) "Per-car
  logbook" + migration; [architecture](./architecture.md) shared-store list with `garageStore`;
  [settings](./features/settings.md) (v4, the new toggle, garage cars in the picker);
  [trip-recording](./features/trip-recording.md) (filter, `vehicleId`);
  [engine-host](./features/engine-host.md) (engine 6, composition list back at 19 slices);
  [simulator](./simulator.md). Context graph: new `garage-learned-profiles` concept.

**Review fixes.**

- Live PID filter: a garage car on the generic base (added by hand, nothing learned) was cut down
  to generic's 18-PID placeholder list, because EngineHost / `useLiveData` / `DashboardScreen`
  tested `profile.id === 'generic'`. They now call `livePidFilter(profile)` (`userVehicle.ts`): no
  filter for any generic-based profile, the curated or learned list otherwise.
- `useModuleScan`, `useRoutines` and `useDpf` key their callbacks / the routine safety cleanup on
  the memoised `profile` instead of `profile.id`, so editing a garage car's base re-creates them
  (no `clearModule` against the old base's module list, no unmount cleanup over a stale routine
  list).
- `deleteGarageVehicle` also resets `settings.simulatedVehicleId` to the car's base registry
  profile when the deleted car was the simulated one.
- Replay-fixture export writes a registry id (`fixtureVehicleId` in `model/replayExport.ts`: the
  simulated car's `simulatorSourceFor` profile, or `curatedProfileId` of the selected car), never a
  `user:` id, so exported fixtures fit `fixtures/<vehicleId>/`. Supersedes plan 02's "registry id
  or `user:<id>`" note.
- `tripCarKey` falls back to `header.profileId` (always recorded) before "Unknown car", so trips
  recorded before the garage keep their grouping.
- `vehicleDraft.test.ts` covers the editor's form rules (year range / format, base profile,
  trimming, round-trip). 840 tests / 113 suites.

**Deviations.**

- VIN auto-select runs in **EngineHost** (an effect on `SessionInfo`), not inside
  `connectionService.connectInternal`: the plan's placement would add a new connection →
  vehicle-select import, which the composition rule forbids; EngineHost is the sanctioned place.
- Settings is **v4**, not v3: plan 12 already took v3 for `autoReconnect`.
- The simulator branch keys off the **simulated vehicle** (`settings.simulatedVehicleId`, which may
  now be a garage id), not the selected vehicle. With the selected vehicle the acceptance step
  "switch the simulated vehicle to the Punto" would still simulate the Golf garage car.
- `pickVehicleForVin(vin, vehicles)` drops the plan's third `profiles` argument: registry profiles
  are never auto-selected, the Vehicle screen keeps suggesting them via `suggestProfilesForVin`.
- `VehicleProfile.baseProfileId` (optional) is new, so fault guides (curated per registry id) follow
  a garage car's base (`curatedProfileId`); `DtcDetailSheet` now takes the `profile` instead of a
  `profileId`.
- New cars also get `year` from the VIN's model-year character when it is encoded; a learned car
  stores the calibration id, which the simulator replays too.
- Maintenance key details beyond the plan: the `id:` alias for a car learned after its logbook was
  started, and the `legacy:v1` parking key for the async hydration race.
- `vehicleStore` and the active-profile helpers live in `src/shared/state/`, not in the
  vehicle-select slice the plan names; the old paths re-export them. The per-car logbook needs the
  active car, and importing it from vehicle-select would have added `maintenance` to the
  feature → feature list. `maintenance` imports the shared paths, so the list stays at 19 slices;
  the other 16 readers can switch the same way (left as is to keep this change small).
- ECU count (mentioned in the roadmap row) is not learned: `SessionInfo` does not report one and the
  plan's `LearnedIdentity` has no field for it. Import of a garage file stays plan 13.

**Review fixes.**

- _Garage export did nothing on a device._ `useGarageExport` loaded the root `expo-file-system`,
  which on this SDK (56) has no `documentDirectory` and throws for `writeAsStringAsync`, so the
  export returned null without logging. The write + share now lives in
  `vehicle-select/api/garageExportFile.ts` (`saveGarageExport`). It uses `expo-file-system/legacy`
  and logs a `vehicle-select/export` warning on every null, including "no document directory".
  `garageExportFile.test.ts` mocks only the legacy module, so a root import fails it. The UI test
  now presses the button and checks that the garage is handed to the export.
- _Duplicate garage cars._ **Add from connected car** always added a new car, even when the
  connected VIN already belonged to one. It now reads **Re-learn from connected car** in that case
  and calls `learnFromConnectedCar({ existingId })`, which refreshes the car in place.
- _Stuck trip filter._ When the filtered car lost its last trip, the chip row could disappear and
  leave an empty list with no way to clear the filter. The filter now falls back to **All cars**
  (`TripScreen.test.tsx`).
- _New feature → feature import._ `maintenance` read `vehicle-select`; `vehicleStore` and
  `activeProfile` moved to `src/shared/state/` (see the deviation above).
- 825 tests / 112 suites after the review fixes.
- _Malformed `learned` block crashed the Vehicle screen and simulator connect._ `sanitizeGarage`
  checked only id / name / base, so a hand-edited record whose `learned` had no `supportedPids`
  array reached `GarageCard` and `simulatorSourceFor`, which read `learned.supportedPids.length`.
  It now validates `learned` (protocol, string PID array, VIN / calibration id string or null,
  `learnedAt`) and strips a malformed one, keeping the car as unlearned.
- _Rehydration merge untested, and it lost the stored cars._ The test named for the merge only
  called `sanitizeGarage`. A new test adds a car while `persist.rehydrate()` is reading and checks
  both cars survive in memory and on disk. It found a real loss: the add rewrote the file with only
  the new car, and zustand does not write after hydration unless it migrated, so the stored cars
  were gone on the next launch. `merge` now flags that case and an `onFinishHydration` listener
  writes the merged list back. 842 tests / 113 suites.

---

## Plan 04 — Doc debt zero (2026-11-09)

[Plan 04](./plans/04-doc-debt.md) landed: every slice under `src/features` has a spec, the 1:1
rule is enforced by a test, and the overview docs describe the app as it is. The plan has no
deferred or owner section.

- **New specs.**
  - [engine-host](./features/engine-host.md): why it exists (finding F1), where it is mounted, the
    five engines (poll loop with period-not-gap timing and error dedup, alerts + default-rule
    seeding, notifications fed by `dtcStore`, trip sampling, the 30 s readiness coach), the
    demand-driven `computePollPids` union, the "only slice allowed to read several feature stores"
    rule together with the 19 slices that break it today, and acceptance.
  - [more](./features/more.md): the 22 entries with routes and specs, **Check for updates**
    (`checkForUpdate` / `fetchAndReload`, `unavailable` in dev clients and builds without
    `expo-updates`), and the hidden-route reachability rule: 22 hidden routes are More entries;
    `/extended` (only from Info, plus a fault guide's **Related data**) and `/vin-decode` (also in
    More) are the Info-linked ones.
  - [sensor-readings](./features/sensor-readings.md): a standalone spec, because plan 07 is not
    next (wave 2 comes first). It covers the seven groups, the CAN-only injection DIDs and the
    "not available here" card. It says plan 07 deletes the slice and the spec together, with no
    alias (an alias whose slice is gone fails the test).
- **Verified.** [onboarding](./features/onboarding.md) matches the shipped code, so it is
  unchanged. In [can-sniffer](./features/can-sniffer.md) the `# app:` header line is now wired (see
  deviations).
- **Enforcement test.** `src/shared/lib/featureDocsSync.test.ts` (core project) checks that every
  `src/features/<slug>` has a `docs/features/<alias ?? slug>.md` and that every spec has a slice:
  - `ALIASES`: `inspection` → `used-car-inspection`, `maintenance` → `maintenance-log`;
  - `NO_SPEC_NEEDED` is empty;
  - `KNOWN_SHARED`: `tp20`.

  The rule is a pure `featureDocsProblems(slices, specs, rules)` that returns one message per
  problem. Four unit tests run it on synthetic trees: aliases and exemptions pass, a deleted spec,
  an aliased slice missing its aliased spec, a spec without a slice and a stale alias. A guard
  checks that the real tree contains the `engine-host`, `more` and `connection` slices and specs,
  so an empty directory listing cannot pass. It names slices rather than a count, so plan 07
  deleting `sensor-readings` does not trip it.
  Checked by hand as well: moving `engine-host.md` away turned the suite red
  (`src/features/engine-host has no docs/features/engine-host.md`). Restored. The audit's
  `for d in src/features/*/` loop prints no `MISSING`.

- **Overview docs.**
  - [phase2-mobile-app.md](./phase2-mobile-app.md): the feature map is now all 32 slices (slug ·
    route · spec), grouped Tier A / B / C like the audit. A step 5 (More) was added. Step 1 already
    said BLE is the default (plan 01).
  - Root `README.md`:
    - Status gains Phase 5, the VCDS-parity expansion + Phase 6b, the 2026-07 improvement plan and
      v0.2 in progress;
    - the More table gains Adapter health and Sensor readings;
    - a new 🧪 manufacturer-tier table lists module scan, adaptations, routines, coding, service
      reset and the bus sniffer, with the 🧪 note.

    "Running the app" already described the BLE default.

  - [docs/README.md](./README.md): the 1:1 rule now names the aliases, `tp20.md` and the new test.
    The index gains `phase2-mobile-app.md`, `improvement-plan-2026-07.md` and
    `vcds-parity-roadmap.md`. The `plans/`, audit and roadmap rows were already there.
  - [connection.md](./features/connection.md): `ScanScreen` → `ConnectionScreen` (with
    `StatusHero`, `DeviceRow`, the real `ADAPTER_NAME_HINTS`). The `linkStore` bullet lists all
    its fields (`link`, `stage`, `attemptStartedAt`, `device`) and actions (`beginAttempt`,
    `setStage`, `setLink`). The fictional `useAdapterStatus()`
    is gone; `useScan` / `useConnect` are documented with their real return shapes. The fictional
    `connectionStore` is replaced by `sessionStore` (shared) + `scanStore`, next to the existing
    `linkStore`. The service section names its real exports. Behaviour step 2 no longer claims an
    auto-connect to the last device. Every other identifier in the spec was grepped against the
    slice and exists.
  - [vcds-parity-roadmap.md](./vcds-parity-roadmap.md) "Login codes": it now says plainly that no
    KWP login code ships. Nothing sends `2B`; `udsCoding.ts` only says "optional login" in a
    comment. It links plan 22.
  - [architecture.md](./architecture.md): new "Engine host" and "Specs" paragraphs under "UI:
    feature-sliced".
  - [live-data.md](./features/live-data.md): links to the engine-host and sensor-readings specs.
    The fictional `usePidPolling(pids)`, `liveDataService` and `liveDataStore` shape are replaced
    by the real `useLiveData(pids?)`, the `liveDataStore` fields and `dashboardLayoutStore`
    (`bolid.dashboard-layout`). Two Behavior claims the code does not have are corrected: a PID with
    no answer is not dropped from later sweeps, and there is no stale-value marking.
  - [vehicle-info.md](./features/vehicle-info.md): the fictional `useVin()` / `useAdapterInfo()` /
    `useSupportedPids()`, `vehicleInfoService`, `connectionStore` and `infoStore` are replaced by
    `useVehicleInfo()`, `sessionStore.info` (`SessionInfo`) and `DiagnosticSession.connect()`. The
    Calibration ID row and the two buttons are now documented, and a Tests section was added.

- **Sensor-readings re-read loop fixed** (found in review). `injectionPids` was a new array on
  every render, so `readInjection` changed identity and its mount effect re-ran after every
  live-data update: five more Mode 22 requests per poll sweep, competing with EngineHost on the
  half-duplex adapter. The list is now `useMemo`'d on the profile id. New
  `SensorReadingsScreen.test.tsx` (simulated Golf) asserts 5 `readExtended` calls after mount and
  still 5 after three live-data updates. Without the fix it sees 11. The spec's hooks, Acceptance
  and Tests sections and [testing.md](./testing.md) were updated.
- **Sensor-readings stale reads cancelled** (second review). The injection read had no
  cancellation, so a session / profile change or **Refresh** during a five-DID read started a
  second read alongside the first, and whichever finished last won. The callbacks also set state
  after unmount. Each read now takes a run id (a `useRef` counter, bumped by every read and by the
  effect cleanup), and a superseded read sends no further DIDs and sets no state. Two new tests
  hold the first `readExtended` open: Refresh then release gives 6 calls (it was 7), and unmount
  then release gives 1 (it was 2).
- **Graph.** After `graph.py build`, `documents` edges went from 41 to 45: one each for
  engine-host, more and sensor-readings, plus a name-match edge from `sensor-readings.md` to
  `feature:sensor-tests`. `neighbors feature:engine-host` lists `doc:features/engine-host`. No new
  concept was needed.
- **Tests.** 102 suites, 759 tests (was 100 / 750). `npm run ci` is green.

**Deviations from the plan.**

- _Sniffer `# app:` line wired._ The can-sniffer spec said it was "not wired yet — plan 08 owns
  versioning". Plan 08 has since shipped `APP_VERSION`, so instead of re-recording the gap,
  `finishedCapture()` now passes `APP_VERSION` to `buildCaptureHeader`. The existing
  `snifferController.test.ts` header test asserts `header.appVersion` and the `# app:` line, and
  fails without the change. The spec example and its Tests section were updated.
- _sensor-readings is standalone_ (the plan's "otherwise" branch), so `ALIASES` has no
  `sensor-readings` entry. Plan 07 must not add one either: it deletes the slice and the spec
  together, and `featureDocsProblems` reports an alias whose slice does not exist. The matching
  instruction in [plan 07](./plans/07-information-architecture.md) ("add the alias only if plan 04
  created the doc") was corrected to say so.
- _Adapter health is not in the 🧪 table._ The plan lists it among the README's Tier C rows. The
  [audit](./audit-2026-11.md) puts `adapter-health` in Tier B, and it is read-only, standard AT
  commands with nothing illustrative. It is therefore in the plain More table, without 🧪. The 🧪
  table has the other six (module scan, adaptations, routines, coding, service reset, sniffer).
- _More: no grouping, badge or search._ The plan's "after plan 07, grouped" and "`experimental`
  badge, search" describe plan 07's work. The spec documents today's flat list and says those parts
  are not built yet.
- _Phase-2 table._ The plan asked for "slug · route · spec". The Tier C table carries the 🧪 note
  in its heading rather than in a column.
- _Prettier._ It also normalised existing blank lines and table padding in `architecture.md`,
  `live-data.md`, `vcds-parity-roadmap.md` and `docs/README.md`. These are whitespace-only changes.
- _Not fixed: other layering debt._ The architecture rule "never on another feature" is broken
  widely, not by a few slices. Outside engine-host, 19 slices import another feature in production
  code (29 import lines). 16 of them read `vehicle-select`'s `vehicleStore`. The other imports are
  adaptations → module-scan, coding → adaptations, connection → onboarding, history → fault-codes,
  live-charts → live-data and onboarding, sensor-readings → live-data and settings → connection.
  [engine-host.md](./features/engine-host.md#the-composition-rule) and
  [architecture.md](./architecture.md) state the rule as the target and list the current breaks
  instead of claiming it holds. This plan documents and does not refactor; moving `vehicleStore`
  into `src/shared/state` would clear most of them, and is left for plan 07 / a later cleanup.
- _Not fixed: identifier drift in other specs._ The plan asked for an identifier check only in
  `connection.md`. Review extended it to `live-data.md` and `vehicle-info.md` (both fixed above).
  A scan of `docs/features/*.md` for `useX` / `xStore` / `xService` names missing from `src`
  still finds older placeholder names in specs this plan did not touch: `alerts.md`
  (`alertService`, `notificationService`, `useAlertEngine`, `useAlertRules`), `coding.md`
  (`codingService`, `useCodingUnlock`, `useCodingWrite`, `useModuleCoding`), `extended-pids.md`
  (`extendedPidService`, `extendedStore`), `fault-codes.md` (`useClearDtcs`, `useReadiness`),
  `live-charts.md` (`useChartConfig`), `notifications.md` (`useMaintenanceReminders`,
  `useNotificationPermission`, `useNotificationPrefs`), `performance-tests.md`
  (`performanceService`, `usePerformanceHistory`), `sensor-tests.md` (`sensorTestService`,
  `useLiveSensor`, `useMode06`, `useModuleSensors`), `settings.md` (`useAdapterSource`) and
  `vehicle-select.md` (`useSelectedVehicle`, `useVehicleProfiles`). "Doc debt zero" here means
  every slice has a spec and the rule is enforced. These names are left for a later docs pass.

---

## Plan 02 — Log → fixture pipeline (Part A) (2026-11-09)

[Plan 02](./plans/02-on-car-validation.md) Part A landed: any adapter session can become a replay
fixture, committed fixtures run in CI against the real `DiagnosticSession`, and the simulator is
recorded into fixtures for every registry profile. Not done yet: Part B, the on-car sessions
(drive the Golf, Punto and Passat, export one fixture per flow, fill the tables). The procedure is
in [testing.md → Recording results](./testing.md#recording-results).

- **Fixture format** (`transport/logReplay.ts`). `ReplayFixture` gains:
  - `sequences`: every reply per command, kept only for commands whose reply changed;
  - `meta`: `source` (`simulator` | `car`), `vehicleId`, `flow`, `adapter`, `protocol`,
    `appVersion`, `notes`;
  - `expect`: `protocol`, `vin`, `supportedPidCount`, `storedDtcs`, `pendingDtcs`, `milOn`, and
    two additions, `freezeFrameCount` and `storedDtcsAfterClear`.

  `fixtureFromLog(entries, name?, { meta?, keepSequences? })` fills `sequences` by default.
  `ReplayTransport` keeps a per-command cursor over `sequences` (repeating the last reply when
  exhausted), then falls back to `pairs`, then to `OK` / `NO DATA`.

- **Line structure is now kept.** The old log turned every `\r` into a space and trimmed each BLE
  chunk, and `fixtureFromLog` joined chunks with spaces. A multi-ECU reply (the Punto's two `0100`
  lines) or an ISO-TP printout (a CAN VIN) therefore replayed as one line. The parser then read the
  wrong bytes: the F4 phantom-DTC bug, inside the fixture. Now:
  - `logTxText` / `logRxText` (new, in `transport/recordingTransport.ts`) are the single
    normalisation for both `connectionService.withLog` and `RecordingTransport`;
  - rx chunks keep their line breaks as `\r` and are not trimmed;
  - `fixtureFromLog` concatenates a command's chunks as sent, then rebuilds the lines.

  The Settings log view and `formatLogLine` collapse whitespace for display, so the UI looks the
  same. One existing `logReplay.test.ts` expectation changed for this reason, from
  `'SEARCHING... 41 00 …'` to `'SEARCHING...\r41 00 …'`.

- **`RecordingTransport` + `recordSession(inner, run, meta, options?)`**: they record tx/rx in
  order, disconnect in `finally`, and return the fixture. The callback connects the session itself.
- **Simulator fixtures.** `transport/simFixtures.ts` records `connect`, `faults` and `clear` per
  registry profile into `transport/fixtures/<id>/sim-<flow>.json`, 12 files in all, and the files
  are committed. The `expect` block comes from the scenario, not from the recording. Files are
  deterministic: no `createdAt`, no app version.

  `npm run fixtures:sim` runs `scripts/record-sim-fixtures.ts`, which also removes stale `sim-*`
  files, through `scripts/run-ts.cjs`. That is a 30-line runner on the existing `typescript`
  devDependency (`ts.transpileModule` as a `.ts` require hook), so no tsx / ts-node was added.
  `tsconfig.json` (core) now typechecks `scripts/**/*.ts`.

- **Tests.** Suites went from 94 to 100, tests to 750 (after the review fixes).
  - `fixtures.replay.test.ts`: every committed fixture passes `checkReplayFixture`
    (`transport/fixtureCheck.ts`, which returns one message per mismatch). Each fixture's
    `meta.vehicleId` must match its folder, and `sim-` is reserved for `source: 'simulator'`. A car
    fixture must be listed in its doc's table. A permanent test checks that a deliberately wrong
    `expect` is reported, field by field.
  - `sim-fixtures.freshness.test.ts`: the committed files equal a fresh recording (none missing or
    stale). It also checks that the recording is deterministic and that a changed scenario VIN no
    longer matches. Checked by hand as well: editing the Punto calibration ID in `scenarios.ts`
    turned the suite red. Reverted.
  - `recordingTransport.test.ts`: the normalisation, tx/rx order, an identical `SessionInfo` on
    replay for all four profiles (including the multi-ECU Punto and the K-line Passat), a clear
    flow replayed before and after through `sequences`, and disconnect when the flow throws.
  - `logReplay.test.ts`: sequences replayed in order and then repeating the last reply; `pairs`
    still first-wins; BLE chunks split mid-line; a replayed multi-ECU reply still parses as two
    frames; `meta` / `expect` survive a JSON round trip.
  - `fixtureCheck.test.ts`: the shapes a real export has but a simulator recording does not, a
    flow logged after the connect (no `0100`) and a clear flow with two `03` reads before the `04`.
  - `replayExport.test.ts` and `SettingsScreen` tests for the export (simulator, car, wrapped log),
    see below.
- **Settings export.** A **Flow name** field (default `session`) sits next to **Export as replay
  fixture**. `model/replayExport.ts` (pure) builds the fixture and the file name
  `bolid-replay-<vehicleId>-<flow>-<stamp>.json`. `meta` carries:
  - `adapter` and `protocol` from the live session;
  - `appVersion` from `APP_VERSION`;
  - `vehicleId` from the selected profile (`vehicleStore`), or the simulated car in simulator mode.

  On success the copy reads "Saved <file>. Clear the log before recording the next flow."

- **Review fixes.**
  - _Fixtures recorded mid-session._ The session script clears the log before each flow on an
    already-connected session, so only `connect` holds `0100`. `checkReplayFixture` used to call
    `connect()` on every fixture, so every other car fixture would have failed with "no reply to
    0100". It now connects only when the fixture has a `0100` reply (`hasConnectTraffic`).
    Otherwise it attaches the session to the replay transport directly, checks only the
    non-connect expectations, and reports any `protocol` / `vin` / `supportedPidCount`
    expectation on that fixture.
  - _Clear flows with several `03` reads._ `storedDtcsAfterClear` used to read the next `03` in the
    sequence, which is wrong when the Faults screen read `03` more than once before the `04`. The
    checker now calls the new `ReplayTransport.skipToLast('03')` after the `04`, so it checks the
    last recorded answer.
  - _Wrapped adapter log._ The ring buffer counts the entries it overwrites (`dropped`, reset by
    **Clear**, published with the snapshot). When it is above 0, the Settings hint and the saved
    message say the export starts mid-session, and the fixture records `meta.droppedEntries`. The
    session script's `live` flow is now about 30 s (it was 2 minutes, which wraps a 300-line log),
    and testing.md / simulator.md / settings.md mention the 300-line cap. The capacity itself is
    unchanged.
  - _Car branch tested in the screen._ A `SettingsScreen` test exports with
    `adapterSource: 'ble'` and checks `meta.source: 'car'` and the selected profile's id.
  - _The export could not write on a device._ The hook loaded the root `expo-file-system`, which
    on this SDK (56) has no `documentDirectory` and throws for `writeAsStringAsync`. Every export
    therefore returned null, and nothing was logged. The write + share now lives in
    `settings/api/replayFixtureFile.ts` (`saveReplayFixture`). It uses `expo-file-system/legacy`,
    like the sniffer's `captureExport.ts`, and logs a `settings/replay-export` warning on every
    null, including the "no document directory" case. `replayFixtureFile.test.ts` mocks only the
    legacy module, so a root import fails it. `useLogFixtureExport` now only tracks `busy`.
  - _Stale saved message._ The "Saved …" status stayed up until the screen unmounted, so it hid the
    "log is full" warning on the next flow. **Clear** now resets it. The status also remembers the
    `dropped` count at export time, and the warning replaces it as soon as the log wraps further. A
    `SettingsScreen` test covers export → Clear → export → wrap.
  - _Mislabelled exports after a source switch._ The export reads `meta.source` / `vehicleId` /
    `adapter` / `protocol` when **Export** is pressed, but switching the adapter source did not
    clear the log, so a simulator log could be exported as `source: 'car'` (and the reverse).
    `connectionService.switchAdapterSource` now calls `clearAdapterLog()`, and `withLog` takes the
    connect's `stale()` guard so a connect superseded by the switch logs nothing more. Two
    `connectionService.test.ts` cases cover both (the second fails with the guard removed).
  - _Validation rules tested on bad input._ Every doc is still the empty template and no car
    fixture is committed, so the per-vehicle `observedProtocol` and table checks passed without
    checking anything. The rules are now pure functions in `vehicles/validatedOn.ts`
    (`validationFrontMatterProblems`, `validatedOnTableProblems`, `carFixturesFor`, plus
    `parseFrontMatter` moved out of the test), used by the per-vehicle checks and unit-tested on
    synthetic input: wrong protocol, malformed date, one field without the other, an unlisted car
    fixture, a row naming a non-car (`sim-*`) or missing fixture, no section, an empty table.
  - _All eight `expect` fields shown to fail._ The permanent wrong-expectation test now also sets
    a wrong `pendingDtcs`. A second test on the Golf `sim-faults.json` sets a wrong `pendingDtcs`
    and `freezeFrameCount` and checks both messages.

- **Vehicle docs.** The three vehicle docs gain empty `validatedOn:` / `observedProtocol:`
  front-matter and an empty "Validated on the car" table. A new `vehicles/validatedOn.ts` parses
  the table and holds the validation rules (unit-tested on bad input, see the review fixes).
  `vehicle-docs-sync.test.ts` now checks four rules per vehicle doc:
  - a recorded `observedProtocol` equals `expectedProtocol`;
  - `validatedOn` is `YYYY-MM-DD`, and is set together with `observedProtocol`;
  - the table exists;
  - it lists exactly the committed car fixtures, and every listed file exists.

  The front-matter parser now tolerates CRLF.

- **Docs.**
  - [simulator.md → Replay fixtures](./simulator.md#replay-fixtures): format, recorder, where the
    files live, the two tests.
  - [testing.md](./testing.md): `fixtures:sim`, the new automated suites, and "Recording results"
    rewritten as the Part B session script plus the post-session procedure.
  - [vehicles/README.md](./vehicles/README.md): front-matter fields, the table template, and that
    simulator fixtures are not validation.
  - [features/settings.md](./features/settings.md): the export and the log normalisation.

  There is a curated `concept:replay-fixtures` in the context graph, and the roadmap rows
  "On-car validation log" and "Log → fixture pipeline" are ✅ with on-car pending.

**Deviations from the plan.**

- `appVersion` comes from the existing `APP_VERSION` (`shared/lib/appInfo.ts`, added by plan 08,
  read from `app.json`), not `expo-constants`. No new dependency.
- The Settings export sets `meta.source: 'simulator'` (and the simulated car) in simulator mode,
  not always `'car'`, so a simulator session can never pass for validation.
- The line-preserving log normalisation and `fixtureFromLog`'s chunk joining (above) were not in
  the plan, but without them the fixtures could not replay the multi-ECU or ISO-TP answers.
- Fixtures are recorded for all four registry profiles, `generic` included; the acceptance named
  three. Profiles without `knownFaults` seed `P0113` + `P0562` for the DTC flows.
- `expect` gains `freezeFrameCount` and `storedDtcsAfterClear`, so the `faults` and `clear` flows
  assert their own results.
- The "wrong expectation fails" check is a permanent test through `checkReplayFixture`, not a
  one-off edit that is then reverted.
- `sequences` leaves out commands whose reply never changed, which loses nothing because `pairs`
  replays them.
- The TS runner is a small `typescript`-based `scripts/run-ts.cjs` instead of `ts-node` / `tsx`.
- Settings reads `selectedProfileId` from `features/vehicle-select/model/vehicleStore`, a feature →
  feature import. Other features already import that store the same way (extended-pids, coding,
  dpf…); moving it to `shared/state` is left to plan 06 (garage).
- The session script's `live` flow is about 30 s instead of the plan's 2 minutes, so it fits the
  300-line adapter log. Non-connect car fixtures replay without the connect handshake, which the
  plan did not specify.
- `recordSession` does not connect: the callback calls `session.connect()` itself (the plan says
  `recordSession` connects). Only the disconnect is in `finally`. Every caller (`simFixtures.runFlow`,
  the tests) connects first inside the callback.
- The Settings component test replaces `useLogFixtureExport` with a double: Jest cannot run the
  hook's variable-specifier `import()`. The file contents are covered by `replayExport.test.ts`, and the write + share by
  `replayFixtureFile.test.ts`.

---

## Plan 08 — Signed release build, versioning, OTA updates (2026-11-09)

[Plan 08](./plans/08-signed-release-ota.md) landed. Not done yet: the owner-only setup (upload
keystore, four GitHub secrets, `eas init` / `eas update:configure`, `EXPO_TOKEN`) and the first
`v0.2.0` tag. These now sit in a new **Owner actions (deferred)** section of the plan. Until then,
main builds stay debug-signed with a CI warning and `ota-publish` is skipped with a warning. The
procedure is in [release.md](./release.md).

- **`plugins/withReleaseSigning.js`** (registered in `app.json` `plugins`). It edits the generated
  `android/app/build.gradle` at prebuild:
  - adds a `release` signing config, created only when `BOLID_KEYSTORE_PATH` is set, that reads the
    store password, alias and key password from the environment when Gradle runs;
  - points the `release` build type at it only when that variable is set, so it falls back to the
    debug key otherwise;
  - writes `versionCode` from `BOLID_VERSION_CODE`, and sets `expo.android.versionCode` to the
    same value so Expo's own version step agrees whatever order the mods run in.

  A set path whose file is missing, or a missing password, stops the build with a `GradleException`.
  A malformed `BOLID_VERSION_CODE`, or an Expo template that has lost one of the anchors, fails
  prebuild. No secret and no path is ever written into the file. The pure transform
  (`applyReleaseSigning`) is exported for the check script.

- **Checked on this workstation against the real Gradle project.** I ran `expo prebuild` with the
  plugin, then `gradlew :app:signingReport` four times:
  - no env: `Config: debug`, the debug keystore;
  - throwaway test keystore + env: `Config: release`, the test cert;
  - path but no password: fails with "BOLID_KEYSTORE_PASSWORD must be set…";
  - path to a missing file: fails with "…no keystore exists at…".

  The throwaway keystore was deleted afterwards. I re-ran prebuild without `BOLID_VERSION_CODE`, so
  the local `android/` is back to `versionCode 1` with the plugin's block in place. `npm run
android:apk` is unchanged.

- **`scripts/check-signing-plugin.mjs`** runs the plugin against
  `scripts/fixtures/app-build.gradle`, a verbatim copy of the file Expo SDK 56 generates. It checks
  10 things:
  - the env-driven signing config;
  - the conditional release reference, with the debug build type untouched;
  - `versionCode` with and without the variable;
  - that no secret leaks into the file;
  - idempotence;
  - that malformed codes are rejected;
  - that a template change fails loudly;
  - that the real `expo/config-plugins` `appBuildGradle` mod chain gives the same output;
  - that `expo.android.versionCode` is set.

  To prove the script can fail, I removed the release-reference rewrite: 2 checks failed. Reverted.

- **`scripts/check-version-sync.mjs`** checks that `package.json`, `package-lock.json` and
  `app.json` agree on the version. `--tag vX.Y.Z` also checks the tag (CI uses this on tag builds),
  and `--write` syncs app.json while keeping its formatting and CRLF line endings. The new npm
  `version` script (`check-version-sync.mjs --write && git add app.json`) makes `npm version
minor|patch` bump all three in one commit and tag. I checked this end to end in a scratch git
  repo: one commit, three files, tag `v0.2.0`. New script `check:release` runs both checks;
  `npm run ci` now includes it.
- **CI (`ci.yml`):**
  - Triggers add `tags: ['v*']`.
  - `verify` gains the release-config step.
  - `release-android` is renamed `build-android` and runs on `main` and `v*` tags. In order: on tags,
    check that the tag matches the version; restore the keystore; prebuild with `BOLID_VERSION_CODE`
    set to the run number; `assembleRelease bundleRelease`; check `aapt2 dump badging`
    (`versionCode` = run number, `versionName` = version); whenever a keystore was restored, check
    that `apksigner verify --print-certs` succeeds (under `pipefail`, so a failed verification is
    not masked by `tee`), prints a signer certificate, and has no "Android Debug"; upload the artifact
    `android-v<version>-<run>` (`.apk` + `.aab`).
  - `gh release create … --verify-tag --generate-notes` runs **only for tags**. Main pushes no
    longer create `v0.1.0-buildN` releases.
  - New `ota-publish` job (tags, after the build) runs `eas-cli update --branch production`.
  - Validated with the `yaml` parser (all three workflow jobs) and `bash -n` on every `run:` block.
    GitHub Actions itself cannot be run here.
- **OTA:** `eas.json` gives the `preview` and `production` profiles their channels. In `app.json`
  `updates`:
  - `checkAutomatically: "ON_ERROR_RECOVERY"`: no silent launch check. The generated manifest now
    has `EXPO_UPDATES_CHECK_ON_LAUNCH = ERROR_RECOVERY_ONLY`.
  - `requestHeaders: { "expo-channel-name": "production" }`.
- **Settings → About:** shows "Bolid Tester <version>" (new `src/shared/lib/appInfo.ts`, read from
  `app.json`), the OTA note, and a **Privacy policy** button that expands the policy in place. The
  text is in `src/features/settings/model/privacyPolicy.ts`, and the same text is published as
  [privacy-policy.md](./privacy-policy.md). It covers:
  - what stays on the phone;
  - the three network destinations: the AI server, including that the VIN is sent; the Expo update
    server, including the installation ID and the error-recovery check; the browser web search;
  - permissions, exports, deleting data, and contact.
- **Tests (+2 suites, +9 tests):**
  - `appInfo.test.ts`: app.json = package.json version; the `appVersion` runtime policy,
    `ON_ERROR_RECOVERY`, the channel header and the plugin registration; the `eas.json` channels.
  - `privacyPolicy.test.ts`: the in-app headings equal the doc's, in order; every in-app paragraph
    appears verbatim in the doc; the date matches; every network destination is named.
  - A new test in the existing Settings component suite: About shows the version, and the policy
    expands and collapses.

  `check-signing-plugin.mjs` and `check-version-sync.mjs` run outside Jest, through
  `npm run check:release`.

- **Docs:** new [release.md](./release.md) (versions, cutting a release, what CI does, signing,
  OTA channels and hotfixes, rollback, owner setup, acceptance checks) and
  [privacy-policy.md](./privacy-policy.md). Also updated: the README "Releases" section, the docs
  index, [testing.md](./testing.md) (`check:release`), [settings](./features/settings.md) (About),
  and the android-apk skill note on signing.

**Deviations from the plan**

- **No secrets in step `if:`.** GitHub Actions does not allow `secrets.*` in a step `if:`, so the
  keystore step decides in shell. It also does not pass `BOLID_KEYSTORE_PATH` unconditionally as
  the plan's YAML did: that would point Gradle at a missing file on a main build with no secret.
  Instead the step exports the variable via `$GITHUB_ENV` only after decoding the file. Without the
  secret, a tag build fails at that step and a main build warns and stays debug-signed.
- **Gradle block differs from the plan's snippet.** The plan's regex
  `release \{\s*\n(\s*)signingConfig signingConfigs\.debug` does not match the SDK 56 template:
  two comment lines sit between `release {` and `signingConfig`. The plugin instead finds the
  `signingConfig` line inside `buildTypes` → `release`. It also uses a marker comment for
  idempotence, creates the release config only when the variable is set, adds the fail-loud
  checks, and sets `expo.android.versionCode` as well as rewriting the gradle line.
- **Signature check only when a keystore was restored.** "Verify signature" runs only then, because
  a keystore-less main build is debug-signed by design. A `versionCode` / `versionName` badging
  check was added (from the Acceptance list).
- **Channel header (addition).** `app.json` `updates.requestHeaders` sets the `production` channel,
  because the CI APK is built by Gradle and not by EAS Build, so the `eas.json` channels do not
  reach it.
- **OTA skip.** `ota-publish` skips with a warning, rather than failing, while `EXPO_TOKEN` or the
  EAS project id is missing. Only the keystore is a hard requirement for a tag.
- **Privacy policy shown in the app.** "Link it from Settings → About" became an in-app expandable
  policy plus the doc, with no external link. There is no hosted copy yet (plan 30), and the repo
  URL may not be public. The policy says "uninstall, or Android Settings → Storage → Clear storage"
  for deleting data. **Plan 07 must update both copies** when it adds Settings → Reset all app data.
- **`npm run ci` runs `check:release`.** The plan asked only for the CI `verify` job. Both
  `npm run ci` and that job now run it.

**Skipped:** owner steps 3 and 5 (keystore, secrets, `eas init` / `eas update:configure`, the
`0.2.0` bump and tag; the v0.2 items are not all in). I did not run them, by rule.

**Review fixes**

- Privacy policy (both copies): Search the web also sends the selected car's name
  (`dtcWebSearchUrl(code, vehicleName)`), and the policy now says so.
- `ci.yml` "Verify release signature": added `set -o pipefail`. Without it, the default `bash -e`
  took the exit status from `tee`, so a failed `apksigner verify` passed. The step also requires a
  `Signer #1 certificate` line. It cannot match a specific upload-key fingerprint until the owner
  creates the keystore.
- `release.md` rollback: `npm version patch` on the previous tag recomputes the bad release's
  version, and that tag already exists. The doc now uses an explicit higher version
  (`npm version 0.2.2` after a bad `v0.2.1`).

---

## Plan 10 — Component tests and an end-to-end smoke flow (2026-11-08)

[Plan 10](./plans/10-component-e2e-tests.md) landed. The only part not exercised yet is the first
Maestro run, so that acceptance item moved to a new **Owner actions** section of the plan (see the
deviations). The workstation has the Android emulator and an AVD; what is missing is the Maestro
CLI (not installed), an APK built for the emulator, and a dispatch of `e2e.yml` (needs the branch
pushed). Details in [testing.md](./testing.md#end-to-end).

- **Jest, two projects** (`jest.config.js`): `core` (ts-jest, Node, `*.test.ts`, unchanged
  behaviour) and `ui` (`jest-expo` preset, `*.test.tsx`, roots `src/` + `test/`,
  `jest.setup.ui.ts`). Scripts `test:core` / `test:ui`; `npm test` and `npm run ci` run both.
  Dev dependencies: `jest-expo ~56.0.6` (via `npx expo install`), `@react-native/jest-preset
0.85.3` (jest-expo 56's peer: RN 0.85 moved its preset out of `react-native`),
  `@testing-library/react-native ^13.3.3`, `react-test-renderer 19.2.3` (= `react`), and
  `react-refresh 0.18.0`. The last one is not a test dependency: installing under
  `--legacy-peer-deps` regenerated the lockfile without the 26 auto-installed peer packages, and
  `react-refresh` is a required peer of `babel-preset-expo` (it loads `react-refresh/babel` whenever
  Metro bundles in dev with Fast Refresh). Without it `npm start` / `npm run android` could not
  bundle after a clean install; Jest and release bundles were unaffected, so CI stayed green. It is
  now an explicit devDependency, at the version the old lockfile had. The other dropped peers
  (reanimated, gesture-handler, worklets, framer-motion) are optional at runtime.
- **Tamagui renders under jest-expo with no shim.** `babel.config.js` skips the
  `@tamagui/babel-plugin` compiler when `NODE_ENV === 'test'`. Decision recorded in
  [testing.md](./testing.md#component-tests).
- **Harness:** `jest.setup.ui.ts` mocks `react-native-ble-plx` (radio `PoweredOn`), the BLE
  permission helper (granted), `expo-file-system` + `/legacy` (in-memory `Map`), `expo-sharing`,
  `expo-notifications`, `expo-haptics`, `expo-location`, `expo-secure-store`, `expo-updates`
  (`isEnabled: false`), `expo-router` and `react-native-safe-area-context`. It resets stores before
  each test, then unmounts and closes any live simulator session after it. `test/`
  (alias `@test/*`): `renderWithProviders`, `connectSimulator` (the real `connectionService.connect()`
  against `MockTransport`), `resetStores`, `mocks/router.ts` (`mockPush`, `setMockSearchParams`, a
  stand-in `Tabs`), `mocks/fileSystem.ts`.
- **Suites (8, 24 tests):** one per tab screen (Connection, VehicleSelect, Dashboard, FaultCodes,
  VehicleInfo, Settings, More) plus `test/app/RootLayout.test.tsx` (seven tab titles in order; every
  `src/app` route file registered). The Faults suite reads two simulator-injected codes (both rows
  and both descriptions), toggles the
  guide and runs the full **Clear codes** → confirm → empty re-read path.
- **Proved once:** removing `title: 'Faults'` from `_layout.tsx` fails the layout suite (the tab
  falls back to the route name `faults`); pointing `useDtcs` at a missing store module fails the
  Faults suite. Both reverted.
- **App change:** the More screen's rows (and **Check for updates**) gain `accessible`, so each is
  one accessibility element with its "Title. Subtitle" label. That is what makes
  `getByRole('button', { name })` reach them, and the start of the accessibility pass (plan 20).
  No rendering bugs turned up in the seven screens.
- **Typecheck / lint:** `tsconfig.app.json` adds `jest` to `types`, includes `test/**` and
  `jest.setup.ui.ts`, and maps `@test/*`. `npm run lint` / `format` also cover `test/` and the
  setup file.
- **E2E:** `.maestro/simulator-smoke.yaml` (fresh install → Settings → **Simulator (no car)** →
  **P0299** → Connect → **Connect to simulator** → Connected → Faults → **P0299** → **Clear codes**
  → confirm → **Stored (0)**) and `.github/workflows/e2e.yml` (manual dispatch + nightly cron, API 34
  x86_64 emulator via `reactivecircus/android-emulator-runner@v2`, JUnit report artifact; not a
  required check). Both are YAML-valid; the first run is pending (see above). CI's test step is renamed
  "Test (core + component)".
- **Numbers:** 668 tests / 92 suites (core 644 / 84, ui 24 / 8). The `ui` project adds about 10 s
  on a warm cache and about 30 s cold, well under the 2-minute budget.

Deviations from the plan:

- **Tamagui buttons are pressed by text, not by role.** Tamagui `Button` renders a `role="button"`
  view without `accessible`, so Testing Library's `getByRole` does not see it. Tests use `getByText`;
  `getByRole` is used where the control is an accessibility element (More rows, gauges as
  `progressbar`). Making every button accessible is plan 20's job.
- **`modulePaths: ['<rootDir>/node_modules/expo/node_modules']`** in the `ui` project: npm nests
  `expo-modules-core` under `expo/`, and jest-expo's setup requires it by name.
- **The layout test lives in `test/app/`**, not `src/app/`: expo-router would treat a `*.test.tsx`
  there as a route. `EngineHost` and `AppSplash` are mocked in that one file.
- **Plan-07-dependent cases skipped:** Settings' collapsed Developer section and the More search
  filter do not exist yet (plan 07). The Settings suite checks instead that the simulator sections
  (Simulated vehicle, Injected DTCs, Developer (simulator)) appear only in simulator mode. The
  Maestro flow omits the `Developer & simulator` tap.
- **Maestro flow adjusted to the real UI:** a successful connect navigates to Vehicle, so the flow
  goes back to the Connect tab before `assertVisible: 'Connected'`. It confirms the clear with a
  case-insensitive `(?i)clear` (Android can upper-case dialog buttons), asserts `Stored \(0\)`
  rather than `None`, and dismisses a first-launch notification prompt if one shows.
- **E2E builds a release-variant APK** (`assembleRelease`, debug-signed by prebuild, x86_64 only)
  instead of `assembleDebug`. The debug variant is an expo-dev-client build that loads JS from
  Metro, so it cannot run the flow without a dev server.
- **Store reset is by snapshot:** `resetStores` captures each store's state at module load and
  restores it with `setState(initial, true)`, instead of hand-written initial objects.
- **First e2e run moved to Owner actions** (review fix): installing the Maestro CLI and pushing to
  dispatch `e2e.yml` are outside an implementing session, so the acceptance item now carries a
  step-by-step procedure in the plan; the roadmap row reads "first Maestro run pending (owner)" and
  the plans README lists it as plan 10's owner part.
- **Pending persist writes are cancelled on reset** (review fix): restoring a store on
  `debouncedStorage` (history, dashboard layout) scheduled a flush that landed in the emptied
  filesystem during the next test and left an open timer after the last one
  (`--detectOpenHandles`). `resetStores` now calls `persist.clearStorage()` on every persisted
  store (its `removeItem` cancels the pending flush) before emptying the files, and
  `jest.setup.ui.ts` runs the same `cancelPendingWrites()` in `afterAll`. `--detectOpenHandles` is
  clean.

---

## Plan 05 — DTC database and the DTC detail sheet (2026-11-08)

[Plan 05](./plans/05-dtc-database.md) landed; only the Fiat P1 texts moved to a new **Deferred until
an on-car session** section of the plan (see the deviations). The data
files under `dtcDatabase/generic/` and `manufacturer/` were written beforehand by parallel
data-entry agents; this change builds the module around them.

- **Core (pure):** new `obd-core/obd/dtcDatabase/index.ts` — `DtcMake`, `DtcSeverity`,
  `DtcSystem`, `DtcInfo`, the exported SAE range table `DTC_RANGES` (longest-prefix match,
  `subsystemForCode`), `isManufacturerSpecific` (P1xxx, P3000–P33FF, B1/B2, C1/C2, U1/U2), the
  ordered `DTC_SEVERITY_RULES` (10 rules), `lookupDtc(code, make = 'generic')` and
  `describeDtc(code, make?)`; the module header carries the sourcing rules. Fallback text is
  `<System> — <subsystem> fault (<code>)`. `generic/p0.ts` / `generic/p2.ts` compose the part
  files (`P0_PARTS`, `P2_PARTS`). `manufacturer/vag.ts` is the single VAG home: re-exports
  `VAG_P1`, holds the native KWP 5-digit `VAG_DTC_TEXTS` moved from `uds/vagDtcs.ts`,
  `vagNativeDtcText()` (alias `vagDtcText`, native table only) and `saeCodeForVagCode()`;
  `uds/vagDtcs.ts` is now a compatibility re-export. `obd/dtc.ts` drops the 21-entry
  `DTC_DICTIONARY`, re-exports the database and gains `toDtc(code, make?)`. `udsModule` describes
  every UDS DTC with `describeDtc(sae, 'vag')` only (see the review fixes below).
  `aiDiagnosis.ts`: `DiagnosisOptions { focusCode }`, `focusInstruction()`,
  `buildDiagnosisMessages(s, { focusCode })` appends the focus user message,
  `localHeuristicReport(s, { focusCode })` lists the focused code first (or explains it when it is
  not in the read).
- **Data:** P0 1 333 codes, P2 694, P34xx 98, U0 271, B0 10, C0 10, VAG P1 157, VAG native
  5-digit 14, Fiat 0. Module source about 183 KB (budget 350 KB); largest file 520 lines.
- **Bundle delta:** `npx expo export --platform android`, Hermes bundle: HEAD `afe8e13`
  7 617 756 B → this change 7 809 759 B, **+192 003 B (+187.5 KB, +2.5 %)** for the whole plan
  (database, detail sheet, AI focus). Measured from a `git archive HEAD` copy sharing
  `node_modules`, so both builds use the same dependencies.
- **Profiles:** `VehicleProfile.make?: DtcMake`; Golf and Passat `'vag'`, Punto `'fiat'`, generic
  unset. `dtcService.readAll()` re-describes every list with `describeForMake(list, profile.make)`;
  the AI snapshot (`diagnoseService.gatherSnapshot`) does the same.
- **Feature UI:** new `fault-codes/ui/DtcDetailSheet.tsx` (Tamagui `Sheet`, modal, 85 % snap) with
  its pure view model `model/dtcDetail.ts` (`SEVERITY_META`, `buildDtcDetail`, `dtcWebSearchUrl`,
  `dtcShareMessage`, footer text); tapping the code / description in `DtcRow` opens it, the inline
  **Guide** stays. The guide links and per-code freeze frame moved into `ui/DtcGuideParts.tsx`,
  shared by the row and the sheet. Actions: **Explain with AI** →
  `/ai-diagnose?focus=<code>`, **Search the web**, **Share**. `AiDiagnoseScreen` reads `focus`,
  shows a focus card (make-aware, `useAiDiagnose().make`), auto-runs once when connected **and the
  screen is focused** (`useIsFocused()`), then consumes the param on its own route
  (`useNavigation().setParams({ focus: undefined })`) so a later "Explain with AI" on the same code
  runs again (the screen is a hidden tab and stays mounted). Review fix: the first version used the
  global `router.setParams`, which acts on whichever route is focused, and had no focus gate — a
  reconnect on the Connect tab started the run in the background, the param was cleared on Connect
  instead, and the focus card stuck and a repeat "Explain with AI" on the same code did nothing. The main button is then
  **Run full diagnosis** (unfocused); the report's **Re-run** repeats the report's own focus.
  `useAiDiagnose().run({ focusCode })`, `aiDiagnoseStore.focusCode`. `VehicleContext.make` carries
  the profile's make, so the local report's note for a focused code not in the read uses the same
  VAG / Fiat text as the detail sheet.
- **Simulator:** no new commands (the database is pure lookup); the existing Custom… injector
  from plan 01 drives the QA set.
- **Tests:** `dtcDatabase.test.ts` (20: coverage floors, part composition, key format and
  uniqueness across every file, family per file, native 5-digit table shape, size budget
  and line limit, spot checks, severity rules incl. every rule reachable, make handling, J2012
  manufacturer ranges, fallback text, malformed input, range table coverage, `dtc.ts` wiring,
  native table kept separate from the SAE space, TDI systems resolve from generic codes, `fiat`
  make wiring with a seeded entry, P0B / P0C hybrid fallback), `tp20Scan.test.ts` (+native text for
  the seeded comfort faults),
  `aiDiagnosis.test.ts` (+5 focused run, incl. make-aware note), `fault-codes/api/dtcService.test.ts`
  (4, against the simulator: VAG text for `P1557` on the Golf, range text on generic, the
  `P0135,P0301,U0121` QA set), `fault-codes/model/dtcDetail.test.ts` (5), `udsModule.test.ts`
  (UDS descriptions never use a colliding native KWP text: `P0520`/`P0522` read as oil pressure),
  `scanReport.test.ts` (+1 native KWP text in the TP2.0 block). `dtc.test.ts` unchanged and green.
  Suite **607 → 644 tests** (81 → 84 suites).
- **Docs:** `features/fault-codes.md` ("DTC database", "Detail sheet", behaviour, acceptance),
  `obd2-reference.md` § DTC encoding (pointer + J2012 range table), `features/ai-diagnose.md`
  ("Focused run"), `vehicles/README.md` (`make`), `roadmap.md` (both v0.3 rows ✅); context graph
  rebuilt with a `dtc-database` concept.

**Deviations from the plan:**

- **P0 coverage floor is 1 300, not 1 400.** The accurate P0 data holds 1 333 codes (uncertain
  assignments omitted on purpose), so the floor is the actual count rounded down to 50. P2 (≥ 600)
  and U0 (≥ 250) keep the plan's floors.
- **Fiat pack is empty — moved to a Deferred section (review fix).** No Fiat / FGA P1xxx
  definition could be stated with confidence (meanings differ between Marelli IAW and Bosch
  EDC16/17), so `FIAT_P1` is `{}` instead of the ~60 most common; Punto P1 codes show the range
  text. A guessed manufacturer text is worse than the honest fallback, so the data entry stays out;
  to keep the "nothing blocks on the car" rule, plan 05 now ends with a **Deferred until an on-car
  session** section (Multiecuscan procedure) and the plans README row names it. The `'fiat'` make
  wiring is tested with a seeded test-only entry (`dtcDatabase.test.ts`). The roadmap row says so.
- **P0B00–P0CFF have no entries (review fix: headers corrected).** `p0-part4.ts` holds P0A00–P0AFF
  only; its header and `p0.ts` used to claim P0A00–P0CFF. P0Bxx / P0Cxx codes show
  `Powertrain — Hybrid propulsion fault (<code>)`, P0Bxx with the plan's hybrid severity (high);
  a test pins the fallback. This is the main reason P0 holds 1 333 codes, not 1 400.
- **Native texts for the Golf simulator's TP2.0 faults (review fix).** The acceptance item "module
  scan (Golf simulator) VAG codes still show VAG text" could not be seen in the simulator: none of
  its module faults had a VAG text. `VAG_DTC_TEXTS` gained `00928` (locking module, front driver
  side, F220) and `01330` (central control module for central convenience, J393), the comfort
  module's seeded faults; `tp20Scan.test.ts` checks both resolve and `scanReport.test.ts` shows the
  text in the Auto-Scan block. The UDS modules' SAE codes keep their generic text by design.
- **P0 and P2 are composed from part files** (`p0-part1…4.ts`, `p2-part1…2.ts`) rather than one
  file each; `p0.ts` / `p2.ts` merge them and the test checks for overlap.
- **VAG P1 data lives in `manufacturer/vag-p1.ts`**, re-exported by `manufacturer/vag.ts`, which
  also holds the native KWP 5-digit table.
- **The VAG 5-digit table is native KWP only (review fix, blocker).** The texts carried over from
  HEAD's `uds/vagDtcs.ts` are native KWP1281/KWP2000 component numbers (00532 Supply voltage B+,
  01312 Powertrain data bus, …). Read as SAE bytes on the UDS path they collided with standardized
  P0 faults — 11 of 13 with a different meaning, worst `01312` = `P0520` and `01314` = `P0522`
  (oil pressure, high severity) shown as "Powertrain data bus — defective" / "Engine control
  module — no communication". Fix: `udsModule` no longer consults the table (`describeDtc(sae,
'vag')` only); the table is used for TP2.0 KWP `0x18` faults, now shown with their component
  text on the module-scan screen and in the Auto-Scan report (`vagNativeDtcText`); no fall-through
  from a 5-digit number into `VAG_P1`. `00564` (a P0234 byte form, not a native number) and
  `05463` are gone; `65535` stays because raw 0xFFFF is a real KWP answer. Texts were trimmed to
  the component (VCDS reports the failure type separately), e.g. `00532` "Supply voltage B+",
  `01299` "Diagnostic interface for data bus (J533)".
- **VAG P1 pack is the shared ME7 / EDC15-16 list, not TDI-first (review note).** The plan asked to
  start with glow plug, EGR, boost, DPF, swirl flap and G-sensor P1 codes. On EDC16/EDC17 those
  systems report generic SAE codes (glow plugs P0380–P0384 / P0670–P0684, DPF P2002/P2003, P242F,
  P2452–P2459, P2463, swirl / intake-manifold flaps P2008–P2025, EGR P0400–P0409), which resolve
  from `generic/` — a test checks they do. The TDI P1 codes shared with EDC15/16 (boost
  P1555–P1557, EGR P1400–P1408, now also `P1403` control deviation) are in the pack. Missing
  `P242F` (DPF ash accumulation) was added to `generic/p2-part1.ts`. `P2460`–`P2462` stay out: their
  J2012 wording could not be stated with confidence (uncertain codes are omitted, not guessed).
- **P3 ranges follow J2012 precisely:** P3000–P33FF manufacturer-controlled, P3400–P34FF generic
  (cylinder deactivation), P3500–P3FFF reserved and treated as generic (not manufacturer-specific).
  B2/C2/U2 also count as manufacturer-specific (J2012), not only B1/C1/U1.
- **Severity table extras:** the DPF class is `P2002`/`P2003`, `P242F` and `P2452`–`P2463`; the
  lost-communication rule covers `U0100`–`U01FF` (the plan's "U0100–U0199" read as the U01xx
  block). Rules apply whether or not the code has an entry.
- **VAG 5-digit number** in the sheet header shows for VAG and generic profiles and is hidden for
  Fiat (the plan said "when `vagCodeForDtc(code)` is non-empty", which is every P code).
- **"Copy" action is labelled "Share"** — it opens `Share.share` (no clipboard module installed),
  where the user can copy.
- **`diagnoseService.run({ focusCode })` does not exist;** the focus is threaded as
  `useAiDiagnose().run({ focusCode })` → `analyze(snapshot, onAnalyzing, { focusCode })`. The AI
  snapshot is also make-aware (not in the plan; same rule as the Faults screen).
- **Camshaft labels** `P000A`–`P000D` use J2012's `A Camshaft` / `B Camshaft` (A = intake / left /
  front, B = exhaust / right / rear), matching `P0010`–`P0025` (review fix).
- The settings **Custom…** input already existed (plan 01), so nothing was added there.
- Prettier was run on every file this change touched, so the Golf and Passat profiles (not
  Prettier-clean before) were reformatted along with their one `make` line; no content change.

---

## Plan 03 — Bus sniffer: save and share captures (2026-11-08)

[Plan 03](./plans/03-sniffer-capture.md) landed (everything above its "Deferred until an on-car
session" section; the VCDS recording and BLE throughput measurement are on-car pending).

- **Core (pure):** new `obd-core/obd/captureBuffer.ts` — `CapturedLine { t, raw, frame }` and
  `CaptureBuffer` (O(1) ring, default capacity `DEFAULT_CAPTURE_CAPACITY` = 20 000, `size`,
  `dropped`, chronological `lines()`, `clear()`; unparsed lines kept with `frame: null`).
  `canMonitor.ts` gained `CaptureHeader`, `formatCaptureCsv` (`# key: value` header, then
  `t_ms,id,dlc,bytes`, one row per frame, relative `t_ms`, upper hex, trailing `# raw:` block for
  unparsed lines) and `formatCaptureRaw` (header + one `t_ms<TAB>line` per input). Both exported
  from `obd-core/index.ts`.
- **Feature:** `snifferStore` gained `capturedLines`, `dropped`, `note`, `lastExportUri`,
  `setCapture`, `setNote`, `setLastExportUri` (`reset()` keeps the note). New
  `model/captureSession.ts` (module-level current capture), `api/captureExport.ts`
  (`buildCaptureHeader`, `captureFileName` → `bolid-sniff-<vehicleId>-<stamp>.csv|.txt`,
  `buildCaptureFile`, `shareCaptureFile`) and `hooks/useSnifferExport.ts`. The run lifecycle moved
  out of the hook into `model/snifferController.ts` (`SnifferController`, one per session:
  `start` / `stop` / `dispose`; `finishedCapture()`), so it is unit-tested in node. Start clears
  the capture and freezes a `CaptureContext` (vehicle id, session info, device name, note) in
  `captureSession.ts`, which the header is built from at Share time — so changing the car,
  reconnecting or editing the note after Stop cannot rewrite the file. Every line goes into the
  capture, counts are published in the 500 ms snapshot, export is refused while running or empty,
  and dispose (unmount / session change) stops `ATMA` and marks the run finished — also when it
  lands during the `ATH1` round trip before the monitor exists (the controller stops the monitor
  once setup returns and never creates the snapshot interval); Stop pressed mid-setup waits for it.
  `useSniffer` is now a thin binding. `SnifferScreen`: note input above Start (read-only while
  running), `captured N · dropped M`, **Share CSV** / **Share raw** (disabled while running) with
  a one-line explanation and the saved file name; a finished capture can also be shared while
  disconnected (Start is replaced by "Not connected — reconnect to start a new run."); the per-id
  table is unchanged.
- **Simulator:** the Golf scenario's `monitorFrames` is now 30 frames across 4 ids (TP2.0 channel
  setup `200`→`201`, tester session `7E0`→`7E8`) via a new `SIM_MONITOR_FRAMES` map in
  `transport/scenarios.ts`; other profiles unchanged.
- **Tests:** `captureBuffer.test.ts` (7: capacity eviction, order, unparsed lines, 25 000 lines,
  copy + `clear`), `canMonitor.test.ts` (+4: header lines, rows, relative `t_ms`, hex, `# raw:`
  block, raw dump), `sniffer.integration.test.ts` (+2: start → 20 lines → stop → CSV with the
  header and 20 data rows; Golf stream shape), `features/can-sniffer/api/captureExport.test.ts`
  (8: header, file name / MIME, write + share against mocked native modules, failure logged),
  `features/can-sniffer/model/snifferStore.test.ts` (1),
  `features/can-sniffer/model/snifferController.test.ts` (6: Start clears + freezes the header
  context against the simulator, export refused while running / empty, dispose while running
  releases the channel, dispose and Stop during ATMA setup, double Start). Suite **579 → 607
  tests** (77 → 81 suites).
- **Docs:** new `features/can-sniffer.md` (full spec, file formats, memory bound, "Record a VCDS
  session" guide); linked from `features/routines.md` § "Confirming a routine" and
  `features/tp20.md` § "Honest limits"; `simulator.md` (ATMA streaming + Golf frames);
  `roadmap.md` (Sniffer captures ✅, on-car pending). This also covers the `can-sniffer` spec item
  of plan 04.

**Deviations from the plan:**

- The capture buffer lives at module level (`model/captureSession.ts`) instead of a `useRef`, so a
  finished capture can still be shared after the screen is left and reopened (the store counters
  already survived; a ref would have left them pointing at an empty buffer).
- `CaptureHeader` gained an optional `dropped` (written as `# dropped: M`), and the header also
  prints `# lines:` / `# t_ms` explanation lines. Unknown protocol / adapter print as `unknown`; the
  `# note:` line is always present (empty when no note).
- `appVersion` is supported by the formatter but not wired in the app — there is no app-version
  source yet (plan 08 owns versioning).
- The export writes through `expo-file-system/legacy`, not the root `expo-file-system` that
  `useErrorLogExport` imports: on this Expo SDK the root module exports no `documentDirectory`
  and its `writeAsStringAsync` throws (the legacy API moved to `/legacy`). The other existing
  export hooks (error log, DTC report, measuring log, adapter health, chart, module scan, car
  backup) still use the root import, so on a device they most likely return null without
  writing — left for a follow-up, outside this plan.
- Pure export logic sits in `api/captureExport.ts` (unit-tested in node); `useSnifferExport` is a
  thin `busy` wrapper around it rather than a full copy of `useErrorLogExport`.
- The vehicle id comes from `features/vehicle-select/model/vehicleStore` (now imported by
  `model/snifferController.ts`; the existing pattern in `useDpf`, `useCoding`, …), a feature →
  feature import the repo rules discourage; there is no shared selector for it yet. Kept after
  review, consistent with plan 01's decision: moving the store into `shared/state` is a
  cross-cutting refactor (~20 importers; plans 06 / 18 / 32 name its current path) better done
  with plan 07 than inside plan 03.
- The hook-level lifecycle is tested through `SnifferController` rather than by rendering
  `useSniffer`: the jest setup is node-only (`*.test.ts`, no React renderer), and plan 10 owns
  component tests.
- `transport/scenarios.ts` was not run through Prettier (the file was not Prettier-clean before;
  formatting it would rewrite unrelated lines). Same for `routines.md` / `tp20.md`.

---

## Plan 12 — BLE robustness and connection diagnostics (2026-11-08)

[Plan 12](./plans/12-ble-robustness.md) landed (everything above its "Deferred until an on-car
session" section; on-car confirmation pending).

- **Auto-reconnect on by default + flap guard.** `settingsStore` default `autoReconnect: true`;
  persist **version 3**, with plan 01's `migrateSettings` extended by a `fromVersion < 3` step
  (`autoReconnect: p.autoReconnect ?? true` — a stored value survives). New pure
  `connection/api/flapGuard.ts` (`FLAP_WINDOW_MS` 60 s, `MAX_DROPS_PER_WINDOW` 3,
  `shouldAutoReconnect`, `pruneDrops`); `handleUnexpectedDrop()` records each drop and pauses with
  `FLAP_PAUSED_MESSAGE` on the third in a minute; a manual `connect()` resets it.
- **MTU + chunked writes** (`shared/transports/ble/BleTransport.ts`): `requestMTU: 247` only on
  Android (`Platform.OS`), negotiated `device.mtu` read after connect (23 fallback), new
  `linkInfo: BleLinkInfo | null` and `payloadForMtu()`; `write()` sends `mtu - 3` (floor 20) chunks
  in order.
- **Sleep / wake** (`obd-core/elm327/Elm327Client.ts`): `wakeAfterIdleMs` (default 20 000, 0
  disables), `lastIoAt`, `execWake()` (≤ 600 ms, never rejects; a wake timeout starts a drain like a
  command timeout), `init()` stamps after `ATZ`; monitor mode exempt. `connectionService` passes 20 000 for BLE and 0 for the simulator (half the
  scenario's `sleepAfterIdleMs` when it models sleep).
- **Drain-until-prompt**: a timeout starts a drain; `onData` discards the late reply through its
  `>`; the next command awaits it (prompt or `DRAIN_GRACE_MS` = 300 ms).
- **Diagnostics panel**: pure `connection/api/diagnoseFailure.ts` (stages
  `bluetooth | transport | init | probe | identify`, 8 ordered rules, `formatDiagnosticsReport`),
  `ui/ConnectionDiagnostics.tsx` mounted under the error panel on `ConnectionScreen` (stage chip,
  explanation, suggestions, collapsible Details with the attempt's last 20 log lines, link info,
  device, **Copy details** via `Share.share`, **Open error log**), and
  `connection/model/linkStore.ts` (`link`, `stage`, `attemptStartedAt`, `device`).
- **Simulator**: `SimScenario.sleepAfterIdleMs` (low-power model) and
  `MockTransport.dropResponses(n, { includeAt? })`. Settings gained a simulator-only **Developer**
  section — **Simulate a link drop** and **Fail next connect: no reply to ATZ** — through a new
  `connectionService.__sim` hook (`simulateDrop`, `failNextConnect`, `isFailNextConnectArmed`).
  Settings auto-reconnect copy now reads "On by default; pauses after 3 drops in a minute".
- **Tests**: `flapGuard.test.ts`, `diagnoseFailure.test.ts` (one case per rule + fallback + report),
  `BleTransport.test.ts` (39-byte write → 20 + 19 at MTU 23, one write at 247, with-response path,
  `linkInfo`, iOS passes no `requestMTU`, and a 16-byte Golf coding write through an MTU-23 BLE fake
  into the simulator), `Elm327Client.test.ts` (late reply, drain deadline, bare-CR wake, no-wake
  times out, `ATI` wake after an unsafe command, late wake reply drained, `ATI` wake in raw-CAN
  mode, no wake while busy, `isRepeatSafe` incl. raw-CAN), `MockTransport.test.ts` (sleep model,
  `dropResponses`), `connectionService.test.ts` (reconnects after a drop and pauses on the third,
  manual connect resets, spread-out drops never pause, off means off, all attempts failing ends in
  `error` with the last cause, fail-next-connect → stage `init`, a successful connect reaches
  `identify`, no 0100 reply → stage `probe`), `settingsStore.test.ts` (v3, v2 → v3 round-trips). The
  late-reply, wake and late-wake tests fail with the client changes disabled. Suite **527 → 579
  tests** (75 → 77 suites).
- **Docs:** `features/connection.md` (auto-reconnect default + flap guard, MTU/chunking, sleep/wake,
  drain, diagnostics panel + rules, `linkStore`, acceptance), `features/settings.md` (Developer
  section, auto-reconnect copy, v3 migration), `simulator.md` (`sleepAfterIdleMs`, test/dev
  controls), `obd2-reference.md` (bare-CR repeat; "Low power / auto-sleep"),
  `adapter-vgate-icar-pro.md` (quirks + what to confirm on the car), the hardening note in
  `improvement-plan-2026-07.md` marked resolved, `roadmap.md`; the context graph's connection
  concept updated.

**Review fixes (same plan):**

- **K-line rule vs. split notifications.** On BLE each rx log entry is one GATT notification (≤ 20
  bytes at MTU 23), so `UNABLE TO CONNECT` could straddle two entries and rule 6 never fired.
  `diagnoseFailure` now matches the attempt's rx text joined with whitespace removed (test: three
  split variants).
- **Panel showed the wrong device on failure.** `sessionStore.deviceId/deviceName` are only set on
  success (and kept after a drop), so a failed attempt was reported against "unknown" or the
  previous adapter. `linkStore.beginAttempt(stage, device)` now records the attempt's target and
  `ConnectionDiagnostics` reads it from there (`connectionService.test.ts` asserts it after a
  failed connect).
- **Bare-CR wake after an unconfirmed command.** `exec()` set `lastCmd` before the write, so after
  `04` and a swallowed, timed-out `03` the next wake was a bare `\r` and a real ELM327 would repeat
  its remembered `04`. A timeout, a failed write and an unanswered `ATI` wake now reset `lastCmd` to
  null (→ `ATI` wake). A failed write also starts a drain (only while it still owns `pending`).
  Tests: `04` → timed-out `03` → `ATI` wake; failed write → `ATI` wake.
- **Half-sent chunked write.** A chunk failing after earlier ones left a fragment in the ELM327's
  line buffer for the next command to be appended to. `BleTransport.write()` now sends a
  best-effort `LINE_FLUSH` (`X\r`) before rethrowing, so the fragment is rejected with `?`; a bare
  `\r` (the reviewer's suggestion) was not used because it would _execute_ the truncated fragment
  (e.g. a short `2E` write). Tests: flush after a failed second chunk; no flush when the first fails.

**Deviations from the plan:**

- **Wake-up command.** A bare `\r` makes a real ELM327 _repeat the previous command_, so a bare-CR
  wake after a clear (`04`/`14`), a coding write (`2E`), a routine (`31`) or an output test (`2F`)
  would run it again. The client sends a bare `\r` only when `isRepeatSafe(lastCmd)` (reads,
  `3E`, idempotent AT settings/queries) and otherwise — including a fresh connection, where the
  adapter's last command is unknown — wakes with the harmless `ATI`. Because `ATSP0` (init's last
  command) is not repeat-safe, the wake test reads `0100` after `init()` before idling.
- **Simulator wake answer.** With `sleepAfterIdleMs` set, a bare `\r` is answered with `\r>` whether
  the simulated chip is asleep or awake (so a wake never waits out the full 600 ms on an awake
  adapter); without the option the simulator still ignores it. The idle gap counts from the last
  write **or reply** (closer to a real chip than "last write").
- **Test timings.** The plan's 10 ms sleep / 5 ms wake / 20 ms idle are below Windows' ~15 ms timer
  tick (a `setTimeout(0)` reply took 22 ms), so the simulated chip fell asleep between init commands.
  The tests use 120 / 60 / 200 ms (and 1 200 / 300 / 1 300 ms for the `ATI` case, whose swallowed
  wake waits out the 600 ms timeout plus the 300 ms drain). The `MockTransport` sleep-model test uses
  a 400 ms sleep against 60 ms listens and 600 ms idles — a tighter 80 ms threshold was flaky under
  parallel Jest on Windows. The late-reply test sends the first command with a 50 ms timeout and
  the second with the default 1 000 ms (the plan's single 50 ms timeout would time out the second
  command too, at 200 ms latency).
- **Flap guard count.** The plan's message, acceptance ("after three drops in a minute it stops") and
  the Tests line ("false on the 4th") disagree; the guard pauses on the **third** drop inside 60 s,
  matching the message and the acceptance.
- **Classifier details.** Rule 5 ("vehicle isn't responding" → ignition) yields to rule 6 when the
  log also shows `UNABLE TO CONNECT` / `BUS INIT` — a failed K-line start-up ends in the same probe
  error, so in strict first-match order rule 6 could never fire for a connect. The Bluetooth rule
  ignores the simulator and a still-settling (`checking`) radio. The panel feeds the classifier only
  this attempt's log lines (`linkStore.attemptStartedAt`), so an older session's `ATZ` cannot
  mislead it.
- **`linkStore`** also records `attemptStartedAt`, and `link` is captured as soon as the transport
  reports `connected` (not only after `session.connect()` resolves), so a failure during init still
  shows the negotiated MTU. `stage` holds the furthest stage the attempt reached
  (`bluetooth → transport → init → probe → identify`); `DiagnosticSession.connect()` gained an
  optional `onStage` callback (`ConnectProgressStage`) for the last three.
- **Auto-reconnect giving up** ends in `error`, not `disconnected` (the plan has every connection
  failure open the diagnostics panel, which renders only on `error`), and appends the last
  attempt's error to the message.
- **Raw-CAN wake safety.** Not in the plan: while `ATCAF0` is in effect the client treats only AT
  commands as repeat-safe, so a bare-CR wake can never resend a TP2.0 data frame.
- **`MockTransport.dropResponses`** takes `{ includeAt }` (the acceptance's "extend the sim control
  to AT when a flag is set").
- The 16-byte coding-write acceptance test lives in `BleTransport.test.ts` (a BLE fake that
  reassembles writes until `\r` and feeds the Golf simulator), not a separate file.

---

## Plan 01 — Production first-run (2026-11-08)

[Plan 01](./plans/01-production-first-run.md) landed: a fresh install now behaves like a product.

- **Defaults + migration** (`shared/state/settingsStore.ts`): `adapterSource` defaults to `'ble'`,
  `injectedDtcs` to `[]`; persist `version: 2` with the pure, exported `migrateSettings` wired as
  `migrate` — a v1 blob keeps its explicit simulator choice, only missing fields get the new defaults.
  New pure `parseDtcList` backs the Settings **Custom…** DTC injection (first digit limited to
  `0`–`3`, since it is 2 bits on the wire — the plan's `[0-9A-F]{4}` would let `P4135` read back as
  `P0135`).
- **Simulator banner** (`connection/ui/SimulatorBanner.tsx`): amber one-line strip mounted in
  `_layout.tsx` via the `<Tabs screenLayout>` wrapper (inside `RootErrorBoundary`), so every route —
  hidden ones included — shows it under its header (it also shows while a session with device id
  `mock` is live). **Use real adapter** calls the new `connectionService.switchToRealAdapter()`, a
  thin wrapper over `switchAdapterSource(source)`, which the Settings segments use too: it bumps a
  connect epoch so an in-flight simulator connect tears itself down instead of publishing, cancels a
  pending auto-reconnect, resets the session store, flips the source, then closes the old session.
- **First-run card** (`onboarding/model/firstRun.ts` + `ui/FirstRunCard.tsx`): pick car → connect →
  read faults, replacing the `connect-basics` hint on the Connect tab; auto-dismisses (`first-run`)
  when complete. `dtcStore` gained an in-memory `lastReadAt`, stamped only by a real read:
  `dtcService.readAll()` now resolves `null` with no session and `useDtcs` then calls the new
  `clearResults()` (no stamp), so opening Faults while disconnected doesn't tick step 3.
- **Copy:** Connect simulator panel says readings are not from a real car and offers **Use a real
  adapter**; Settings segments renamed **Real adapter (Bluetooth)** / **Simulator (no car)** with a
  helper line.
- **Tests:** `settingsStore.test.ts` (defaults, migration incl. a real persist round-trip of v1 blobs
  through a mocked file system, `parseDtcList`), `firstRun.test.ts`, `connectionService.test.ts`
  (switching tears down a connected and an in-flight simulator session; same-source no-op) and
  `shared/state/dtcStore.test.ts` (`lastReadAt` only on real reads). Suite **504 → 527 tests**
  (71 → 75 suites).
- **Docs:** `features/settings.md`, `features/connection.md` (First run, Simulator banner), new
  `features/onboarding.md`, `features/fault-codes.md` (`dtcStore` location), `phase2-mobile-app.md`,
  root `README.md`; `features/coding.md` no longer claims coding "defaults to the simulator" and
  lists the gates as built.

**Deviations from the plan:** `FirstRunInput` gained a `genericAccepted: boolean` field (the pure
function cannot read the onboarding store, so the `first-run-generic-ok` dismissal is passed in), and
its `connectionStatus` reuses `ConnState` from `sessionStore` (same union). The banner/Connect-screen
switch goes through a new `connectionService.switchToRealAdapter()` instead of inlining
`disconnect()` + `setAdapterSource('ble')` in two places; it also cancels a pending auto-reconnect.
**Use a real adapter** sits under **Connect to simulator** (stacked) rather than beside it, to fit
phone width. The banner is mounted through `<Tabs screenLayout>` rather than as a sibling directly
above `<Tabs>`: a sibling would render above the navigator's header, under the Android edge-to-edge
status bar, whereas `screenLayout` puts it under the header on every route, which is what the plan
asks for. Custom-DTC parsing also drops duplicates and accepts whitespace as a separator.
**Layering:** `dtcStore` (and its test) moved from `features/fault-codes/model/` to
`src/shared/state/dtcStore.ts`, so the first-run card reads it through a shared store instead of
deep-importing another feature (plans/README: "never feature → feature"); EngineHost and
fault-codes now import it from `@/shared/state` too. `FirstRunCard` still deep-imports
`vehicle-select/model/vehicleStore` — kept deliberately: ~20 feature files already import it the
same way, so moving it into `shared/state` is a cross-cutting refactor better done with plan 07
(information architecture) than inside plan 01.

**Coding safety doc:** `features/coding.md` now states the gates that actually exist (CAN +
`codingModules` availability, the in-memory per-session unlock switch, a two-tap Confirm step,
backup-first + verify) in a new "Gates as built today" section, and marks the Settings flag and the
typed confirmation string as target-only, not built. With the real adapter now the default, a real
CAN write on the Golf profile is one switch and two taps away; adding those two gates is open work.

**Known limitation (migration):** v1's `partialize` always wrote `adapterSource` and `injectedDtcs`,
so every real v1 file has them — including installs that never chose anything and merely persisted
the old defaults (`'mock'`, `['P0299']`). As the plan specifies, the migration keeps them, so every
upgraded install stays in simulator mode with P0299 until the user switches (the banner flags it);
only fresh installs get the production defaults. The "v1 blob without an adapter choice" test covers
hand-edited/partial blobs only. Documented in `features/settings.md`.

**Status:** ✅ complete — no on-car part.

---

## Improvement-plan implementation (2026-07-15)

The full [`improvement-plan-2026-07.md`](./improvement-plan-2026-07.md) landed — Phases 1–5, all
ten Phase 6 nice-to-haves minus one deferral, and all ten Phase 6b VCDS-parity items.
Simulator-first, unit-tested; suite grew **309 → 504 tests** (46 → 71 suites), with `typecheck`,
`typecheck:app` and the repo-wide `lint` green.

**Phase 1 — connection correctness:** `Transport.onStatusChange` (BLE + mock, incl.
`simulateDisconnect()`); an unsolicited link drop now flips `sessionStore` to disconnected with an
actionable message; failed connects (e.g. ignition-off probe) tear the half-open transport down;
opt-in **auto-reconnect** with 2/5/10 s backoff (`connection/api/reconnect.ts`).

**Phase 2 — EngineHost:** cross-cutting engines moved out of screen hooks into a headless
`features/engine-host` mounted once in `_layout`: single demand-driven poll loop (union of
screen-acquired PIDs + alert-rule PIDs + trip set), alert evaluation, connection/diagnostic
notifications fed real `milOn`/`dtcCount`, trip sampling. Screen hooks became thin store
subscriptions; double-polling is impossible by construction.

**Phase 3 — multi-ECU parsing:** `ParsedResponse.frames` (one per plain hex line;
`bytes === frames[0]`), per-frame DTC parse + dedupe, OR-merged supported-PID bitmaps, and a
simulator secondary-ECU scenario (Punto engine+TCU) pinning the no-phantom-DTC regression.

**Phase 4 — data lifecycle:** adapter I/O log moved to a module-level ring buffer with a ~4 Hz
throttled publish and rx-pause during ATMA (`state/adapterLog.ts`); trips persist as summaries with
CSV-backed samples (`fromCsv`), CSV delete-on-remove and share; history capped at 200 with
debounced persist (`debouncedStorage`).

**Phase 5 — polish/DX:** AI `apiKey` now lives in the OS keystore (`expo-secure-store`, tolerant
import, one-time migration out of the settings file); a themed root `RootErrorBoundary` logs render
errors to the error log; ESLint covers all of `src/**` with react + react-hooks rules and a
`npm run ci` gate.

**Phase 6 — nice-to-haves:** fuel economy (015E or MAF+speed) on the dashboard + trip stats;
GPS trip tracks (expo-location, tolerant) with GPS-vs-OBD distance/speed; metric/imperial units at
display level; shareable HTML diagnostic report; dashboard gauge customization (per-vehicle,
persisted); adapter health check feature (grade + share); chart tap-inspect, pinch-zoom/pan and
window-CSV share; first-run onboarding hints + a11y labels on shared gauges; EAS Update wiring
('Check for updates' in More). _Deferred: 6.9 Web Bluetooth PWA transport._

**Phase 6b — VCDS parity, next tier:** forum-pasteable Auto-Scan text report; persisted scan
history with before/after diff; DTC search across modules; long-coding per-bit helper with label
names + live old→new preview; one-tap reversible coding tweaks (3 Golf Plus presets, sim-verified);
measuring-block CSV logging in extended-pids; per-profile guided fault finding (DTC → DIDs /
routine / freeze frame); full-car coding+adaptation backup with per-module gated restore;
readiness drive-cycle coach with flip-to-ready notifications; tester-present bus wake before scans.

Per-feature docs updated throughout; `vcds-parity-roadmap.md` status table reflects the landings.

**Status:** ✅ complete — full suite **272 tests** green (16 new), `eslint` 0, core + full-app
`tsc` 0. A code review of the VCDS-parity expansion found four real-hardware gaps the simulator
could not catch; all fixed simulator-first, with the simulator upgraded to REPRODUCE the real
adapter behaviors so the whole test suite now exercises them.

- **ISO-TP multi-frame de-framing** (was P0) — real ELM327s print >7-byte CAN responses as a hex
  length line + `N:`-prefixed segment lines; `parseElmResponse` treated those prefix digits as
  payload hex, garbling module idents, `19 02` DTC lists, `19 04` snapshots and long DIDs on real
  hardware (VIN survived only via its `49 02` marker resync). New
  `responseParser.reassembleIsoTp` strips the prefixes and uses the length line to truncate clone
  padding; `MockTransport.shapeResponse` now prints the real multi-line format on CAN, so every
  integration test exercises the de-framing (datasheet VIN example pinned in unit tests).
- **Addressing restore** (was P0) — `setHeader(null)` used to send bare `ATSH` (invalid on real
  firmware: `?`, old header kept) and `ATCRA` was never cleared, leaving the adapter deaf to
  standard replies after ANY module-scoped work. New `DiagnosticSession.resetAddressing()` —
  protocol-aware functional header (`7DF` 11-bit CAN / `686AF1` ISO 9141 / `C233F1` KWP) + bare
  `ATCRA` — is called in the `finally` of every module path: module-scan, adaptations, routines,
  coding, sensor-tests, service-reset. The simulator now rejects bare `ATSH` and models a stale
  receive filter blocking replies; regression tests pin both directions.
- **NRC 0x78 responsePending** (was P1) — `checkNegative` (deduplicated into `udsCoding`, shared
  by `udsModule`/`guidedRoutine` — was 3 copies) strips repeated `7F <svc> 78` echoes before
  judging a response, so slow operations (forced DPF regen start, security access, clears) no
  longer fail spuriously; pending-only responses throw a distinct 0x78-tagged `UdsError`.
  `securityAccess` retries once after NRC 0x37 (boot lockout) and never retries 0x36.
- **Interlocks fail closed + run continuously** (was P1) — an unreadable RPM/speed now BLOCKS a
  routine instead of silently passing (`requireEngineOff`/`maxSpeedKmh` were fail-open), and
  `useRoutines` re-checks interlocks during the run on the same periodic tick as the keep-alive
  (single interval → deterministic ordering; `checkInterlocksDuringRun` switches to the functional
  address and back), auto-stopping on violation. Spec: [`features/routines.md`](./features/routines.md).

Smaller, from the same review: `Tp20Channel` serializes requests + keep-alive channel tests
through an op queue (the `busy` flag was check-then-act racy — a keep-alive could inject `0xA3`
mid-packet); adaptation values support **signed** (two's-complement) channels; `writeChannel`
enforces min/max bounds at the service layer (was UI-only); the module-scan "skipped" copy now
points at the shipped TP2.0 gateway scan instead of calling it future work.

---

## Phase 5 — Diesel, ownership & screening (5 features)

**Status:** ✅ core + UI built, verified here (full suite **141 tests** green, `eslint` clean, full-app
`tsc -p tsconfig.app.json` **0 errors**). Specs: [`dpf`](./features/dpf.md),
[`used-car-inspection`](./features/used-car-inspection.md), [`battery-health`](./features/battery-health.md),
[`vin-decode`](./features/vin-decode.md), [`maintenance-log`](./features/maintenance-log.md).

Pure, unit-tested core (no hardware):

- `obd-core/obd/vinDecode.ts` (+ test) — `decodeVin` (WMI dictionary, ISO-3780 country, char-10 year
  with the char-7 rule, FMVSS-565 check digit). Verified against the three example VINs + a US case.
- `obd-core/analysis/battery.ts` (+ test) — `analyzeBattery` / `socFromResting` (resting SoC, cranking
  dip, alternator voltage, verdict + notes).
- `obd-core/analysis/dpf.ts` (+ test) — `assessDpf` (soot %, regen status, EGT-driven regen detection).
- `obd-core/analysis/maintenance.ts` (+ test) — `computeDue` / `dueStatus` / `projectOdometer` +
  `DEFAULT_SERVICE_ITEMS` (diesel-biased: timing belt, fuel filter, DPF check).
- `obd-core/analysis/inspection.ts` (+ test) — `assessInspection` incl. the "recently-cleared"
  readiness heuristic. All exported from `obd-core/index.ts`.

Vehicle data:

- Golf TDI profile gains a **diesel/DPF extended-PID pack** (soot mass/%, ash, distance & count since
  regen, EGT, oil temp, EGR), each `experimental` and tagged `category`/`role`; `ExtendedPid` gained
  optional `category`/`role` fields. The simulator auto-seeds every DID from its `sampleResponse`.

Feature slices (feature-sliced, Tamagui) + routes + **More** menu + hidden tabs:

- `features/dpf` — CAN/diesel-gated DPF monitor (status banner + tiles), maps DID `role`s into
  `assessDpf`.
- `features/inspection` — one-tap used-car screening (readiness + DTC 03/07/0A + freeze frame +
  distance-since-clear → verdict).
- `features/battery-health` — `ATRV` voltage capture → `analyzeBattery`.
- `features/vin-decode` — decodes the session VIN or a typed VIN; also linked from **Vehicle info**.
- `features/maintenance` — persisted logbook (`bolid.maintenance`) + due list.

---

## History feature (feature: history)

**Status:** ✅ added. A persistent, file-backed log of every AI auto-diagnose run and every
fault-code check. Spec: [`features/history.md`](./features/history.md).

- `src/shared/state/historyStore.ts` — persisted (expo-file-system, `bolid.history`) zustand store;
  `AiHistoryEntry | DtcHistoryEntry`, `addAiRun` / `addDtcCheck` / `remove` / `clear`; unlimited.
- Recorders: `useAiDiagnose` (AI runs) and `fault-codes/dtcService.readAll` (DTC checks); both use a
  new shared `vehicleLabel()` helper in `shared/vehicles`.
- `src/features/history/` — `HistoryScreen` (All/AI/Faults filter, colour-coded cards, Clear all) +
  `/history` route, hidden tab, and a **More** menu entry.

Also: settings + AI config + selected vehicle now persist across launches (zustand `persist` over the
same file storage); the AI request no longer sends `temperature`; structured output is a 3-way
schema/object/off control with auto-fallback when a server rejects `response_format`.

---

## AI auto-diagnosis (feature: ai-diagnose)

**Status:** ✅ core complete and verified (pure logic unit-tested here; 20 new tests, full core suite
green, lint clean). The RN screen + settings build on a dev machine / EAS like the rest of the app.
Spec: [`features/ai-diagnose.md`](./features/ai-diagnose.md).

One-tap health check: gather a snapshot from the live `DiagnosticSession` (DTCs 03/07/0A, readiness,
freeze frame, and a one-shot poll of the key supported live PIDs), send it to a user-configured
**OpenAI-compatible** server (e.g. a local **LM Studio**), and render a plain-language report. Falls
back to a deterministic on-device rule-based report when the AI is off/unconfigured/unreachable.

Platform-agnostic core (`src/shared/obd-core/analysis/aiDiagnosis.ts`, unit-tested):

- Types `DiagnosticSnapshot` / `AiReport` / `AiFinding` / `AiAction` / `AiClientConfig`.
- `summarizeSnapshot`, `localHeuristicReport` (MIL/DTCs/overheat/fuel-trim/charging/readiness rules).
- `buildDiagnosisMessages`, `buildChatRequestBody`, `extractMessageContent`, `parseAiReport`
  (tolerant of code-fenced/prose-wrapped JSON; falls back to local on any failure),
  `normalizeBaseUrl`, `overallFromFindings`, `KEY_DIAGNOSTIC_PIDS`.

App layer:

- `src/shared/ai/openaiClient.ts` — `chatCompletion` / `listModels` over `fetch` with an
  AbortController timeout and friendly errors (lives in `shared`, no cross-feature deps).
- `src/features/ai-diagnose/*` — store, `diagnoseService` (gather/analyze/clearCodes), `useAiDiagnose`
  hook, and `AiDiagnoseScreen` (overall banner, findings, gated Clear-DTC action, disclaimer).
- Settings → **AI assistant** section (enable, server URL, model + Detect, JSON mode, timeout, Test).
- Routing: `/ai-diagnose` route + hidden tab; entry added to the **More** menu.

Safety: reads + **clear DTCs only** (Mode 04, confirmed); the model only _suggests_ actions from a
fixed enum and never writes coding/service-reset.

---

## Phase 4 — Analysis, performance, sensor tests, coding & notifications

**Status:** ✅ core complete and verified (87 tests pass, lint clean). UI slices built on top of the
tested core; the RN/Tamagui screens compile/run on a dev machine / EAS like the rest of the app.
Specs: [`features/trip-recording`](./features/trip-recording.md), [`live-charts`](./features/live-charts.md),
[`performance-tests`](./features/performance-tests.md), [`alerts`](./features/alerts.md),
[`sensor-tests`](./features/sensor-tests.md), [`coding`](./features/coding.md),
[`notifications`](./features/notifications.md).

Platform-agnostic core (in `src/shared/obd-core`, all unit-tested here):

- `analysis/alerts.ts` — `AlertEngine` (edge detection + hysteresis), `defaultRules`.
- `analysis/performance.ts` — `computeAccelRun` (0–100 + splits), `computeDragRun` (60 ft / ⅛ / ¼
  mile + trap), `computeBrakeRun`, plus `timeToSpeed` / `cumulativeDistance` integration.
- `analysis/trip.ts` — `downsample`, `tripStats` (duration/distance/max), `toCsv` / `toJson`.
- `analysis/chartBuffer.ts` — `ChartBuffer` ring buffer + min/max `decimate` + `seriesStats`.
- `analysis/notifications.ts` — `deriveDiagnosticEvents` (MIL/connection rising edges), quiet-hours
  `filterNotifications`, `dueReminders`.
- `obd/mode06.ts` — `decodeMode06` (on-board monitor test results with pass/fail).
- `coding/coding.ts` — byte/bit helpers, schema decode, `diffCoding`.
- `coding/udsCoding.ts` — UDS sequence (`10/27/22/2E/3E`) and the guarded `codeModule`
  (read→backup→security→write→verify) over an injectable sender.

Engine/profile/simulator extensions:

- `vehicles/types.ts` + the Golf profile gained `mode06Tests`, `moduleSensors` (illustrative ABS
  wheel-speed), and `codingModules` (illustrative BCM coding) — all clearly experimental/unverified.
- `MockTransport` now answers **Mode 06**, **module-scoped UDS 22** (via `ATSH` addressing), and the
  **coding services**; `buildScenario` wires the new profile data through.
- `DiagnosticSession` gained additive `send` / `setHeader` / `setRxFilter` / `readMode06`.
- Integration tests cover Mode 06, an ABS module read, and a full coding backup→write→verify on the
  Golf simulator — all with no hardware.

Follow-up (reachability + Passat): added a visible **More** tab (`src/features/more`) that links to
all the Phase-4 screens (charts, performance, trips, alerts, sensor tests, service reset, coding,
notifications) via expo-router — they were previously hidden routes. Extended **service reset to the
Passat** with a **KWP2000 (K-line)** path: `serviceReset` now branches on `transport: 'uds' | 'kwp'`
(KWP uses `10`/`27`/`31`/`3B`/`21`); the simulator answers the KWP session-start + routine; the
Passat profile carries an illustrative KWP descriptor; UI gating matches the link (CAN for UDS,
K-line for KWP). Tests: 87 passing.

Follow-up (service reset): added a **service-interval reset** ("oil service / SRI reset") — a write
to the instrument cluster via UDS **RoutineControl `31`** or adaptation `2E`, in
`obd-core/coding/udsCoding` (`routineControl`, `serviceReset`) with unit + Golf-simulator integration
tests; `MockTransport` answers RoutineControl; the Golf profile carries an illustrative `serviceReset`
descriptor; a gated `service-reset` feature slice + route. Experimental — extended to the Passat via
KWP2000 in the follow-up above. Spec: [`features/service-reset`](./features/service-reset.md).

UI (feature-sliced, `src/features/*`, each with `model` Zustand store + `hooks` + `ui` screen +
`index`): `alerts`, `live-charts`, `performance-tests`, `trip-recording`, `sensor-tests`, `coding`,
`notifications`; a shared `src/shared/notify` delivers local notifications (dependency-tolerant
wrapper) so features don't depend on each other. New expo-router routes registered (hidden tabs);
`expo-notifications` / `expo-file-system` / `expo-haptics` / `expo-location` / `expo-sharing` added
to `package.json` (install on a dev machine with `npx expo install`).

Verified here: `npm test` (87 passing), `npm run lint` (0 issues). Note: `npm run typecheck` currently
trips on a pre-existing `expo/tsconfig.base` `customConditions` vs `moduleResolution` conflict in the
toolchain (unrelated to this code); ts-jest type-checks the core on every test run.

---

## Phase 3 — Polish (in progress)

Done:

- **Verified the whole app typechecks** against the real RN/Tamagui/`react-native-ble-plx` types
  (`npm run typecheck:app` → 0 errors), not just the core.
- **Readiness monitors** (Mode 01 PID 01) — `src/shared/obd-core/obd/readiness.ts`
  (`decodeMonitorStatus`) + `DiagnosticSession.readReadiness()`, surfaced on the Fault Codes screen
  (MIL state, monitors complete/total, spark/compression ignition, not-ready list).
- **Freeze frame** (Mode 02) — `DiagnosticSession.readFreezeFrame()` + simulator support, shown on the
  Fault Codes screen with the triggering DTC and captured PIDs.
- **CI** — `.github/workflows/ci.yml` runs lint + core typecheck + tests + full-app typecheck on
  every push.

Verified: `npm test` (39 passing, 11 suites), `npm run typecheck` (0), `npm run typecheck:app` (0),
`npm run lint` (0).

Remaining (needs hardware or external accounts):

- On-car validation against the three example cars (checklists in `testing.md`); tune the profiles
  from what the real cars report.
- Log export/share; optional persisted settings (AsyncStorage).
- iOS/Android store or EAS builds + signing (Apple Developer account / Android keystore).

## Phase 2 — Mobile app (Expo + Tamagui + BLE)

**Status:** ✅ code complete. Core stays green here; the RN app compiles/runs on a dev machine /
EAS (native build can't run in the container). See [`phase2-mobile-app.md`](./phase2-mobile-app.md).

Implemented the feature-sliced UI over the tested core:

- `src/shared/transports/ble/BleTransport.ts` — `Transport` over `react-native-ble-plx` with
  **runtime characteristic discovery** (no hard-coded UUIDs); `permissions.ts`, `manager.ts`,
  and a dependency-free `src/shared/lib/base64.ts` (unit-tested) for BLE payloads.
- `src/shared/state/*` — Zustand stores (`sessionStore`, `settingsStore` incl. the adapter I/O log)

## Error log ("logging zone")

**Status:** ✅ code complete; core verified here (`npm test`, `npm run lint`, `npm run typecheck`,
`npm run typecheck:app` all green). See [`features/error-log.md`](./features/error-log.md).

A persistent, capped on-device store of errors, reviewable and **exportable** (Markdown/JSON via the
share sheet) to fix later.

- `src/shared/lib/errorLog.ts` — pure, unit-tested core: `LoggedError` shape, `normalizeError`,
  `buildLoggedError`, and the export renderers (`formatErrorsForExport`, `errorsToJson`).
- `src/shared/state/errorLogStore.ts` — persisted Zustand store (`bolid.errors`, capped at 500) with
  the module-level `logError(...)` convenience and `installGlobalErrorHandlers()` (chains RN
  `ErrorUtils` + web `unhandledrejection`).
- `src/features/error-log/*` — `ErrorLogScreen` (severity filter, expandable stack/context, delete,
  clear, export) + `useErrorLogExport` (dependency-tolerant expo-file-system/expo-sharing). Wired
  into the `connection`, `fault-codes` and `ai-diagnose` catch blocks and reachable from **More**
  (`/error-log`). Partly addresses the earlier "log export/share" remaining item.

## VCDS-parity expansion (2026-07)

A large parity pass toward "do what VCDS does on the VW cars", plus OBD2 gap-fillers. All
simulator-first and unit-tested; app compiles (`typecheck`, `typecheck:app`, `lint` green; full
`npm test` green). New docs under `docs/features/` and a roadmap at
[`vcds-parity-roadmap.md`](./vcds-parity-roadmap.md).

**Passat service reset** — root-caused: the B5.5 instrument cluster speaks **KWP1281**, which a
generic ELM327 cannot address, so the OBD reset returns "No response" ("Failed: No response" on the
car). The profile now carries an honest `obdUnreachable` reason; the screen **leads with the
dash-stalk manual procedure** and demotes the OBD attempt to an explicit "try anyway".
`isModuleUnreachableError` widens error matching (No response / NO DATA / timeout / UNABLE TO
CONNECT / BUS INIT).

**New obd-core modules** (all pure, unit-tested): `uds/udsModule` (0x19 read / 0x14 clear / 0x19 04
snapshot / ident DIDs + status decode), `uds/vagDtcs` (VAG 5-digit dictionary), `uds/guidedRoutine`
(2F/31), `coding/adaptationValue`, `obd/multiPid`, `obd/iupr`, `obd/mode05`, `obd/canMonitor`,
`transport/logReplay`, and the **`tp20/`** stack (framing, `Tp20Channel`, `scanTp20`, an in-memory
`FakeTp20Bus`, `Elm327RawCanLink`, VAG address names).

**New features** (feature-sliced + routes + More entries + docs): `module-scan` (VCDS-style
auto-scan incl. TP2.0 gateway list), `adaptations` (channel browser with label packs), `routines`
(output tests / basic settings with live interlocks), `can-sniffer` (ATMA monitor). Plus:
multi-PID batching in `pollOnce` (CAN), a freeze frame per stored DTC, IUPR in `used-car-inspection`,
Mode 05 in `sensor-tests`, VIN→profile suggestion in `vehicle-select`, and adapter-log→replay-fixture
export in Settings.

**Label packs** (`src/shared/labels/`) — the open equivalent of VCDS label files, keyed by module
part-number prefix.

**Honest limits kept explicit:** the Passat (KWP1281) stays out of module scan / adaptations /
routines; every non-standard address/DID/routine id is badged illustrative; TP2.0 over a generic
ELM327 is documented as timing-sensitive and adapter-dependent.
