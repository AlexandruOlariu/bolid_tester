# AI diagnostic agent — design (2026-11-22)

Status: draft for owner approval. Builds on [AI diagnose](../../features/ai-diagnose.md) and
[plan 19](../../plans/19-ai-provider-presets.md).

## Intent

The owner sees this as **the app's killer feature**: an LLM that can look at *everything* the app can
read about the car, and decide, step by step, what to check next until it can explain what is wrong.
Today AI diagnose takes **one static snapshot** (DTCs, readiness, freeze frame, up to 15 key live PIDs), sends
it once and asks for a report, then allows follow-up questions about that frozen snapshot. The model
can never say "show me boost while you hold 2500 rpm" and react to the answer.

The owner intends to **host a small model** themself (an OpenAI-compatible server), does **not trust
small models**, and wants the **skill / tool layer inside the app**, not in the model or the server.

## Goals

- An agent that investigates in several steps, choosing among **read-only tools**, and ends with the
  existing report format (verdict, findings, actions) plus a visible trail of what it checked and why.
- **Two entry points on one screen:** describe a symptom ("pulls weak above 2000 rpm", "high
  consumption") or **Check everything**.
- **One mode for every model.** All tools are always offered; how well it investigates depends on the
  model the user configures (owner, 2026-11-22: "a good API key, good result; a weak model, that's the
  user's business"). The app still does the heavy lifting (skills, digests, validation) so even a
  small model gets somewhere useful.
- **Never worse than today**: any model failure falls back to the on-device rule report.

## Non-goals (this phase)

- **No writes of any kind by the agent.** Not even Clear codes (that stays a button on the report,
  behind its existing confirmation, as today). Executing routines / resets with per-step confirmation
  ("plan B") is a later phase; the tool layer is designed so it can be added, nothing more.
- No new AI providers, no on-device model, no cloud service run by us.
- No new car access: the agent can only use what the app can already read on that car/adapter.

## Anti-goals (would be a failure even if it "works")

- The agent asks the driver to do anything **while the car is moving**.
- A wrong or looping model leaves the user with no answer, or with a confident answer that the data
  does not support (every finding must cite a tool result).
- Car data or the VIN leaves the phone for a provider the user did not configure.
- The adapter gets hammered (a runaway loop polling for minutes).

## Approaches considered

1. **Classic agent, model drives.** ~6 tools, the model chooses every call. Most flexible; small models
   pick wrong tools, loop and forget results.
2. **App drives, model interprets.** Skills are fixed procedures in the app; the model only maps the
   symptom to skills, explains results and offers a next check from a menu. Reliable with small models,
   testable on the simulator; less dynamic.
3. **Hybrid (chosen by the owner, 2026-11-22).** One agent loop. The tools include **skills** (coarse,
   deterministic procedures from approach 2) *and* **fine read tools** (approach 1), all offered to
   every model. Picked because it is the most dynamic: a strong model can go off-script with the fine
   tools, a weak one can lean on the skills. A small/large model-tier setting was considered and
   rejected by the owner: the quality of the answer is the configured model's, not the app's job.

## How it works

### The loop

```
start (symptom text | "check everything")
  → app runs TRIAGE (deterministic, always): all-module DTC scan where supported, readiness,
    voltage, key live PIDs, recent history  → triage summary
  → loop, at most N steps:
      model receives: system prompt, vehicle context, triage summary, results so far, the tool menu
      model replies with ONE JSON action:  {"tool": "<name>", "args": {...}, "why": "<one line>"}
                                       or  {"final": <AiReport>}
      app validates the action against the tool's schema
        invalid / unknown tool → reply to the model with a short error, counts as a step
        valid → run the tool, append a *digested* result
  → final report (existing AiReport, each finding lists the step ids it relies on)
  → on budget exhausted, timeout, or N invalid replies in a row: app finishes with the rule report
    over everything gathered so far, and says so in the notice banner
```

**Protocol: JSON actions, not native tool calling.** Small models served by llama.cpp / Ollama /
LM Studio follow a JSON schema far more reliably than native `tools`, and one protocol works on every
provider. Today the "Structured output" setting exists but `buildChatRequestBody` hard-codes
`REPORT_JSON_SCHEMA` and `AiClient.chat` takes no schema: **new plumbing** passes a per-call schema
(OpenAI wire: `response_format: json_schema`; Anthropic wire: the schema in the prompt, parsed and
validated the same way). The action schema is a flat object (`tool` as an enum string, `args` as an
object, `why`, or `final`) rather than an `anyOf` union, because servers differ in union support;
`args` is validated app-side per tool. If a server rejects the schema, the existing auto-fallback to
JSON mode / plain text applies. Native tool calling can be added later behind the same registry.

**Context.** Target an **8k-token** context window. The model sees the system prompt, vehicle
context, triage summary, a compact tool menu and the **last 3 digests in full**; older steps are kept
as one-line summaries (written by the app, not the model).

### Budget

One budget for every model: at most **12 steps**, **4 min** of model + adapter time, and a cap on
total adapter polling time. **Time spent waiting for the driver does not count**; each `ask_driver`
step has its own 3-minute timeout, after which it counts as "Can't"; each tool result is digested to a short, numeric summary (≤ ~400 tokens) so a small
context window still fits the whole trail.

### Tools (read-only)

Each tool is a typed entry in an app-side registry: name, one-line description for the prompt, JSON
args schema, availability check (car / adapter / protocol support), cost (adapter time), and a
`digest()` that turns raw data into a short, numeric, unit-labelled summary. No new protocol work
(no new PID / DID decoding); new *analysis* code is in scope (see Skills).

**Where the code lives (architecture).** `docs/architecture.md` forbids cross-feature imports beyond
four composition points. The agent does not become a fifth: the **registry and the loop live in
`src/shared`** (pure, in obd-core / shared/ai), and **each feature contributes its tools** through a
small `agentTools` export that the **app layer** (`src/app`, like the existing `resetAppData`
injection) hands to the AI diagnose screen. Module-scan, sensor-tests, extended-pids, battery, dpf,
inspection, trips, maintenance and history each own their tool; ai-diagnose imports none of them.

**Experimental data.** Tools may use extended DIDs and module addresses that the profiles mark
`experimental` / not `confirmed`, but every such value is labelled **unconfirmed** in the digest, and
a finding that rests only on unconfirmed data is capped at severity `info` and shown with an
"unconfirmed data" tag. This keeps DPF / module scan useful on today's profiles without letting
guessed decodes drive an urgent verdict.

- **Fine tools:**
  - `read_live(pids[], seconds?)` — poll named PIDs once or for ≤ 15 s; digest = min/avg/max per PID.
  - `read_dtcs_detail(code)` — description, freeze frame, status, matching fault guide.
  - `read_mode06()` — on-board monitor results with pass/fail (sensor-tests).
  - `scan_modules()` — module list + their DTCs (module-scan, CAN cars).
  - `read_extended(pids[])` — the car profile's manufacturer PIDs (extended-pids), where defined.
  - `lookup_guide(code | topic)` — the car's curated fault guides.
  - `history_compare(pid | metric)` — this car's past values (history, trips, maintenance log).
  - `ask_driver(instruction_id)` — show the driver one instruction **from a fixed list** (e.g.
    "start the engine and let it idle", "hold 2500 rpm in Park/Neutral for 10 s", "switch on
    lights, A/C and rear demister"), wait for **Done / Can't**, then continue. **Stationary only:**
    the app refuses it unless speed is 0 km/h, and aborts the step if speed goes above 0.
- **Skills:** deterministic procedures that combine the above and return findings already
  computed by app code. Battery, DPF and used-car reuse existing analysis (`analysis/battery`,
  `analysis/dpf`, `analysis/inspection`); **fuel trims, boost, cooling and misfire need new pure
  analysis modules** in obd-core (today only single-value thresholds in `localHeuristicReport` and
  the raw Mode 06 decoder exist). Each skill declares availability, so on a car without the data it
  is simply not offered (e.g. the owner's diesel Golf has no `0106/0107` fuel trims). First set:
  - `skill_fuel_trims` — idle + 2500 rpm trims, MAF, O2 → lean / rich / vacuum-leak / MAF-drift pattern.
  - `skill_boost` — **MAP-only** (there is no standard "requested boost" PID): MAP minus baro at
    idle and at a stationary rev hold, judged against **per-profile expected ranges** added to the
    turbo profiles (Golf 2.0 TDI, Passat 1.9 TDI). A stationary rev hold builds little boost, so this
    catches gross faults (no boost, overboost, stuck sensor); load-dependent underboost waits until
    a recorded trip can be analysed.
  - `skill_battery_charging` — resting voltage, cranking dip if the user restarts, charging under load
    (analysis/battery).
  - `skill_cooling` — current coolant temperature plus, when one exists, the **warm-up curve from
    the most recent recorded trip** that started cold and logged coolant (thermostat stuck open,
    overheating). It never makes the user wait for a warm-up.
  - `skill_misfire` — misfire counters / Mode 06 misfire monitors where available.
  - `skill_dpf` — soot load / regen state from the profile's DPF PIDs (analysis/dpf), diesel only.
  - `skill_used_car` — the inspection verdict (analysis/inspection: recently-cleared codes, readiness).

  A skill declares which `ask_driver` steps it needs, its maximum adapter time, and its own rule
  output, so it is useful even with AI off.

### Safety and limits

- Read-only registry; no tool can reach a write path (enforced by the registry type: tools receive a
  read-only session facade, not the session).
- Hard caps: step budget, total wall time (e.g. 4 min), total adapter polling time, one tool
  at a time; **Stop** button always visible.
- `ask_driver` only from the fixed list, only stationary, and nothing about the immobilizer, airbag or
  cluster mileage is in scope (standing rule).
- **Privacy.** Today nothing is scrubbed: the snapshot (with the VIN) goes to the configured
  provider, and the privacy policy says so. The agent also sends kinds of data the policy does not
  list yet (trip and history values, the maintenance log, module part numbers / IDs, extended
  readings). **In scope:** update `docs/privacy-policy.md` and `privacyPolicy.ts`, and show one line
  on the AI settings page listing what is sent. Data goes only to the provider the user configured.
- Findings must cite step ids; the parser drops a finding that cites nothing and marks the report.

### Screen

Extend the existing **AI diagnose** screen, not a new one. **The agent replaces the one-shot run:**
- **Check everything** is the old **Run diagnosis**; **Re-run** repeats the last run (symptom or
  everything), including its driver steps.
- **Explain with AI** from the Faults sheet (`?focus=<code>`) starts an agent run seeded with that
  code as the symptom.
- **Clear codes** on the report (same confirmation as today) re-runs triage only and updates the report.
- **Follow-ups** work over the trail (digests) instead of the single snapshot.
- The vehicle report (`useVehicleReport`) keeps reading the store's latest `report` / `ranFor`.

**Without AI** (off, not configured, unreachable): **Check everything** runs triage plus every
available skill in a fixed order (driver steps included) and builds the rule report from their
findings. A typed symptom without AI runs the same, with a notice that understanding the symptom
needs AI.

**Language.** Prompts stay English. The symptom is passed as typed (English or Romanian); the model
is told to write the report in the app's current language. Skill findings are app strings, translated
like the rest of the UI.



```
AI DIAGNOSE
┌──────────────────────────────────────────┐
│ What's wrong?  [ pulls weak above 2000…  ]│
│ [ Investigate ]      [ Check everything ] │
└──────────────────────────────────────────┘
Investigating · step 3 of 12           [Stop]
 ✓ Triage — 2 codes, battery 12.4 V
 ✓ Boost check — asked 2.1 bar, got 1.6 bar
 ⧗ Holding 2500 rpm… (driver)  [Done] [Can't]
──────────────────────────────────────────
OVERALL: Attention — boost below target
 Findings (each with "based on: steps 2, 3")
 Recommended actions · Ask about this report
```

The trail (each step: tool, the model's one-line "why", the digest) is collapsible and saved with the
run in History. Today `AiHistoryEntry` stores only the report, so this is **new storage**: the AI
history record gains the trail (bounded size; older records without one still open).

## Testing

- obd-core: the loop as a pure state machine (fake model + fake tools): budgets, invalid-action
  handling, fallback, citation check. Each skill's analysis is pure and unit-tested on fixtures.
- Simulator: profiles gain scripted faults that the first skills can detect (low boost, lean trims,
  weak charging); the dev mock AI server (`mock://ai`) gains scripted agent conversations.
- A Maestro flow: simulator + mock AI → symptom → trail appears → report.
- A small eval set (symptom + simulated fault → expected top finding) run against the owner's hosted
  model, to tune prompts and the step budget. Not in CI.

## Decided by the owner

- Approach 3 (hybrid). Read-only first; writes with per-step confirmation are a later phase.
- Tool/skill layer lives in the app; the owner will use a small, self-hosted, OpenAI-compatible model.
- No model tiers: every model gets every tool; answer quality is the configured model's.

## Calls made by Claude (owner can change)

- JSON-action protocol instead of native tool calling; flat action schema; 8k context target.
- The agent replaces the one-shot run (Check everything = old Run diagnosis; Explain with AI = a run
  seeded with the code).
- Without AI: triage + all available skills in a fixed order, then the rule report.
- Registry and loop in `src/shared`; each feature contributes its tools through the app layer; no
  new cross-feature imports.
- Experimental / unconfirmed data allowed but labelled, and capped at `info` severity.
- `skill_boost` is MAP-only with per-profile ranges; `skill_cooling` uses recorded trips.
- Driver waiting time is outside the 4-minute cap (3-minute timeout per driver step).
- Privacy policy and the AI page updated to list what the agent sends.
- Prompts in English; the report in the app's language.
- Clear codes is not an agent tool, even with confirmation, in this phase.
- `ask_driver` is stationary-only and limited to a fixed instruction list.
- The seven first skills above; budget 12 steps, 4 min wall time.
- Extend the AI diagnose screen; no new tab.

## Left to the builder

- Exact action JSON schema and prompt wording; digest formats and token sizes.
- Which `ask_driver` instructions exist (start from what the first skills need).
- Simulator fault scripting details; how the trail is stored in History (extend the AI run record).
