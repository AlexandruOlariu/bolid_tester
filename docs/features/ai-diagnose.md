# Feature: ai-diagnose

**An AI assistant that investigates the car step by step.** The owner describes what is wrong
("pulls weak above 2000 rpm") or taps **Check everything**. The app reads the car once (triage),
then a read-only agent asks the user's chosen AI provider — a **local server** (LM Studio /
Ollama), **OpenAI**, **Anthropic** or a **custom** OpenAI-compatible server (plan 19) — what to
check next, one tool or skill at a time, until the model can explain the fault. The result is a
plain-language report (an overall verdict, prioritised findings that each cite the steps they rest
on, the car's own fault guides under them, recommended actions) with the **trail** of every check
and why it was made. The owner can then **ask follow-up questions** over that trail, or **send the
whole run to Claude / ChatGPT** through the share sheet. With no provider, or when the model fails,
the app finishes with a deterministic on-device rule report over everything gathered, so the
feature is never worse than a plain read.

Reachable from the **More** tab (`/ai-diagnose`). Every run is saved, with its trail, to
[History](./history.md). Built in plans 34a–34d from the spec
[`2026-11-22-ai-agent-diagnose-design.md`](../superpowers/specs/2026-11-22-ai-agent-diagnose-design.md)
(plans [34a](../plans/34a-ai-agent-core.md), [34b](../plans/34b-ai-agent-capability-skills.md),
[34c](../plans/34c-ai-agent-playbooks.md), [34d](../plans/34d-ai-agent-history-privacy-share.md)).

## Scope & safety

- **The agent only reads.** Every tool receives the **read-only session facade**
  (`createReadOnlySession`, `readOnlySession.ts`), never the `DiagnosticSession`: no `clearDtcs`, no
  raw `send`, no `setHeader` / `setRxFilter`, no sniffer controls. Raw requests pass a
  **read-request allowlist** before any byte goes out (OBD2 modes `01 02 03 06 07 09 0A`, UDS `19`,
  KWP `1A` / `21`, `22`, `3E`; session control `10` only with `01 03 81 89`, never a programming
  session); anything else throws `WriteBlockedError`. The typed reads check their arguments' shape
  the same way before sending (`DiagnosticSession` puts the caller's string on the wire unchanged):
  a Mode 01 PID `01xx` for `readValue` / `pollOnce` / the freeze-frame PIDs, a DTC kind `03` / `07`
  / `0A`, a 4-digit DID for `readExtended` / `pollExtendedOnce`, one byte for a Mode 06 MID and a
  Mode 05 TID / sensor — so `readValue('04')` or `readExtended('F190 04')` sends nothing. No
  SecurityAccess, no KWP login, no mileage DID.
- **Excluded modules.** The airbag (`15`) and immobilizer (`25`) modules are refused outright
  (`AGENT_EXCLUDED_MODULE_ADDRESSES`, `ModuleNotAllowedError`) before any traffic. Cluster mileage is
  out of scope. Module addressing happens only through `withModule`, inside the session's
  `exclusive`, with the addressing restored in `finally`.
- **Clear codes stays a button.** The only write on this screen is **clear fault codes (Mode 04)**, on the report, behind its explicit confirmation — it is **not** an agent tool, and the model
  can never trigger it. It never performs coding, adaptation, routine or service-reset writes (see
  [`coding.md`](./coding.md), [`service-reset.md`](./service-reset.md)).
- **The model only _suggests_.** Recommended actions come from a fixed enum
  (`clear_dtcs | recheck | inspect | monitor | service`); the UI renders only the ones it recognises
  and executes only the gated ones.
- **Stationary driver steps.** The agent can ask the driver to do something only from a fixed list
  (`DRIVER_INSTRUCTIONS`), and only while the car stands still: refused unless `010D` reads exactly
  0 km/h, aborted if the speed rises.
- **Every finding cites its evidence.** A finding that cites no step, an unknown step or a failed one
  is dropped; one that rests only on unconfirmed data is capped at `info`.
- **Not a mechanic.** Every report carries a disclaimer that it is an aid, not a substitute for
  professional inspection. A generic OBD2 adapter only reaches what the app can already read on
  that car.

## UI

- **AiDiagnoseScreen** —
  - **What's wrong?** card (`ui/AgentStartCard.tsx`): a symptom field (300 characters at most,
    placeholder "e.g. pulls weak above 2000 rpm"), **Investigate** (disabled while the field is
    blank, a run is going or no car is connected) and **Check everything** (the old **Run
    diagnosis**).
  - **Trail** (`ui/AgentTrail.tsx`): "Investigating · step n of 12" with **Stop** for the whole run,
    one row per step (✓ ok, ⚠ error, ✕ the driver could not / refused), the model's one-line "why"
    and the digest behind **Show data**; after the run its header ("Investigation · n steps")
    collapses / expands the rows.
  - **Stop** aborts the run at once (an open driver prompt settles as "Can't"); the run ends
    `stopped`. A double tap, or a tap while a run is going, starts nothing. A reset (the store's
    `reset()`, or Settings → reset app data) stops the run in flight (`stopActiveAgentRun`); a run
    or a Clear codes re-read that ends after the reset saves nothing to the screen or History.
  - **Driver prompt** (`ui/DriverPrompt.tsx`) while the run waits for the driver: the instruction,
    "The car must stay stationary.", the instruction's choice buttons when it has any (labelled
    from `aiDiagnose:agent.driverChoice.<value>`) and **Done** / **Can't**. The answer reaches the run through the
    driver gate (`api/driverGate.ts`).
  - Progress line while _reading the car_ then _asking the model_.
  - **Re-run diagnosis** above the report repeats the last request (symptom or everything, focus
    included), driver steps and all.
  - **Overall banner**: `ok` (healthy) / `attention` / `urgent`, colour-coded, with a one-line
    summary and a chip showing whether it came from the **AI** or **on-device rules**.
  - **Findings** — one card per issue: severity (`ok/info/warn/critical`), detail, related DTC
    codes, the **known check for this car** under the codes when a curated fault guide matches (see
    [Guide citations](#guide-citations)), likely causes, "Based on: steps 2, 3" (the steps the
    finding cites) and an **Unconfirmed data** chip when it rests only on unconfirmed data (see
    [Experimental data](#experimental-data)). When the agent's final report dropped uncited
    findings, a notice above them says how many.
  - **Recommended actions** — `clear_dtcs` (red, confirm → Mode 04 → a **triage-only** re-read,
    `runTriageOnly`, with the "Codes cleared" notice), `recheck` (re-run the last request), and
    advisory `inspect/monitor/service` cards.
  - **Send to Claude / ChatGPT** under the report's actions: a sheet previewing the run as one text,
    **Include VIN** (off) and **Share** through the system share sheet (see
    [Send to Claude / ChatGPT](#send-to-claude--chatgpt)).
  - **Ask about this report** — suggestion chips, a question field + send button, the conversation
    as alternating bubbles (selectable text) and **Clear**. The questions go to the model with the
    trail's digests, not a single snapshot. Disabled with a hint for an on-device report (see
    [Follow-up questions](#follow-up-questions)).
  - A **notice** banner explains any fallback (AI off / not configured / no key / unreachable, the
    step / time / adapter budget, invalid replies, Stop, a disconnect; `aiDiagnose:agent.end.<end>`).
- **AiReportView** (`ui/AiReportView.tsx`, exported from the slice's `index.ts`, plan 16) — a saved
  report, read-only: the overall banner, the finding cards (with the car's fault guides, the cited
  steps and the uncited-findings notice), the recommended actions as a plain list (no Clear / Re-run
  buttons — the run is over), the saved **trail** collapsed and read-only ("Investigation · n
  steps", no Stop; nothing at all for a run saved before plan 34d) and the disclaimer with the run
  time. The [History timeline](./history.md) opens it in a sheet when an AI row is tapped, passing
  the entry's `trail` and `onNavigate` (its close) so a fault guide's "Related data" / "Open
  routine" button closes the sheet before it navigates. The screen and the view share
  `OverallBanner`, `FindingCard` and the action icons from that file.
- **Saved in History** — each run is stored with `addAiRun` as an `AiHistoryEntry` with the report,
  the bounded trail (`toStoredTrail`: the first `MAX_STORED_TRAIL_STEPS` = 16 steps, each digest cut
  to `MAX_STORED_DIGEST_CHARS` = 600 characters + `…`, findings dropped), the `request` and how the
  run ended (`end`). The triage-only re-read after Clear codes saves its single triage step with no
  request or end. Details in [history.md](./history.md).

### Focused run ("Explain with AI")

The fault-codes [detail sheet](./fault-codes.md#detail-sheet) opens `/ai-diagnose?focus=<code>`.
`AiDiagnoseScreen` reads the `focus` search param (`useLocalSearchParams<{ focus?: string }>()`),
shows a **Focused on fault code …** card with the code's description (described with the selected
profile's `make`, `useAiDiagnose().make`, so it matches the detail sheet) and, once connected
**and while the screen is in front** (`useIsFocused()`), starts an agent run seeded with that code
as the symptom (`useAiDiagnose().run({ focusCode })` → `{ mode: 'symptom', symptom: code,
focusCode: code }`). The screen is a hidden tab that stays mounted, so the focus gate stops a
reconnect on another tab from starting the run in the background; the run waits until the user
comes back. The param is then consumed on this route (`useNavigation().setParams({ focus:
undefined })` — not the global `router.setParams`, which would act on whichever route is focused):
this is what lets a later **Explain with AI** — even on the same code — run again. While a focus is
shown **Check everything** still runs unfocused; **Re-run** repeats the last run (focused when it
was), and the focus question comes first among the follow-up suggestions.

- **AI path:** the request line (`requestLine`, `prompt.ts`) reads "The driver asks about fault code
  P0135: explain it, likely causes, and what to check."
- **Rule report:** `agentRuleReport` passes the focus to `localHeuristicReport(snapshot, {
focusCode })`, which lists that code's findings first; when the code is not in the current read it
  adds an `info` finding with the code's description (`describeDtc(code, snapshot.vehicle.make)` —
  `VehicleContext.make` is the profile's make).
- The focused code is kept in `aiDiagnoseStore.focusCode`; the snapshot's DTC descriptions use the
  profile's `make` like the Faults screen.

### Follow-up questions

After a report the owner can ask about it (plan 19; over the trail since plan 34a).

- `buildAgentFollowUpMessages(trail, report, conversation, question)` (`prompt.ts`) →
  `[system (buildFollowUpSystemPrompt: the report rules without the JSON schema hint, plus "answer
in plain language, 120 words or fewer, cite codes by id"), user ("Here is what was checked on my
car:" and one line per step with its digest, clamped to 6000 characters), assistant (the report as
JSON), ...conversation.slice(-MAX_FOLLOWUP_TURNS), user (question)]`.
- `MAX_FOLLOWUP_TURNS = 8` messages (four question/answer pairs) go to the model; older turns are
  dropped from the prompt but stay on screen.
- `SUGGESTED_FOLLOWUPS` — "What should I check first?", "Is it safe to drive?", "Which finding is
  most urgent?", "What does {code} mean for this car?"; `followUpSuggestions(report, focusCode)`
  resolves `{code}` from the report (or drops it) and, for an **Explain with AI** focus, puts
  "What does <focus> mean for this car?" first.

`aiDiagnoseStore` holds `conversation`, `asking`, `askError` (`pushTurn`, `clearConversation`; a
new report or `reset()` clears it). `diagnoseService.followUp(trail, report, conversation,
question)` → `getAiClient(ai).chat(…, { json: false })`; it throws "Follow-ups need an AI provider…"
for an on-device report and the config problem when the AI is not set up. `useAiDiagnose().ask()`
records the turn or the error (logged as an `ai-diagnose` warning); an answer that lands after a new
report (re-run, recheck, clear codes, a focus run) or a Clear is dropped, so it never joins a
conversation it was not asked in.

### Send to Claude / ChatGPT

Plan 34d. The owner can take a finished run to Claude, ChatGPT or any other assistant app for a
second opinion with their own subscription (the app cannot use a consumer subscription itself).
**Send to Claude / ChatGPT** (under the report's actions) opens `ui/SharePackageSheet.tsx`: the
package as selectable, scrollable text, an **Include VIN** switch ("Off by default. Turn on only if
you want the other app to see it."; off again each time the sheet opens, and the preview
re-renders when it changes) and **Share**, which calls `Share.share({ message, title })`. The text
goes only where the owner sends it from the system share sheet; the app opens no connection of its
own. Dismissing the share sheet does nothing; a share sheet that fails to open is logged as an
`ai-diagnose` warning (`context.phase: 'share'`). The receiving model is not agentic: it cannot ask
the app for new readings.

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

### Guide citations

- **On screen:** `FindingCard` resolves each of `finding.codes` with `matchFaultGuide(profileId,
code, vagCodeForDtc(code))` on the selected car (`curatedProfileId`, so a garage car uses its base
  profile's guides). A curated guide (not `GENERIC_GUIDE`) shows "Known check for this car: <note>"
  and the same deep-link buttons as the Faults screen — `GuideLinks` (**Related data** →
  `/extended?dids=…`, **Open routine** → `/routines`), imported from the fault-codes public index
  (the one cross-feature import of this slice).
- **In the prompt:** triage collects the curated guides for every read code (`knownChecksFor`, one
  entry per distinct guide) into `snapshot.guides`; `summarizeSnapshot` appends a "Known checks for
  this car" section to the triage digest, and the rules say "When a finding relates to a listed
  known check, mention it in `detail`." The `fault_codes` skill's `lookup_guide` tool reads the same
  guides on demand.

## Agent

The agent lives in `src/shared/obd-core/agent/` (pure, unit-tested with a fake model, fake tools
and a fake clock); the screen drives it through `api/agentService.ts` (`startAgentRun`,
`runTriageOnly`). **Investigate** sends the typed symptom, **Check everything** asks the model to
look over the whole car, and **Explain with AI** seeds a symptom run with the code.

### The loop and its budget

```
start (symptom | "check everything" | focus code)
  → TRIAGE (step 1, always, deterministic)
  → loop: model gets system prompt + vehicle context + trail → ONE JSON action
          {"tool": "<name>", "args": {...}, "why": "<one line>"}   or   {"final": <report>}
          app validates → runs that one tool / skill / driver prompt → appends its digest
  → cited final report        (any other ending → on-device rule report + notice)
```

- **Triage** (`triage.ts`, `runTriage`): DTCs per the profile's modes, readiness, the freeze frame
  when codes are stored, one poll of the supported key PIDs (`KEY_DIAGNOSTIC_PIDS`), the adapter
  voltage and the curated guides for the read codes, plus every tool that asks to run at triage. Each
  part of its digest has its own budget (`triageDigest`): the snapshot summary is clamped to
  `TRIAGE_SNAPSHOT_CHARS` = 1400, and the triage tool sections (`scan_modules`, `read_history`) share
  the rest of `TRIAGE_DIGEST_CHARS` = 4800 with a fair share each (`fitSections`, `digest.ts`), so the
  last section is never the one cut; two tool sections at their full 1600 characters fit whole. A
  triage tool that fails is recorded as `Read failed: <message>` and triage goes on.
- **One JSON action per turn** (`actionSchema.ts`, schema `bolid_agent_action`): a **flat** object
  (`tool` as an enum string, `args`, `why`, or `final`), not an `anyOf` union, because servers
  differ in union support. The first balanced JSON object in the reply is used; a reply with both
  `tool` and `final` is invalid. JSON actions rather than native tool calling: small local models
  follow a schema far more reliably, and one protocol works on every provider. The schema goes per
  call (OpenAI wire: `response_format: json_schema`, stepping down to `json_object` and plain text
  when the server rejects it; Anthropic wire: in the system prompt). Arguments are validated
  app-side per tool; an invalid or unknown action gets a short error back and counts as a step.
- **Prompts** (`prompt.ts`). Everything the model reads is English. The system prompt carries the
  rules, the tool menu and the **skill index** (only what this car offers). The symptom is trimmed,
  clamped to `MAX_SYMPTOM_CHARS` = 300 and JSON-quoted, so it reads as data, not instructions. The
  per-turn messages aim at `CONTEXT_TOKEN_TARGET` = 8000 tokens: the last `FULL_DIGESTS` = 3 digests
  in full, older steps as one-line app-written summaries. Each tool digest is clamped to
  `MAX_DIGEST_CHARS` = 1600 characters ("… (N more)"). The model is told to write the report in the
  app's language (`currentLanguage()`).
- **Budget** (`AGENT_BUDGET`, one for every model):

  | Limit               | Value                      |
  | ------------------- | -------------------------- |
  | `maxSteps`          | 12 steps, triage included  |
  | `wallMs`            | 4 min model + adapter      |
  | `adapterMs`         | 2 min adapter time         |
  | `maxInvalidInRow`   | 3 invalid replies in a row |
  | `driverTimeoutMs`   | 3 min per driver step      |
  | `driverSpeedPollMs` | 1 s speed check            |

  Time waiting for the driver counts toward none of the budgets; a driver step that times out counts
  as "Can't".

- **Driver steps** (`driver.ts`, `DRIVER_INSTRUCTIONS`): start the engine and idle, engine off
  ignition on, restart, hold 2500 rpm ("In Park or Neutral, bring the engine to 2500 rpm, tap Done and keep
  holding until the next message (about 10 seconds)." Done means "I am at 2500 rpm now": the
  procedure samples the hold after Done), electrical load on / off, wiggle a connector, and `smoke_colour` ("what colour is the
  smoke?" with the choices white · blue · black · grey · none; the chosen value goes into the step
  digest as "Driver answered: <value>"). Asked only while the car is stationary (above).
- **Cited report** (`report.ts`, `parseAgentFinal`): every finding cites step ids; a finding citing
  no step, an unknown step or a failed / refused one is dropped and counted in `uncitedDropped`. A
  finding resting only on unconfirmed data is capped at `info` and tagged `unconfirmed`: every cited
  step is unconfirmed, or the finding names codes that the cited steps carry only in tool findings
  flagged unconfirmed (e.g. `scan_modules` codes from a module with unverified addressing, inside the
  otherwise confirmed triage step) and in no confirmed finding or standard read
  (`AgentStep.confirmedCodes`, triage's 03 / 07 / 0A codes).
- **Fallbacks — never worse than before.** Any other ending (`AgentEnd`: `no_ai`, `steps`, `time`,
  `adapter`, `invalid`, `stopped`, `disconnected`, `ai_error`) ends in the on-device rule report over
  everything gathered (`agentRuleReport`: the rule checks on the triage snapshot, each citing step 1,
  plus one translated finding per tool finding in the trail, citing its step) with the notice
  `aiDiagnose:agent.end.<end>`. An AI error or a disconnect is logged as an `ai-diagnose` warning.
  With the AI off or not configured, the run first sweeps the available procedures (see
  [Without AI](#without-ai)).
- **After the run**: Re-run repeats the request; Clear codes runs Mode 04, then a triage-only
  re-read (`runTriageOnly`) with the "Codes cleared" notice; follow-up questions read the trail's
  digests.

### Tools and skills

**Where a tool lives.** The registry and the loop are in `src/shared/obd-core/agent/`. A tool lives
in **core** when it needs only the read-only session, the profile and obd-core analysis; it lives in
its **feature** (`src/features/<slug>/agent/`) when it needs that feature's store, service or i18n.
Each feature exports an `AgentContribution` (`<feature>AgentTools`: tools, skills, procedures), and
the route `src/app/ai-diagnose.tsx` composes them in `AGENT_CONTRIBUTIONS` (features first, the
playbooks last) and hands the list to the screen — `ai-diagnose` imports no other feature for it.
`buildAgentRegistry` merges the core contribution first and throws on a duplicate name or a skill
naming an unknown tool or procedure (caught by the contribution tests).

- **Core tools:** `read_live` (up to `READ_LIVE_MAX_PIDS` = 8 Mode 01 PIDs, once or sampled up to
  `READ_LIVE_MAX_SECONDS` = 15 s for min / avg / max) and `read_dtcs`.
- **Built in:** `open_skill`, `run_skill`, `ask_driver` (`BUILTIN_TOOLS`: the loop implements them;
  skills may name them, contributions may not).
- **Feature tools:** one or more per capability skill (table below). The only bus monitor access is
  `listenBus(ms)`, a passive `ATMA` window of at most `BUS_LISTEN_MAX_MS` = 10 s on CAN.
- **Clear codes** is not a tool (see [Scope & safety](#scope--safety)).

**Skills** (`bolid.skill.v1`, `skillFile.ts`, one `<name>.skill.json` each, checked by
`parseSkillFileOrThrow` when a contribution is built). A skill is first a **document for the
model**: `name`, a one-line `description` ("use when…", ≤ 160 characters), `kind`
(`capability` | `playbook`), the `tools` it uses, optional `driverSteps` and `maxAdapterMs` (≤ the
run's 2 min), `requires` (`pids`, `anyPids`, `fuel`, `protocol`, `profile` features, `skills`), the
step-by-step `instructions`, how to `interpret` the results, optional `profileNotes` per car, and an
optional `procedure` — the id of an on-device routine that does the whole thing in one call. A skill
is offered when its `requires` hold and every tool it names is available on the connected car
(`availableSkills`).

**Progressive disclosure**, as Claude's own skills work, so a small model's context stays small:

1. The system prompt lists only the **skill index**: the name and description of every skill this
   car offers, plus the tool names.
2. The model reads one skill's full document with `open_skill`.
3. It follows it with the fine tools, **or** calls `run_skill` when the skill has a procedure, which
   returns the computed findings in one step.

A strong model can ignore the skills and use the fine tools freely; a weak one can lean on
`run_skill`. Same loop, same tools for every model.

#### Capability skills (plan 34b)

Every feature the agent can read contributes one capability skill (21 in all, the spec's catalog);
`test/app/aiDiagnoseRoute.test.tsx` checks that all 21 are registered as `capability` skills, what
the three built-in cars are offered and that no registered tool name looks like a write. The car
columns are the built-in profiles on their expected protocol (Golf and Punto on CAN, Passat on
K-line); _adapter_ = only when the adapter can monitor the bus.

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
TP2.0-only modules reach the agent only from the last saved scan, with its date); `sensor_tests`
needs the profile's Mode 06 tests or a Mode 05 sweep (non-diesel K-line), which neither the Punto
nor the diesel Passat has; `adaptations_read` needs the profile's adaptation channels; `bus_listen`
needs CAN and a monitor-capable adapter. Store-backed skills (trips, fuel economy, performance,
maintenance, history, alerts, app errors) are always offered and answer "none recorded" in one line
on an empty store, for the active car only.

The `battery` skill's procedure `battery_capture` takes 2 s of resting voltage, the restart prompt,
then 4 s more for the crank dip and the charging voltage.

#### Playbooks (plan 34c)

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
(`hold_2500_rpm`). **Done** means "I am at 2500 rpm now, and keep holding": the instruction asks the
driver to tap Done once at 2500 rpm and hold until the next message, and on Done they sample the hold; when the hold's max rpm stays under the car's
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

**Engine running, engine warm.** `fuel_trims` and `boost` judge nothing when the idle `010C` does
not answer or reads at or below `ENGINE_RUNNING_MIN_RPM` (600 rpm) — ignition on, engine off reads
STFT 0 % and MAP = baro — and say "engine not running (N rpm): … not judged" (no finding, no rev
hold asked). `fuel_trims` also reads `0105` at idle: under `TRIMS_WARM_MIN_C` (70 °C), or with no
`0105`, the engine may be in open loop and the trims are not judged ("engine cold" / "not confirmed
warm").

**Charging.** `battery_charging` reports `charging.weakUnderLoad` (`warn`) when the voltage under
electrical load is under `CHARGING_UNDER_LOAD_MIN_V` = 13.2 V with the engine running
(`ENGINE_RUNNING_MIN_RPM` = 600 rpm), else `charging.ok`; no running engine or no voltage → not
judged. Every skill document uses the same plain charging rule: module voltage under 13.5 V with
the engine running = not charging.

#### Analysis modules (plan 34c)

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

**Boost** (`boost.ts`, `assessBoost(input, range)`) — **MAP only** (`010B`; there is no standard
"requested boost" PID), against baro `0133` or `ASSUMED_BARO_KPA` = 101.3 kPa when the car has no
`0133` (the Passat; the notes say "baro assumed 101.3 kPa"). Deltas are MAP − baro. Idle MAP
missing → `insufficient` (no finding). A stationary rev hold builds little boost, so this catches
gross faults only. With the baro assumed, the real baro is lower at altitude (the idle delta reads
low by about 1.2 kPa per 100 m), so MAP below the assumed baro is never `map_below_baro` (the notes
say baro is unknown) and the hold delta is the rise over the idle MAP (a diesel's idle MAP sits close
to baro) instead of MAP − 101.3.

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
  no cold-start trip, or a trip without coolant). With no current reading either, nothing is
  judged: no finding, and the notes say "cooling not judged".
- Cold start: `drivenMin` ≥ `THERMOSTAT_DRIVE_MIN` (15) and `maxC` < `THERMOSTAT_OPEN_MAX_C` (75 °C)
  → `thermostat_open` (`warn`); `warmupMin` over `SLOW_WARMUP_MIN` (petrol 20, diesel 25 min) →
  `slow_warmup` (`info`). A cold start that never reached 80 °C and is not `thermostat_open` (driven
  under 15 min, or a peak between 75 and 80 °C) → `warmup_not_judged` (`info`: the trip was too
  short to judge the warm-up), never `ok`.
- Trip `maxC` ≥ 115 °C → `trip_overheat` (`critical`), ≥ 105 °C → `trip_overheat` (`warn`), for
  any trip passed (the temperature was real even on a warm start).
- Nothing else → `ok` (only when something was judged).

**Misfire** (`misfire.ts`, `assessMisfire(results)`). Counts per cylinder from the Mode 06 misfire
monitors `MISFIRE_MIDS` = `A2`–`A5` (cylinder = MID − `0xA1`; all three built-in cars are
4-cylinder), from TID `0x0C` (`MISFIRE_TID_CYCLE`), else `0x0B` (`MISFIRE_TID_EWMA`); a duplicate
result keeps the higher value, and a cylinder without a count is left out, never read as zero.

- No `0x0C` / `0x0B` count on any of `A2`–`A5` → `no_data` (`info`, no finding).
- One cylinder ≥ `MISFIRE_MIN_COUNT` (5) and ≥ 2 × the next highest → `cylinder` (`warn`, with the
  cylinder number).
- Total ≥ 10 otherwise → `random` (`warn`).
- Otherwise `none` (`ok`).

### Without AI

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
  **Lean fuel trims** fault ([Simulator faults](#simulator-faults)) gets the "Likely vacuum leak"
  finding based on the `fuel_trims` step.
- Follow-up questions need an AI provider, so they stay disabled on this report.

### Experimental data

Tools may read extended DIDs, module addresses, adaptation channels and coding values that the
profiles mark `experimental` / not `confirmed` (plan 25 provenance). Every such value says
`unconfirmed` in the digest and sets the step's (or the finding's) `unconfirmed` flag. A finding
that rests **only** on unconfirmed steps is capped at `info` and shown with the **Unconfirmed
data** chip — in the model's final report (`parseAgentFinal`) and in the rule report
(`agentRuleReport`) alike — so a guessed decode can keep DPF or a module scan useful on today's
profiles without driving an urgent verdict. Standard PIDs (MAP, baro, coolant…) are never capped
on this ground; a boost range without `confirmed` only adds a note.

### Privacy

The agent sends what it reads only to the provider the user configured; nothing is scrubbed beyond
what each tool leaves out (the VIN is part of the vehicle context, and app error messages go out
with VINs masked and addresses removed). Each diagnosis, each investigation step and each follow-up
question sends that provider what the app has read for it: fault codes and descriptions,
readiness, the freeze frame, live values and short recordings, the make / model / engine, the VIN,
the car's known checks and — when the investigation reads them — module part numbers, software
versions and fault codes, manufacturer readings (extended data, adaptation and coding values, DPF),
recorded trip values, fuel-economy and performance results, the maintenance log, past diagnoses and
fault-code checks from History, alert rules, recent app error messages, adapter details and the
driver's answers to the on-screen steps, plus the question and earlier answers.

- **Settings → About → Privacy policy** and [`docs/privacy-policy.md`](../privacy-policy.md) list
  this word for word ("AI assistant:" paragraph) and describe **Send to Claude / ChatGPT** under
  "Sharing and exports" (`privacyPolicy.test.ts` keeps both in step).
- **The AI page** (Settings → AI assistant) says it in one line under the switch while the assistant
  is on (`settings:ai.whatIsSent`, [settings.md](./settings.md)).
- **Store answers** in `store/compliance/play-data-safety.md` and `apple-privacy.md` carry the same
  list.
- **Send to Claude / ChatGPT** opens no connection: the share sheet hands the text to the app the
  owner picks, and the VIN stays out unless **Include VIN** is turned on.
- API keys stay in the keystore, one per provider, never in backups, each sent only to its own
  provider ([settings.md](./settings.md#model)).

### Mock AI scripts

With the [mock AI server](#mock-ai-server) (`mock://ai`, development builds) and the agent's action
schema, the mock plays a script picked from the symptom:

- **Default** (Check everything, focus runs, other symptoms): one idle `read_live`, then a final with
  one `warn` finding per code citing step 1 and an "idle readings" finding citing step 2.
- **"battery" / "baterie"**: opens and runs the `battery` skill (restart prompt), then a final
  citing steps 1 and 3.
- **"pulls weak", "boost" or "turbo"**: opens and runs the `boost` playbook (the 2500 rpm hold
  prompt), then a final citing steps 1 and 3 with one finding per boost verdict in the step-3
  digest, titled "Boost check: <id> (mock)" (`ok` when boost was judged and nothing was flagged,
  none when it was not judged). The digest carries the verdict sentences of `assessBoost`, not
  finding keys, so the mock maps each sentence back to its id. With the simulator's **Low boost**
  fault this is `no_boost_hold`; `.maestro/ai-agent.yaml` drives it
  ([testing.md](../testing.md#end-to-end)).
- **`mock:loop`** reads rpm forever (exercise **Stop** or the step budget).
- **`mock:invalid`** never sends JSON (the rule report after three invalid replies).

### Simulator faults

The simulator gains opt-in **scripted faults** the procedures can find (plan 34c, details in
[simulator.md](../simulator.md#scripted-faults-plan-34c)): Settings → Developer & simulator →
**Scripted fault**: None · Low boost (`low_boost`: MAP near baro at the rev hold) · Lean fuel trims
(`lean_trims`: idle trims +12.5 % / +18.0 %, recovering at the hold; only on a car that reports
`0106`/`0107`, the Punto) · Weak charging (`weak_charging`: 12.1 V). Runtime only, never
persisted; reconnect the simulator to apply. Default scenarios carry none, so the recorded
`sim-*.json` fixtures are unchanged.

The route passes `onDriverAnswer` to the screen: when the driver answers **Done** to the 2500 rpm
hold, it calls `__sim.holdRevs(SIM_REV_HOLD_MS)` (15 s), so in simulator mode the boost and
fuel-trim procedures see a hold. With a real adapter it does nothing.

### Eval set

A small offline eval set (`src/shared/ai/eval/`, `npm run eval:agent`, plan 34c) runs fixed cases —
symptom + simulator profile + scripted fault → expected cause — against a configured model, through
a real `DiagnosticSession` over the simulator and the real `getAiClient`, to tune the prompts and the
step budget. **Not in CI:** skipped unless `BOLID_EVAL_URL` is set. The four cases (`golf-low-boost`,
`punto-lean`, `golf-weak-charging`, `golf-everything`), how to run them and how to read the output
are in [testing.md → Agent eval set](../testing.md#agent-eval-set). Results against the owner's
self-hosted model are pending an on-car session.

## Settings (Settings → AI assistant)

- **Enabled** toggle; while on, one line under it says what is sent (see [Privacy](#privacy)).
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
  `json_object` → no `response_format`, so a run still succeeds and the tolerant parser extracts the
  JSON. The schema is per call (`chat(messages, { schema })`, an `AiJsonSchema`): the agent's action
  schema for each step, the report schema `REPORT_SCHEMA` by default.
- **Timeout** — 15 / 30 / 60 s.
- **Test connection** — calls the provider's `/v1/models` (through the dispatcher) and reports
  success/failure; a 401/403 names the API key.

Settings live in `settingsStore.ai` and are **persisted across launches** (see
[`settings.md`](./settings.md)), so the provider, server URL, model and structured-output mode
survive app restarts.

### Providers

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
  provider that needs one, no model), or null. A run without a working configuration shows it in
  the `no_ai` notice.
- **Dispatcher** (`shared/ai/index.ts`): `getAiClient(settings): AiClient` with
  `listModels()` and `chat(messages, { json?, schema?, signal? })`, picked by the preset's wire.
  `json: false` (the follow-ups) forces `jsonMode: 'off'` on the OpenAI-compatible wire. `fetchJson`
  lives in `shared/ai/http.ts` with an injectable `fetch` (`setAiFetch`) so tests assert URL +
  headers with no network.

### Anthropic wire

Native **Messages API**, not an OpenAI-compatibility shim (documented, stable surface; meaningful
errors). Shaping is pure in `aiProviders.ts`, I/O in `shared/ai/anthropicClient.ts`:

- `POST {base}/v1/messages` with
  `buildAnthropicRequestBody(messages, config, maxTokens = 8192, schema?)` →
  `{ model, max_tokens, system, messages }`: system messages joined into `system`, consecutive
  same-role turns merged, a leading assistant turn preceded by a short user turn. No `temperature`
  / `top_p` / `top_k`, no assistant prefill, no `response_format` — the prompt asks for JSON and
  the parsers are tolerant. A per-call `schema` is appended to `system` as
  `schemaPromptHint(schema)` ("Reply with ONE JSON object only … matching this JSON Schema").
  `max_tokens` leaves room for the adaptive thinking current Claude models do by default.
- `anthropicHeaders(apiKey)` → `x-api-key`, `anthropic-version: 2026-10-21` (current API version),
  `content-type: application/json`, plus `anthropic-dangerous-direct-browser-access: true` for a web
  build calling with the user's own key.
- `extractAnthropicContent(json)` joins the `text` blocks (`null` when empty); a `stop_reason` of
  `refusal` is an error (→ the rule report with a notice).
- `GET {base}/v1/models?limit=100` → `data[].id` (Test connection / Detect model).

## Mock AI server

For development without any AI server: set **Provider → Custom** and the address `mock://ai`
(development builds only — `getAiClient` refuses it when `__DEV__` is off). The dispatcher then
serves `shared/ai/__mocks__/mockAiServer.ts`: Detect model lists `mock-diagnostic-model`; a request
with the agent's action schema plays a script ([Mock AI scripts](#mock-ai-scripts)); a request with
the report schema returns a canned AI report with one `warn` finding per fault code it can see; a
follow-up returns "Mock answer N: you asked "…"", numbered by the questions it can see in the
bounded prompt. With the simulator Golf and the injected codes `P0401, P2015` (Settings → Developer
& simulator → Injected DTCs → Custom…) the report shows both Golf guides with their **Related
data** / **Open routine** buttons.

## Layers

```
src/app/ai-diagnose.tsx          AGENT_CONTRIBUTIONS (20 features + PLAYBOOK_CONTRIBUTION), onDriverAnswer
  └─ AiDiagnoseScreen            ui/: AgentStartCard, AgentTrail, DriverPrompt, AiReportView, SharePackageSheet
       └─ useAiDiagnose          run / investigate / checkEverything / rerun / stop / answerDriver / clearCodes / ask
            ├─ agentService      startAgentRun → createReadOnlySession → runTriage → runAgent → notice
            ├─ driverGate        the open driver prompt ↔ the screen's Done / Can't / choice
            └─ diagnoseService   followUp (over the trail), clearCodes, knownChecksFor / toVehicleContext
obd-core/agent                   readOnlySession, registry, skillFile, actionSchema, triage, prompt, loop, report, driver, coreTools, playbooks
shared/ai                        getAiClient → openaiClient | anthropicClient | mock (per-call schema, abortable)
```

- **ui** (`ui/`) — the screen, the start card, the trail, the driver prompt, the saved-report view
  (also used by History) and the share sheet.
- **hooks** (`hooks/useAiDiagnose.ts`) — orchestrates a run into the store and History (`addAiRun`
  with the trail, request and end); exposes `run()`, `investigate()`, `checkEverything()`,
  `rerun()`, `stop()`, `answerDriver()`, `ask()`, `clearConversation()`, a gated `clearCodes()`
  (Mode 04 then the triage-only re-read), the guide profile id, the trail and step count.
- **api** — `agentService.ts` (`startAgentRun`: the run's context from the connected session behind
  the read-only facade, the active profile and the AI settings; triage, then the loop; the end →
  the notice; `runTriageOnly`), `driverGate.ts` (`createDriverGate`), `diagnoseService.ts`
  (`followUp`, `clearCodes`, re-exports `knownChecksFor` / `toVehicleContext` from the store-free
  `src/shared/vehicles/agentContext.ts`, shared with the eval set). No React state.
- **model** (`model/aiDiagnoseStore.ts`, Zustand) — `phase` (`idle | triage | investigating | done
| error`), `progress`, `snapshot`, `report`, `notice`, `error`, `ranAt`, `ranFor` (the car the
  report was produced for, `activeCarStamp()`; the [vehicle report](./report.md) only uses a
  report stamped for its car), `focusCode`, `request`, `trail`, `stepsUsed`, `driver`, `end`,
  `conversation`, `asking`, `askError`.
- **feature tools** — `src/features/<slug>/agent/` in each contributing slice (see
  [Tools and skills](#tools-and-skills)).
- **AI client** (`@/shared/ai`) — `getAiClient` dispatcher over `openaiClient` (chat completions,
  `response_format` fallback ladder), `anthropicClient` (Messages API) and the dev mock; `http.ts`
  has the shared `fetchJson` (timeout via AbortController, friendly errors, injectable `fetch`) and
  `AiChatOptions` (`json`, `schema`, `signal`: an aborted signal rejects with
  `AiClientError('Stopped.')`). Lives in `shared` so features don't depend on each other.
- **core** (`@/shared/obd-core`, **pure & unit-tested**) — `agent/` (above) and
  `analysis/aiDiagnosis.ts` + `analysis/aiProviders.ts`: `DiagnosticSnapshot` / `AiReport` /
  `KnownCheck` types, `KEY_DIAGNOSTIC_PIDS`, `summarizeSnapshot`, `localHeuristicReport`,
  `PROMPT_RULES`, `buildFollowUpSystemPrompt`, `followUpSuggestions`, `buildChatRequestBody`,
  `extractMessageContent`, `parseAiReport`, `normalizeBaseUrl`, `overallFromFindings`; the provider
  presets, `inferProvider`, `applyProviderPreset`, `aiConfigProblem` and the Anthropic shaping; the
  analysis modules `fuelTrims`, `boost`, `cooling`, `misfire`.
- **share** (`src/shared/lib/agentShare.ts`) — the pure share-package builder.

The split mirrors `analysis/notifications` (pure _decision_) vs `shared/notify` (the OS call): all
request/response shaping, the loop and the rule report are pure and testable with **no network and
no device**; only the `fetch` and the session live outside the core.

### Local heuristics (rule report baseline)

`localHeuristicReport` flags: MIL on; stored/pending/permanent DTCs; coolant ≥105/≥115 °C; oil
≥135 °C; |long-term fuel trim| ≥12 %; low charging voltage (<13.0 V running) / low battery (<12.2 V
at rest); and emissions monitors not ready. Overall = worst severity (any critical → `urgent`, any
warn → `attention`, else `ok`). `agentRuleReport` adds the trail's tool findings to it.

### Vehicle context (default)

Every run includes the **selected vehicle's details as default context** for the model: label
(make/model/year), engine, fuel, expected transport, and the profile's free-form notes — built by
`toVehicleContext()` from the chosen `VehicleProfile` (always present, even for the generic profile).
They appear at the top of the triage digest, and the rules tell the model to tailor its analysis to
that specific car and its fuel type. The live-detected protocol and VIN are included alongside, so
the model sees both what the car _should_ be and what was actually read. `toVehicleContext()` and
`knownChecksFor()` live in the store-free `src/shared/vehicles/agentContext.ts`, so the app and the
offline eval set send the model the same context.

## Acceptance

- **Core** (unit, no device): the read-only facade (allowlist, excluded modules, `listenBus`
  bounds), the action schema, skill files, the registry, triage, prompts (symptom clamp, last 3
  digests, the 8k target), the cited report and the rule report, and the loop as a state machine
  with a fake model, fake tools and a fake clock (`loop.test.ts`: each budget, three invalid
  replies, Stop, a disconnect, driver steps outside the budget, the no-AI sweep order and Stop
  mid-sweep); each analysis module and every playbook procedure (`playbooks.test.ts`: NO DATA,
  Can't, hold not reached, no baro, no cold trip); `analysis/aiDiagnosis.test.ts` and
  `aiProviders.test.ts` for the shared shaping and the presets.
- **Composition**: `test/app/aiDiagnoseRoute.test.tsx` — all 21 capability skills and 17 playbooks
  registered, per-car availability, no registered tool name that looks like a write; a contribution
  test per feature (`src/features/*/agent/agentTools.test.ts`); `agentStrings.test.ts` — every
  tool label, driver instruction and choice, end notice and core finding exists in en and ro.
- **Screen** (`AiDiagnoseScreen.test.tsx`, with `mock://ai`): the trail and a cited report,
  Investigate gating, Stop, the battery restart prompt with **Can't**, one run on a double tap,
  Clear codes → triage only, a symptom without AI, citations in `AiReportView`, the run saved to
  History with its trail; **Send to Claude / ChatGPT** opens a preview without the VIN, **Include
  VIN** adds it, **Share** calls the share sheet and a failure is logged. The Golf guide links
  under `P0401` / `P2015`, a suggested question appends bubbles, the 6th question's prompt has
  dropped the 1st, the on-device report disables follow-ups.
- **History**: a run re-opens with its trail; a run saved before plan 34d opens as before with no
  trail header; history v2 migrates to v3 keeping every entry (`historyStore.test.ts`,
  `HistoryScreen.test.tsx`, `backupService.test.ts`).
- **Share package** (`agentShare.test.ts`): the VIN hidden everywhere (inside a digest, any case,
  inside a longer word, other VINs) with **Include VIN** off, the clamp after hiding, the complaint
  variants.
- **Privacy**: `privacyPolicy.test.ts` (the AI paragraph lists what the agent sends, the share
  paragraph, both files in step), `AiSettingsScreen.test.tsx` (the "what is sent" line only while
  the assistant is on).
- **End to end**: `.maestro/ai-agent.yaml` — simulator Golf + **Low boost** + `mock://ai` →
  "pulls weak above 2000 rpm" → the rev-hold prompt → **Done** → a mock report with "Based on:
  steps" and the boost trail row.
- With **no AI server**, a clean simulated car → overall `ok`; a car with MIL + `P0299` + high
  coolant → `urgent` with a gated **Clear fault codes** action. Any AI / network error degrades to
  the rule report with an explanatory notice (never throws to the user).
- **On-car pending**: confirm the boost ranges on the Golf and the Passat; run the eval set against
  the owner's self-hosted model; hand a real run to the Claude and ChatGPT apps and check nothing is
  truncated (if an app truncates, lower `SHARE_PACKAGE_MAX_CHARS` and note the limit here).
