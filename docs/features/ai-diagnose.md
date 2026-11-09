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
  - **Run diagnosis** / **Re-run** button (disabled until connected).
  - Progress line while _gathering_ then _analysing_.
  - **Overall banner**: `ok` (healthy) / `attention` / `urgent`, colour-coded, with a one-line
    summary and a chip showing whether it came from the **AI** or **on-device rules**.
  - **Findings** — one card per issue: severity (`ok/info/warn/critical`), detail, related DTC
    codes, the **known check for this car** under the codes when a curated fault guide matches (see
    [Guide citations](#guide-citations)), and likely causes.
  - **Recommended actions** — `clear_dtcs` (red, confirm → Mode 04 → re-run), `recheck` (re-run),
    and advisory `inspect/monitor/service` cards.
  - **Ask about this report** — suggestion chips, a question field + send button, the conversation
    as alternating bubbles (selectable text) and **Clear**. Disabled with a hint for an on-device
    report (see [Follow-up questions](#follow-up-questions)).
  - A **notice** banner explains any fallback (AI off / not configured / no key / unreachable).

## Focused run ("Explain with AI")

The fault-codes [detail sheet](./fault-codes.md#detail-sheet) opens `/ai-diagnose?focus=<code>`.
`AiDiagnoseScreen` reads the `focus` search param (`useLocalSearchParams<{ focus?: string }>()`),
shows a **Focused on fault code …** card with the code's description (described with the selected
profile's `make`, `useAiDiagnose().make`, so it matches the detail sheet) and, once connected
**and while the screen is in front** (`useIsFocused()`), runs the diagnosis once for that code
(`useAiDiagnose().run({ focusCode })` → `analyze(snapshot, onAnalyzing, { focusCode })`). The
screen is a hidden tab that stays mounted, so the focus gate stops a reconnect on another tab from
starting the run in the background; the run waits until the user comes back. The param is then
consumed on this route (`useNavigation().setParams({ focus: undefined })` — not the global
`router.setParams`, which would act on whichever route is focused): this is what lets a later
**Explain with AI** — even on the same code — run again. While a focus is
shown the main button reads **Run full diagnosis** and runs unfocused; the report's **Re-run**
repeats the report's own run (focused when it was).

- **AI path:** `buildDiagnosisMessages(snapshot, { focusCode })` appends one user message: "Focus on
  fault code P0135: explain it in plain words, likely causes in order of probability, and what to
  check first."
- **Local path:** `localHeuristicReport(snapshot, { focusCode })` lists that code's findings first;
  when the code is not in the current read it adds an `info` finding with the code's description
  (`describeDtc(code, snapshot.vehicle.make)` — `VehicleContext.make` is the profile's make).
- The focused code is kept in `aiDiagnoseStore.focusCode`; the snapshot's DTC descriptions use the
  profile's `make` like the Faults screen.

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
  text. Default `Schema`. The client **auto-retries without `response_format`** if the server
  rejects it (e.g. a 400 like `'response_format.type' must be 'json_schema' or 'text'`), so a
  diagnosis still succeeds and the tolerant parser extracts the JSON.
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

- `POST {base}/v1/messages` with `buildAnthropicRequestBody(messages, config, maxTokens = 8192)` →
  `{ model, max_tokens, system, messages }`: system messages joined into `system`, consecutive
  same-role turns merged, a leading assistant turn preceded by a short user turn. No `temperature`
  / `top_p` / `top_k`, no assistant prefill, no `response_format` — the prompt asks for JSON and
  `parseAiReport` is tolerant. `max_tokens` leaves room for the adaptive thinking current Claude
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
bounded prompt. With the simulator Golf and the injected codes `P0401, P2015` (Settings → Injected
DTCs → Custom…) the report shows both Golf guides with their **Related data** / **Open routine**
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
  `notice`, `error`, `conversation`, `asking`, `askError`.
- **AI client** (`@/shared/ai`) — `getAiClient` dispatcher over `openaiClient` (chat completions,
  `response_format` retry), `anthropicClient` (Messages API) and the dev mock; `http.ts` has the
  shared `fetchJson` (timeout via AbortController, friendly errors, injectable `fetch`). Lives in
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
