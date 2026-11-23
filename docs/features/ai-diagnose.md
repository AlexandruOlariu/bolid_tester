# Feature: ai-diagnose

**One-tap, AI-assisted health check.** Reads the car in one pass, sends a structured snapshot to the
user's chosen AI provider — a **local server** (LM Studio / Ollama), **OpenAI**, **Anthropic** or a
**custom** OpenAI-compatible server (plan 19) — and shows a plain-language report: an overall
verdict, prioritised findings (with the car's own fault guides linked under them), and recommended
actions. The owner can then **ask follow-up questions** about the report in a bounded conversation.
If no provider is configured or it can't be reached, it falls back to a deterministic on-device
rule-based report, so the feature is always useful.

Reachable from the **More** tab (`/ai-diagnose`). Every run is saved to [History](./history.md).

## Scope & safety

- **Reads + clear DTCs only.** The diagnosis reads the engine/emissions ECU (DTCs, readiness,
  freeze frame, live PIDs). The _only_ write it can perform is **clear fault codes (Mode 04)**, and
  that is always behind an explicit confirmation dialog. It never performs coding or service-reset
  writes (see [`coding.md`](./coding.md), [`service-reset.md`](./service-reset.md)).
- **The model only _suggests_.** Recommended actions come from a fixed enum
  (`clear_dtcs | recheck | inspect | monitor | service`); the UI renders only the ones it recognises
  and executes only the gated ones. The model can never trigger an action by itself.
- **Not a mechanic.** Every report carries a disclaimer that it is an aid, not a substitute for
  professional inspection. A generic OBD2 adapter only reaches the engine/emissions ECU.

## UI

- **AiDiagnoseScreen** —
  - **What's wrong?** card (`ui/AgentStartCard.tsx`): a symptom field (300 characters at most,
    placeholder "e.g. pulls weak above 2000 rpm"), **Investigate** (disabled while the field is
    blank, a run is going or no car is connected) and **Check everything** (the old **Run
    diagnosis**). See [Agent](#agent).
  - **Trail** (`ui/AgentTrail.tsx`): "Investigating · step n of 12" with **Stop** for the whole run,
    one row per step (✓ ok, ⚠ error, ✕ the driver could not / refused), the model's one-line "why"
    and the digest behind **Show data**; after the run its header collapses / expands the rows.
  - **Driver prompt** (`ui/DriverPrompt.tsx`) while the run waits for the driver: the instruction,
    "The car must stay stationary." and **Done** / **Can't**.
  - Progress line while _reading the car_ then _asking the model_.
  - **Re-run diagnosis** above the report repeats the last request (symptom or everything, focus
    included).
  - **Overall banner**: `ok` (healthy) / `attention` / `urgent`, colour-coded, with a one-line
    summary and a chip showing whether it came from the **AI** or **on-device rules**.
  - **Findings** — one card per issue: severity (`ok/info/warn/critical`), detail, related DTC
    codes, the **known check for this car** under the codes when a curated fault guide matches (see
    [Guide citations](#guide-citations)), likely causes, "Based on: steps 2, 3" (the agent steps the
    finding cites) and an **Unconfirmed data** chip when it rests only on unconfirmed data. When the
    agent's final report dropped uncited findings, a notice above them says how many.
  - **Recommended actions** — `clear_dtcs` (red, confirm → Mode 04 → a triage-only re-read with the
    "Codes cleared" notice), `recheck` (re-run the last request), and advisory
    `inspect/monitor/service` cards.
  - **Ask about this report** — suggestion chips, a question field + send button, the conversation
    as alternating bubbles (selectable text) and **Clear**. Disabled with a hint for an on-device
    report (see [Follow-up questions](#follow-up-questions)).
  - **Send to Claude / ChatGPT** under the report's actions: a sheet previewing the run as one text,
    **Include VIN** (off) and **Share** through the system share sheet (see
    [Send to Claude / ChatGPT](#send-to-claude--chatgpt)).
  - A **notice** banner explains any fallback (AI off / not configured / no key / unreachable).
- **AiReportView** (`ui/AiReportView.tsx`, exported from the slice's `index.ts`, plan 16) — a saved
  report, read-only: the overall banner, the finding cards (with the car's fault guides), the
  recommended actions as a plain list (no Clear / Re-run buttons — the run is over) and the
  disclaimer with the run time (plus the uncited-findings notice and each finding's cited steps).
  The [History timeline](./history.md) opens it in a sheet when an AI
  row is tapped, passing `onNavigate` (its close) so a fault guide's "Related data" / "Open
  routine" button closes the sheet before it navigates. The screen and the view share `OverallBanner`, `FindingCard` and the action icons
  from that file.

## Focused run ("Explain with AI")

The fault-codes [detail sheet](./fault-codes.md#detail-sheet) opens `/ai-diagnose?focus=<code>`.
`AiDiagnoseScreen` reads the `focus` search param (`useLocalSearchParams<{ focus?: string }>()`),
shows a **Focused on fault code …** card with the code's description (described with the selected
profile's `make`, `useAiDiagnose().make`, so it matches the detail sheet) and, once connected
**and while the screen is in front** (`useIsFocused()`), starts an agent run seeded with that code
as the symptom (`useAiDiagnose().run({ focusCode })` → `{ mode: 'symptom', symptom: code,
focusCode: code }`). The
screen is a hidden tab that stays mounted, so the focus gate stops a reconnect on another tab from
starting the run in the background; the run waits until the user comes back. The param is then
consumed on this route (`useNavigation().setParams({ focus: undefined })` — not the global
`router.setParams`, which would act on whichever route is focused): this is what lets a later
**Explain with AI** — even on the same code — run again. While a focus is
shown **Check everything** still runs unfocused; **Re-run** repeats the last run (focused when it
was), and the focus question comes first among the follow-up suggestions.

- **AI path:** `buildDiagnosisMessages(snapshot, { focusCode })` appends one user message: "Focus on
  fault code P0135: explain it in plain words, likely causes in order of probability, and what to
  check first."
- **Local path:** `localHeuristicReport(snapshot, { focusCode })` lists that code's findings first;
  when the code is not in the current read it adds an `info` finding with the code's description
  (`describeDtc(code, snapshot.vehicle.make)` — `VehicleContext.make` is the profile's make).
- The focused code is kept in `aiDiagnoseStore.focusCode`; the snapshot's DTC descriptions use the
  profile's `make` like the Faults screen.

## Agent

Plan 34a turns the one-shot diagnosis into a **read-only, multi-step agent**
(`src/shared/obd-core/agent/`, spec
[`2026-11-22-ai-agent-diagnose-design.md`](../superpowers/specs/2026-11-22-ai-agent-diagnose-design.md)).
**Investigate** sends the typed symptom (clamped to `MAX_SYMPTOM_CHARS` = 300 and JSON-quoted in the
prompt); **Check everything** asks the model to look over the whole car; **Explain with AI** seeds a
symptom run with the code.

- **Loop** (`loop.ts`, `runAgent`). Step 1 is always **triage** (`triage.ts`): DTCs per the
  profile's modes, readiness, the freeze frame when codes are stored, one poll of the supported key
  PIDs and the adapter voltage, plus every tool that asks to run at triage. Then the model answers
  **one JSON action per turn** (`actionSchema.ts`, the flat action schema; the first balanced object
  is used, and a reply with both `tool` and `final` is invalid). The app validates the arguments,
  runs that one tool, skill or driver prompt and sends the digest back (≤ `MAX_DIGEST_CHARS` =
  1600). The prompt (`prompt.ts`) keeps the last `FULL_DIGESTS` = 3 digests in full and older steps
  as one-line app-written summaries, aiming at the 8k-token context target. The model is told to
  write the report in the app's language (`currentLanguage()`).
- **Budget** (`AGENT_BUDGET`): **12 steps** (triage included), **4 min** of model + adapter wall
  time, **2 min** of adapter time, **3 invalid replies** in a row. Time waiting for the driver counts
  toward none of them; each driver step times out after **3 min** (counted as "Can't").
- **Tools** (all reads, behind `createReadOnlySession`: a read-request allowlist, no
  SecurityAccess, no programming session, never the airbag `15` or immobilizer `25` modules; the
  only monitor access is `listenBus(ms)`, a passive `ATMA` window of at most 10 s on CAN).
  Core: `read_live` (up to 8 Mode 01 PIDs, once or sampled up to 15 s for min / avg / max) and
  `read_dtcs`; built in: `open_skill`, `run_skill`, `ask_driver`. Features add their own through
  an `AgentContribution` (fault-codes adds `read_dtcs_detail`). **Clear codes** is not a tool: it
  stays the report's button behind its confirmation.
- **Skills** (`bolid.skill.v1` JSON files, `skillFile.ts`; the registry in `registry.ts`): a skill
  is a model-facing document (when to use it, which tools, how to read the results). The model
  reads one with `open_skill` and runs its on-device procedure in one step with `run_skill`. The
  first three come from [fault-codes](./fault-codes.md) (`fault_codes`),
  [live-data](./live-data.md) (`live_data`) and [battery-health](./battery-health.md) (`battery`,
  procedure `battery_capture`: 2 s of resting voltage, the restart prompt, 4 s more for the crank
  dip and the charging voltage). The app layer composes them in `src/app/ai-diagnose.tsx`
  (`AGENT_CONTRIBUTIONS`), since features never import each other.
- **Driver steps** (`driver.ts`, `DRIVER_INSTRUCTIONS`): a fixed list (start the engine, engine
  off ignition on, restart, hold 2500 rpm "in Park or Neutral … for 10 seconds", electrical load on
  / off, wiggle a connector, and `smoke_colour` — "what colour is the smoke?" with the choices
  white · blue · black · grey · none, labelled from `aiDiagnose:agent.driverChoice.<value>`; the
  chosen value goes into the step digest as "Driver answered: <value>"). Asked only while the car is
  stationary: refused unless `010D` reads exactly 0 km/h, aborted if the speed rises. The screen's
  answer reaches the run through the driver gate (`api/driverGate.ts`).
- **Stop** aborts the run at once (an open driver prompt settles as "Can't"); the run ends
  `stopped`. A double tap, or a tap while a run is going, starts nothing.
- **Cited report** (`report.ts`, `parseAgentFinal`): every finding cites step ids; a finding citing
  no step, an unknown step or a failed / refused one is dropped and counted in `uncitedDropped`. A
  finding resting only on unconfirmed data is capped at `info` and tagged `unconfirmed`.
- **Fallbacks — never worse than before.** Any other ending (AI off or not configured, the step /
  time / adapter budget, three invalid replies, Stop, an adapter disconnect, an AI error) ends in the
  on-device rule report over everything gathered (`agentRuleReport`) with a notice
  (`aiDiagnose:agent.end.<end>`). With the AI off or not configured, the run first sweeps every
  available skill with a procedure, then gives the rule report (see
  [No-AI mode](#no-ai-mode-plan-34c)). An AI error or a disconnect is logged as an `ai-diagnose`
  warning.
- **After the run**: Re-run repeats the request; Clear codes runs Mode 04, then a triage-only
  re-read (`runTriageOnly`) with the "Codes cleared" notice; follow-up questions read the trail's
  digests (`buildAgentFollowUpMessages`).
- **Mock scripts** (`mock://ai`, development builds): with the agent schema the mock plays a
  script picked from the symptom. The default (Check everything, focus runs, other symptoms) does one
  idle `read_live`, then a final with one `warn` finding per code citing step 1 and an "idle
  readings" finding citing step 2. A symptom with "battery" / "baterie" opens and runs the
  `battery` skill (restart prompt), then a final citing steps 1 and 3. A symptom with "pulls weak",
  "boost" or "turbo" opens and runs the `boost` playbook (the 2500 rpm hold prompt), then a final
  citing steps 1 and 3 with one finding per boost verdict in the step-3 digest, titled
  "Boost check: <id> (mock)" (`ok` when boost was judged and nothing was flagged, none when it was
  not judged). The digest carries the verdict sentences of `assessBoost`, not finding keys, so the
  mock maps each sentence back to its id. With the simulator's **Low boost** scripted fault this is
  `no_boost_hold`; `.maestro/ai-agent.yaml` drives it ([testing.md](../testing.md#end-to-end)).
  `mock:loop` reads rpm forever (exercise **Stop** or the step budget). `mock:invalid` never sends
  JSON (the rule report after three invalid replies).

### Capability skills (plan 34b)

Every feature the agent can read contributes one capability skill (21 in all, the spec's catalog);
`test/app/aiDiagnoseRoute.test.tsx` checks that all 21 are registered as `capability` skills, what
the three built-in cars are offered and that no registered tool name looks like a write. A skill
is offered when its `requires` hold and every tool it names is available on the connected car
(`availableSkills`). The car columns are the built-in profiles on their expected protocol (Golf
and Punto on CAN, Passat on K-line); _adapter_ = only when the adapter can monitor the bus.

| Skill                 | Owner                                           | Tools                                           |  Golf   |  Punto  | Passat |
| --------------------- | ----------------------------------------------- | ----------------------------------------------- | :-----: | :-----: | :----: |
| `fault_codes`         | [fault-codes](./fault-codes.md)                 | `read_dtcs`, `read_dtcs_detail`, `lookup_guide` |   yes   |   yes   |  yes   |
| `module_scan`         | [module-scan](./module-scan.md)                 | `scan_modules`                                  |   yes   |    —    |   —    |
| `live_data`           | [live-data](./live-data.md)                     | `read_live` (core)                              |   yes   |   yes   |  yes   |
| `record_live`         | [live-charts](./live-charts.md)                 | `record_live`                                   |   yes   |   yes   |  yes   |
| `sensor_tests`        | [sensor-tests](./sensor-tests.md)               | `read_mode06`, `wiggle_test`                    |   yes   |    —    |   —    |
| `extended_data`       | [extended-pids](./extended-pids.md)             | `read_extended`                                 |   yes   |    —    |   —    |
| `adaptations_read`    | [adaptations](./adaptations.md)                 | `read_adaptations`                              |   yes   |    —    |  yes   |
| `coding_read`         | [coding](./coding.md)                           | `read_coding`                                   |   yes   |    —    |   —    |
| `dpf`                 | [dpf](./dpf.md)                                 | `read_dpf`                                      |   yes   |    —    |   —    |
| `battery`             | [battery-health](./battery-health.md)           | `run_skill` (`battery_capture`), `ask_driver`   |   yes   |   yes   |  yes   |
| `used_car_check`      | [used-car-inspection](./used-car-inspection.md) | `read_inspection`                               |   yes   |   yes   |  yes   |
| `vehicle_identity`    | [vehicle-info](./vehicle-info.md)               | `read_identity`                                 |   yes   |   yes   |  yes   |
| `adapter_health`      | [adapter-health](./adapter-health.md)           | `check_adapter`                                 |   yes   |   yes   |  yes   |
| `trips`               | [trip-recording](./trip-recording.md)           | `list_trips`, `read_trip`                       |   yes   |   yes   |  yes   |
| `fuel_economy`        | [trip-recording](./trip-recording.md)           | `read_fuel_economy`, `list_trips`               |   yes   |   yes   |  yes   |
| `performance_history` | [performance-tests](./performance-tests.md)     | `read_performance_history`                      |   yes   |   yes   |  yes   |
| `maintenance`         | [maintenance-log](./maintenance-log.md)         | `read_maintenance`                              |   yes   |   yes   |  yes   |
| `history`             | [history](./history.md)                         | `read_history`, `history_compare`               |   yes   |   yes   |  yes   |
| `alerts_history`      | [alerts](./alerts.md)                           | `read_alerts`                                   |   yes   |   yes   |  yes   |
| `app_errors`          | [error-log](./error-log.md)                     | `read_app_errors`                               |   yes   |   yes   |  yes   |
| `bus_listen`          | [can-sniffer](./can-sniffer.md)                 | `listen_bus`                                    | adapter | adapter |   —    |

Why a cell is empty: `module_scan`, `extended_data`, `dpf` and `coding_read` need CAN and the
profile's modules / extended DIDs / coding modules (the Punto declares none, the Passat is K-line;
TP2.0-only modules reach the agent only from the last saved scan, with its date); `sensor_tests` needs the profile's
Mode 06 tests or a Mode 05 sweep (non-diesel K-line), which neither the Punto nor the diesel Passat
has; `adaptations_read` needs the profile's adaptation channels; `bus_listen` needs CAN and a
monitor-capable adapter. Store-backed skills (trips, fuel economy, performance, maintenance,
history, alerts, app errors) are always offered and answer "none recorded" in one line on an empty
store, for the active car only.

### Playbooks (plan 34c)

A **playbook** is a skill for a complaint a driver actually has (`kind: 'playbook'`,
`src/shared/obd-core/agent/playbooks/`, one `<name>.skill.json` each, composed as
`PLAYBOOK_CONTRIBUTION` after the features in `src/app/ai-diagnose.tsx`). Its document tells the
model which capability skills and tools to use and how to read them; ten have an **on-device
procedure** (`procedures.ts`, procedure id = playbook name) that the model runs in one step with
`run_skill`. Playbooks name only built-in and core tools (`run_skill`, `ask_driver`, `read_live`,
`read_dtcs`), so the registry accepts them with or without the features; a playbook that needs a
feature says so in `requires.skills`, and a procedure reaches a feature tool only when the car is
offered it (`ProcedureContext.hasTool` / `hasSkill`). Every procedure is read-only: no forced
regeneration, output test or basic setting, and **Clear codes** stays the report's button.

| Playbook              | Procedure                                                                                                          | `requires`                                  | Golf | Punto | Passat |
| --------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- | :--: | :---: | :----: |
| `fuel_trims`          | `0106`/`0107`/`010C`/`0110` 5 s at idle → hold 2500 rpm → 5 s → `assessFuelTrims`                                  | `pids: ['0106','0107']`                     |  —   |  yes  |   —    |
| `boost`               | `010B`/`0133`/`010C` 3 s at idle → hold 2500 rpm → `010B`/`010C` 5 s → `assessBoost` with the car's range          | `profile: ['boost'], pids: ['010B','010C']` | yes  |   —   |  yes   |
| `battery_charging`    | `battery_capture` → electrical load on → `0142`/`010C` 5 s (adapter voltage when `0142` is unsupported) → load off | —                                           | yes  |  yes  |  yes   |
| `cooling`             | `0105` once + `read_trip {id:'latest_cold'}` when trips are registered → `warmupCurve` → `assessCooling`           | `pids: ['0105']`                            | yes  |  yes  |  yes   |
| `misfire`             | Mode 06 MID `A2`–`A5` → `assessMisfire`                                                                            | `protocol: 'can', fuel: ['petrol','lpg']`   |  —   |  yes  |   —    |
| `dpf_regen`           | the `dpf` procedure                                                                                                | `skills: ['dpf']`                           | yes  |   —   |   —    |
| `used_car`            | the `used_car_check` procedure                                                                                     | `skills: ['used_car_check']`                | yes  |  yes  |  yes   |
| `check_engine_light`  | `read_dtcs`, then `read_dtcs_detail` for up to 4 stored codes when registered                                      | —                                           | yes  |  yes  |  yes   |
| `before_long_trip`    | each available of `cooling`, `maintenance`, `dpf`, merged                                                          | —                                           | yes  |  yes  |  yes   |
| `keeps_disconnecting` | the `adapter_health` procedure + `read_app_errors {limit: 10}` when registered                                     | `skills: ['adapter_health']`                | yes  |  yes  |  yes   |
| `hard_start`          | — (document only)                                                                                                  | —                                           | yes  |  yes  |  yes   |
| `rough_idle`          | — (document only)                                                                                                  | —                                           | yes  |  yes  |  yes   |
| `limp_mode`           | — (document only)                                                                                                  | —                                           | yes  |  yes  |  yes   |
| `high_consumption`    | — (document only)                                                                                                  | —                                           | yes  |  yes  |  yes   |
| `smoke`               | — (document only; asks `ask_driver smoke_colour`)                                                                  | —                                           | yes  |  yes  |  yes   |
| `glow_plugs`          | — (document only)                                                                                                  | `fuel: ['diesel']`                          | yes  |   —   |  yes   |
| `egr`                 | — (document only)                                                                                                  | —                                           | yes  |  yes  |  yes   |

The car columns are what `availableSkills` offers the built-in profiles on their expected protocol
with the profile's own PID list (before a live PID bitmap is read);
`test/app/aiDiagnoseRoute.test.tsx` pins a sample of them. Why a cell is empty: the two diesels do
not report the fuel trims `0106`/`0107`, and misfire needs a petrol engine on CAN; the Punto has
no turbo, so no boost range (`requires.profile: ['boost']`), and is petrol (no `glow_plugs`);
`dpf_regen` needs the `dpf` skill (CAN and the profile's DPF DIDs: the Golf only).
`before_long_trip` runs only the checks the car offers and lists the rest as "Not available on
this car".

**The rev hold.** `fuel_trims` and `boost` ask the driver to hold 2500 rpm in Park or Neutral
(`hold_2500_rpm`). On **Done** they sample the hold; when the hold's max rpm stays under the car's
`boost.minHoldRpm` (2200 rpm; `HOLD_MIN_RPM` = 2200 for a car without a boost range) the digest
says "rev hold not reached (max N rpm)" and the hold part is not judged. On **Can't**, a 3-minute
timeout or a car that starts moving the digest says "rev hold: driver could not do it" (a prompt
refused because the car is not stationary: "rev hold: not asked"), and the idle part is still
judged and reported.

**A missing value is never judged.** A PID that answers `NO DATA` is named in the digest ("0107
not answered: trims not judged", "010B not answered: boost not judged") and no finding comes from
it; `insufficient` (trims, boost) and `no_data` (misfire) produce no finding at all, only digest
lines. Digests and playbook documents are model-facing English; finding texts are en + ro under
`aiDiagnose:agent.finding.<module>.<id>.{title,detail}` (`trims.*`, `boost.*`, `cooling.*`,
`misfire.*`, `charging.ok` / `charging.weakUnderLoad`).

**Charging.** `battery_charging` reports `charging.weakUnderLoad` (`warn`) when the voltage under
electrical load is under `CHARGING_UNDER_LOAD_MIN_V` = 13.2 V with the engine running
(`ENGINE_RUNNING_MIN_RPM` = 600 rpm), else `charging.ok`; no running engine or no voltage → not
judged. Every skill document uses the same plain charging rule: module voltage under 13.5 V with
the engine running = not charging.

### Analysis modules (plan 34c)

Four pure modules in `src/shared/obd-core/analysis/` (unit-tested, no device I/O, English
model-facing `notes`) judge what the procedures measure.

**Fuel trims** (`fuelTrims.ts`, `assessFuelTrims(idle, hold)`). Total = STFT + LTFT (%), positive =
lean. `TRIM_LIMIT_PCT` = 10, `VACUUM_LEAK_DROP_PCT` = 5. Rules, in this order:

1. Either idle trim missing → `insufficient` (`info`, no finding). A missing hold trim drops only the
   hold part.
2. Idle total ≥ +10 % and (idle − hold) ≥ 5 → `vacuum_leak` (`warn`). The drop is checked first: idle
   +30.5 % → hold +12.5 % is a vacuum leak although the hold is still ≥ 10.
3. Idle total ≥ +10 % and hold total ≥ +10 % → `lean_all_speeds` (`warn`: the MAF or fuel
   delivery rather than a leak).
4. Idle total ≥ +10 % otherwise (no hold, or a hold under +10 % that improved by less than 5) →
   `lean` (`warn`).
5. Idle or hold total ≤ −10 % → `rich` (`warn`).
6. Otherwise `ok` (lean only at the hold is noted, not flagged).

**Boost** (`boost.ts`, `assessBoost(input, range)`) — **MAP only** (`010B`), against baro `0133`
or `ASSUMED_BARO_KPA` = 101.3 kPa when the car has no `0133` (the Passat; the notes say "baro
assumed 101.3 kPa"). Deltas are MAP − baro. Idle MAP missing → `insufficient` (no finding).

- Idle: delta < `MAP_BELOW_BARO_KPA` (−10) → `map_below_baro` (`warn`); > `STUCK_VNT_IDLE_KPA`
  (30) → `stuck_vnt` (`warn`); above the range's idle max (up to 30) → `idle_high` (`info`).
- Hold: max rpm < `minHoldRpm` → `hold_not_reached` (`info`, the hold not judged); MAP changing
  by less than `STUCK_SENSOR_KPA` (2 kPa) while rpm rose ≥ 1000 → `stuck_sensor` (`warn`,
  instead of a hold verdict; needs the idle rpm); delta under the range min → `no_boost_hold`
  (`warn`); over the range max → `overboost_hold` (`warn`).
- Nothing flagged → `ok`. A range without `confirmed` adds "Boost expected range not yet confirmed
  on this car" to the notes but never caps a finding (MAP and baro are standard PIDs).
- Per-profile ranges (`VehicleProfile.boost`, copied to a garage car from its base; initial,
  unconfirmed — see the vehicle docs' "Expected boost (agent)"; the Punto has none, so `boost` is
  not offered there):

| Car            | `idleDeltaKpa` | `holdDeltaKpa` | `holdRpm` | `minHoldRpm` |
| -------------- | -------------- | -------------- | --------- | ------------ |
| Golf 2.0 TDI   | −5 to 15       | 8 to 60        | 2500      | 2200         |
| Passat 1.9 TDI | −5 to 15       | 5 to 60        | 2500      | 2200         |
| Punto 1.2      | —              | —              | —         | —            |

**Cooling** (`cooling.ts`, `warmupCurve(samples)`, `assessCooling(currentC, curve, fuel)`). Uses
the coolant now (`0105`) and the **most recent recorded trip that started cold**; the user is never
asked to wait for a warm-up.

- `warmupCurve`: null when the trip logged no `0105`; a cold start = first coolant reading ≤
  `COLD_START_MAX_C` (40 °C); `warmupMin` = minutes to `WARM_C` (80 °C), interpolated between
  samples (null for a warm start); `drivenMin` = minutes with `010D` > 0; `maxC`.
- Now: ≥ `OVERHEAT_C` (115 °C) → `overheat_now` (`critical`); ≥ `HOT_C` (105 °C) → `hot_now`
  (`warn`) — the same thresholds as the local heuristics.
- No curve or not a cold start → `no_cold_trip` (`info`, "No recorded trip started cold; judged on
  the current reading only."). The procedure says why there is no curve (trips not available here,
  no cold-start trip, or a trip without coolant).
- Cold start: `drivenMin` ≥ `THERMOSTAT_DRIVE_MIN` (15) and `maxC` < `THERMOSTAT_OPEN_MAX_C` (75 °C)
  → `thermostat_open` (`warn`); `warmupMin` over `SLOW_WARMUP_MIN` (petrol 20, diesel 25 min) →
  `slow_warmup` (`info`).
- Trip `maxC` ≥ 115 °C → `trip_overheat` (`critical`), ≥ 105 °C → `trip_overheat` (`warn`), for
  any trip passed (the temperature was real even on a warm start).
- Nothing else → `ok`.

**Misfire** (`misfire.ts`, `assessMisfire(results)`). Counts per cylinder from the Mode 06 misfire
monitors `MISFIRE_MIDS` = `A2`–`A5` (cylinder = MID − `0xA1`; all three built-in cars are
4-cylinder), from TID `0x0C` (`MISFIRE_TID_CYCLE`), else `0x0B` (`MISFIRE_TID_EWMA`); a duplicate
result keeps the higher value, and a cylinder without a count is left out, never read as zero.

- No `0x0C` / `0x0B` count on any of `A2`–`A5` → `no_data` (`info`, no finding).
- One cylinder ≥ `MISFIRE_MIN_COUNT` (5) and ≥ 2 × the next highest → `cylinder` (`warn`, with the
  cylinder number).
- Total ≥ 10 otherwise → `random` (`warn`).
- Otherwise `none` (`ok`).

### No-AI mode (plan 34c)

With the AI off or not configured (`chat === null`), a run still does more than triage:
`runAgent` runs triage, then each skill of `NO_AI_SKILL_ORDER` that the car offers **and** that has
a procedure, one `kind: 'skill'` step each (no "why"), then builds `agentRuleReport` over the whole
trail; the run ends `no_ai`.

```ts
NO_AI_SKILL_ORDER = [
  'used_car_check',
  'fuel_trims',
  'boost',
  'misfire',
  'cooling',
  'dpf',
  'battery_charging',
  'maintenance',
];
```

- **Driver steps included.** The swept procedures' driver prompts (the rev hold, the restart and
  electrical load of `battery_charging`) appear exactly as in an AI run, with the same stationary
  gate and 3-minute timeout; **Can't** keeps the part that was measured.
- **Same rules as an AI run.** **Stop** ends the sweep at once (`stopped`, keeping the steps
  gathered); an adapter disconnect ends it `disconnected`; the 2-minute adapter budget applies, and
  when the next skill's declared cost no longer fits the adapter time left the sweep ends `adapter`
  (it does not skip ahead to a cheaper skill). No model steps are used and the 12-step cap does not
  apply.
- **What each car sweeps** (built-in profiles): Golf — `used_car_check`, `boost`, `cooling`, `dpf`,
  `battery_charging`, `maintenance`; Punto — `used_car_check`, `fuel_trims`, `misfire`, `cooling`,
  `battery_charging`, `maintenance`; Passat — `used_car_check`, `boost`, `cooling`,
  `battery_charging`, `maintenance`.
- **Notices.** **Check everything** without AI shows `agent.end.no_ai` ("{{problem}} Showing an
  on-device rule-based report instead."). A typed symptom (or **Explain with AI**) without AI does
  the same sweep and shows `agent.end.no_ai_symptom`: "Understanding a described symptom needs an
  AI provider, so everything available was checked instead. {{problem}}".
- The rule report cites the steps its findings come from, so e.g. the Punto with the simulator's
  **Lean fuel trims** fault ([simulator](../simulator.md#scripted-faults-plan-34c)) gets the
  "Likely vacuum leak" finding based on the `fuel_trims` step.

## Settings (Settings → AI assistant)

- **Enabled** toggle.
- **Provider** — Local server · OpenAI · Anthropic · Custom, with the preset's hint underneath (see
  [Providers](#providers)). Switching applies the preset once; a later edit is never overwritten.
- **Server URL** — local / custom: an OpenAI-compatible base, with or without `/v1` (e.g.
  `http://192.168.1.50:1234`). OpenAI / Anthropic: read-only, with **Edit** (flips to Custom keeping
  the address). Shows the resolved `…/v1/chat/completions` (or `…/v1/messages`) target.
- **API key** — for every provider but local (optional for custom); stored in the keystore, one slot
  per provider, never in the settings file or a backup ([settings.md](./settings.md#model)).
- **Model** — free text, or **Detect model** to fill it from the provider's `/v1/models` (a cloud
  provider keeps a model that is in the list).
- **Structured output** (hidden for Anthropic) — `Schema` sends `response_format: json_schema`
  (modern LM Studio / current OpenAI), `JSON` sends `json_object` (older OpenAI), `Off` sends plain
  text. Default `Schema`. If the server rejects the format (a 400 naming `response_format`,
  `json_schema` or `json_object`), the client **steps down the ladder** `json_schema` →
  `json_object` → no `response_format`, so a diagnosis still succeeds and the tolerant parser
  extracts the JSON. The schema is per call (`chat(messages, { schema })`, an `AiJsonSchema`;
  the report schema `REPORT_SCHEMA` by default).
- **Timeout** — 15 / 30 / 60 s.
- **Test connection** — calls the provider's `/v1/models` (through the dispatcher) and reports
  success/failure; a 401/403 names the API key.

Settings live in `settingsStore.ai` and are **persisted across launches** (see [`settings.md`](./settings.md)), so the provider, server URL, model and structured-output mode survive app restarts.

## Providers

Pure presets in `shared/obd-core/analysis/aiProviders.ts` (`AI_PROVIDER_PRESETS`, unit-tested):

| Provider (`id`)         | Wire                 | Base URL                    | Default model       | Structured output | Key      |
| ----------------------- | -------------------- | --------------------------- | ------------------- | ----------------- | -------- |
| Local server (`local`)  | `openai-chat`        | user's (LM Studio / Ollama) | — (Detect model)    | `schema`          | none     |
| OpenAI (`openai`)       | `openai-chat`        | `https://api.openai.com`    | `gpt-5-mini`        | `schema`          | required |
| Anthropic (`anthropic`) | `anthropic-messages` | `https://api.anthropic.com` | `claude-sonnet-5-5` | `off`             | required |
| Custom (`custom`)       | `openai-chat`        | user's                      | — (Detect model)    | `schema`          | optional |

- `inferProvider(baseUrl)` — api.openai.com → `openai`, api.anthropic.com → `anthropic`, blank →
  `local`, anything else → `custom`; used by the settings v4 → v5 migration and when a config has
  no provider.
- `applyProviderPreset(ai, provider)` — applied **only on a switch**: remembers the current
  provider's URL / model / output mode in `ai.remembered`, then sets the target's (the fixed host
  for the cloud providers; for local / custom the remembered URL, or the typed URL carried between
  local and custom; a cloud host is only carried into custom). Keys are never part of it.
- `aiConfigProblem(ai)` — the plain-words reason the assistant can't run (off, no URL, no key for a
  provider that needs one, no model), or null. `analyze()` shows it in the fallback notice.
- **Dispatcher** (`shared/ai/index.ts`): `getAiClient(settings): AiClient` with
  `listModels()` and `chat(messages, { json? })`, picked by the preset's wire. `json: false` (the
  follow-ups) forces `jsonMode: 'off'` on the OpenAI-compatible wire. `fetchJson` lives in
  `shared/ai/http.ts` with an injectable `fetch` (`setAiFetch`) so tests assert URL + headers with
  no network.

### Anthropic wire

Native **Messages API**, not an OpenAI-compatibility shim (documented, stable surface; meaningful
errors). Shaping is pure in `aiProviders.ts`, I/O in `shared/ai/anthropicClient.ts`:

- `POST {base}/v1/messages` with
  `buildAnthropicRequestBody(messages, config, maxTokens = 8192, schema?)` →
  `{ model, max_tokens, system, messages }`: system messages joined into `system`, consecutive
  same-role turns merged, a leading assistant turn preceded by a short user turn. No `temperature`
  / `top_p` / `top_k`, no assistant prefill, no `response_format` — the prompt asks for JSON and
  `parseAiReport` is tolerant. A per-call `schema` is appended to `system` as
  `schemaPromptHint(schema)` ("Reply with ONE JSON object only … matching this JSON Schema").
  `max_tokens` leaves room for the adaptive thinking current Claude
  models do by default.
- `anthropicHeaders(apiKey)` → `x-api-key`, `anthropic-version: 2026-10-21` (current API version),
  `content-type: application/json`, plus `anthropic-dangerous-direct-browser-access: true` for a web
  build calling with the user's own key.
- `extractAnthropicContent(json)` joins the `text` blocks (`null` when empty); a `stop_reason` of
  `refusal` is an error (→ local report with a notice).
- `GET {base}/v1/models?limit=100` → `data[].id` (Test connection / Detect model).

## Follow-up questions

After a report the owner can ask about it (plan 19). Pure builders in `aiDiagnosis.ts`:

- `buildFollowUpMessages(snapshot, report, conversation, question)` →
  `[system (buildFollowUpSystemPrompt: the same rules without the JSON schema hint, plus "answer in
plain language, 120 words or fewer, cite codes by id"), user (summarizeSnapshot), assistant (the
report as JSON), ...conversation.slice(-MAX_FOLLOWUP_TURNS), user (question)]`.
- `MAX_FOLLOWUP_TURNS = 8` messages (four question/answer pairs) go to the model; older turns are
  dropped from the prompt but stay on screen.
- `SUGGESTED_FOLLOWUPS` — "What should I check first?", "Is it safe to drive?", "Which finding is
  most urgent?", "What does {code} mean for this car?"; `followUpSuggestions(report, focusCode)`
  resolves `{code}` from the report (or drops it) and, for an **Explain with AI** focus, puts
  "What does <focus> mean for this car?" first.

`aiDiagnoseStore` holds `conversation`, `asking`, `askError` (`pushTurn`, `clearConversation`; a
new report or `reset()` clears it). `diagnoseService.followUp(snapshot, report, conversation,
question)` → `getAiClient(ai).chat(…, { json: false })`; it throws "Follow-ups need an AI provider…"
for an on-device report and the config problem when the AI is not set up. `useAiDiagnose().ask()`
records the turn or the error (logged as an `ai-diagnose` warning); an answer that lands after a new
report (re-run, recheck, clear codes, a focus run) or a Clear is dropped, so it never joins a
conversation it was not asked in.

## Send to Claude / ChatGPT

Plan 34d. The owner can take a finished run to Claude, ChatGPT or any other assistant app for a
second opinion. **Send to Claude / ChatGPT** (under the report's actions) opens
`ui/SharePackageSheet.tsx`: the package as selectable, scrollable text, an **Include VIN** switch
("Off by default. Turn on only if you want the other app to see it."; off again each time the sheet
opens, and the preview re-renders when it changes) and **Share**, which calls
`Share.share({ message, title })`. The text goes only where the owner sends it from the system share
sheet; the app opens no connection of its own. Dismissing the share sheet does nothing; a share sheet
that fails to open is logged as an `ai-diagnose` warning (`context.phase: 'share'`).

`buildAgentSharePackage(input, { includeVin })` (`src/shared/lib/agentShare.ts`, pure, unit-tested)
builds the text in English (it is a document another app reads, not app UI):

- an instruction for the other assistant: "I used the Bolid Tester app to read my car over OBD2.
  Below is everything it read and what its assistant concluded. Please explain the most likely
  causes, how sure we can be, and what I should check next. You cannot ask the app for new
  readings; tell me what to check and I will report back.";
- `Vehicle:` (the car's label, a `VIN:` line only when **Include VIN** is on, the read time in UTC);
- `Complaint:` the described symptom, "explain fault code <code>" for a focused run, or "Check
  everything" (left out for the triage-only re-read after Clear codes, which answered no request);
- `Fault codes:` stored / pending / permanent with their descriptions (from the triage snapshot);
- `Assistant report:` the overall verdict and its source, the summary, and each finding with its
  severity, detail, codes, likely causes, "(based on steps …)" and "(unconfirmed data)";
- `Checks made:` each trail step as `Step N — <tool or Triage> — <why>` with its digest (and its
  result when it was not ok);
- the report's disclaimer.

With **Include VIN** off, every occurrence of the car's VIN (any case, even inside a longer word)
and every other VIN-looking word in the **whole** text, including the step digests, becomes
`[VIN hidden]` (`VIN_HIDDEN`). The VINs are hidden before the text is cut to
`SHARE_PACKAGE_MAX_CHARS` (20 000 characters, ending with `… (cut to fit)`), so the cut never leaves
part of one behind.

## Guide citations

- **On screen:** `FindingCard` resolves each of `finding.codes` with `matchFaultGuide(profileId,
code, vagCodeForDtc(code))` on the selected car (`curatedProfileId`, so a garage car uses its base
  profile's guides). A curated guide (not `GENERIC_GUIDE`) shows "Known check for this car: <note>"
  and the same deep-link buttons as the Faults screen — `GuideLinks` (**Related data** →
  `/extended?dids=…`, **Open routine** → `/routines`), imported from the fault-codes public index
  (the one cross-feature import of this slice).
- **In the prompt:** `gatherSnapshot()` collects the curated guides for every read code
  (`knownChecksFor`, one entry per distinct guide) into `snapshot.guides`; `summarizeSnapshot`
  appends a "Known checks for this car" section, and the system prompt says "When a finding
  relates to a listed known check, mention it in `detail`."

## Mock AI server

For development without any AI server: set **Provider → Custom** and the address `mock://ai`
(development builds only — `getAiClient` refuses it when `__DEV__` is off). The dispatcher then
serves `shared/ai/__mocks__/mockAiServer.ts`: Detect model lists `mock-diagnostic-model`; a
diagnosis returns a canned AI report with one `warn` finding per fault code in the snapshot; a
follow-up returns "Mock answer N: you asked "…"", numbered by the questions it can see in the
bounded prompt. With the simulator Golf and the injected codes `P0401, P2015` (Settings → Developer &
simulator → Injected DTCs → Custom…) the report shows both Golf guides with their **Related data** / **Open routine**
buttons. The local heuristic path stays the default.

## Data flow

```
gatherSnapshot()                          analyze(snapshot)
  DTCs 03/07/0A (per profile dtcModes)      buildDiagnosisMessages(snapshot)  ── system + user (snapshot digest + known checks)
  readiness (PID 0101)            ──►       getAiClient(ai).chat(messages)    ── POST {base}/v1/chat/completions | /v1/messages
  freeze frame (Mode 02)                    parseAiReport(content, snapshot)  ── tolerant JSON → AiReport
  live poll: KEY_DIAGNOSTIC_PIDS ∩ supported
  guides: knownChecksFor(read codes)      (config problem or any AI error → localHeuristicReport, with a notice)

ask(question) → followUp(snapshot, report, conversation, question)
                  buildFollowUpMessages(…)  →  getAiClient(ai).chat(…, { json: false })  →  pushTurn(q, answer)
```

## Layers

- **api** (`api/diagnoseService.ts`) — `gatherSnapshot()` (with `knownChecksFor`), `analyze()`,
  `followUp()`, `clearCodes()`. Talks to the live `DiagnosticSession` and the AI dispatcher; holds no
  React state.
- **hooks** (`hooks/useAiDiagnose.ts`) — orchestrates gather → analyse → store; exposes `run()`,
  `ask()`, `clearConversation()`, the guide profile id and a gated `clearCodes()` that re-runs
  afterwards.
- **model** (`model/aiDiagnoseStore.ts`, Zustand) — `phase`, `progress`, `snapshot`, `report`,
  `notice`, `error`, `ranAt`, `ranFor` (the car the report was produced for, `activeCarStamp()`;
  the [vehicle report](./report.md) only uses a report stamped for its car), `conversation`,
  `asking`, `askError`.
- **AI client** (`@/shared/ai`) — `getAiClient` dispatcher over `openaiClient` (chat completions,
  `response_format` fallback ladder), `anthropicClient` (Messages API) and the dev mock; `http.ts`
  has the shared `fetchJson` (timeout via AbortController, friendly errors, injectable `fetch`) and
  `AiChatOptions` (`json`, `schema`, `signal`: an aborted signal rejects with
  `AiClientError('Stopped.')`). Lives in
  `shared` so features don't depend on each other.
- **core** (`@/shared/obd-core` → `analysis/aiDiagnosis.ts` + `analysis/aiProviders.ts`, **pure &
  unit-tested**): `DiagnosticSnapshot` / `AiReport` / `KnownCheck` types, `KEY_DIAGNOSTIC_PIDS`,
  `summarizeSnapshot`, `localHeuristicReport`, `buildDiagnosisMessages`, `buildFollowUpMessages`,
  `followUpSuggestions`, `buildChatRequestBody`, `extractMessageContent`, `parseAiReport`,
  `normalizeBaseUrl`, `overallFromFindings`; the provider presets, `inferProvider`,
  `applyProviderPreset`, `aiConfigProblem` and the Anthropic shaping.

The split mirrors `analysis/notifications` (pure _decision_) vs `shared/notify` (the OS call): all
request/response shaping and the rule-based report are pure and testable with **no network and no
device**; only the `fetch` lives outside the core.

## Local heuristics (fallback & baseline)

`localHeuristicReport` flags: MIL on; stored/pending/permanent DTCs; coolant ≥105/≥115 °C; oil
≥135 °C; |long-term fuel trim| ≥12 %; low charging voltage (<13.0 V running) / low battery (<12.2 V
at rest); and emissions monitors not ready. Overall = worst severity (any critical → `urgent`, any
warn → `attention`, else `ok`).

## Vehicle context (default)

Every diagnosis includes the **selected vehicle's details as default context** for the model: label
(make/model/year), engine, fuel, expected transport, and the profile's free-form notes — built by
`toVehicleContext()` from the chosen `VehicleProfile` (always present, even for the generic profile).
They appear at the top of the snapshot digest, and the system prompt instructs the model to tailor
its analysis to that specific car and its fuel type. The live-detected protocol and VIN are included
alongside, so the model sees both what the car _should_ be and what was actually read.
`toVehicleContext()` and `knownChecksFor()` live in the store-free `src/shared/vehicles/agentContext.ts`,
so the app and the offline eval set (`docs/testing.md#agent-eval-set`) send the model the same context.

## Acceptance

- Pure core has unit tests (`analysis/aiDiagnosis.test.ts`): URL normalisation, request-body shape,
  message-content extraction, snapshot summary, heuristic severities, overall-health ranking, and
  tolerant JSON parsing (clean / ```json-fenced / prose-wrapped / garbage → local fallback;
  unknown action types dropped; bad severities coerced).
- With **no AI server**, a clean simulated car → overall `ok`; a car with MIL + `P0299` + high
  coolant → `urgent` with a gated **Clear fault codes** action.
- With an AI server, a valid JSON answer renders as an AI-sourced report; any AI/network error
  degrades to the local report with an explanatory notice (never throws to the user).
- Clear runs Mode 04 (confirmed) and the diagnosis re-runs to reflect the cleared state.
- A focused run (`focusCode: 'P0135'`) ends the request with a user message naming `P0135`; the
  local report lists the focused code first (`aiDiagnosis.test.ts`).
- Plan 19: `aiProviders.test.ts` (presets, `inferProvider`, `applyProviderPreset` local →
  anthropic → local, Anthropic body / content / headers), `shared/ai/aiClient.test.ts` (the
  dispatcher hits `/v1/messages` with `x-api-key` for Anthropic and `/v1/chat/completions` with a
  bearer token otherwise, with an injected `fetch`), follow-up builders bounded to
  `MAX_FOLLOWUP_TURNS`, and `AiDiagnoseScreen.test.tsx` with `mock://ai` (Golf guide links under
  `P0401` / `P2015`, a suggested question appends bubbles, the 6th question's prompt has dropped
  the 1st, the on-device report disables follow-ups).
