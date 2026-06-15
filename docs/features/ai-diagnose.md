# Feature: ai-diagnose

**One-tap, AI-assisted health check.** Reads the car in one pass, sends a structured snapshot to a
user-configured **OpenAI-compatible** chat server (e.g. a local **LM Studio** instance), and shows a
plain-language report: an overall verdict, prioritised findings, and recommended actions. If no AI
server is configured or it can't be reached, it falls back to a deterministic on-device rule-based
report, so the feature is always useful.

Reachable from the **More** tab (`/ai-diagnose`).

## Scope & safety

- **Reads + clear DTCs only.** The diagnosis reads the engine/emissions ECU (DTCs, readiness,
  freeze frame, live PIDs). The *only* write it can perform is **clear fault codes (Mode 04)**, and
  that is always behind an explicit confirmation dialog. It never performs coding or service-reset
  writes (see [`coding.md`](./coding.md), [`service-reset.md`](./service-reset.md)).
- **The model only *suggests*.** Recommended actions come from a fixed enum
  (`clear_dtcs | recheck | inspect | monitor | service`); the UI renders only the ones it recognises
  and executes only the gated ones. The model can never trigger an action by itself.
- **Not a mechanic.** Every report carries a disclaimer that it is an aid, not a substitute for
  professional inspection. A generic OBD2 adapter only reaches the engine/emissions ECU.

## UI

- **AiDiagnoseScreen** —
  - **Run diagnosis** / **Re-run** button (disabled until connected).
  - Progress line while *gathering* then *analysing*.
  - **Overall banner**: `ok` (healthy) / `attention` / `urgent`, colour-coded, with a one-line
    summary and a chip showing whether it came from the **AI** or **on-device rules**.
  - **Findings** — one card per issue: severity (`ok/info/warn/critical`), detail, related DTC
    codes, and likely causes.
  - **Recommended actions** — `clear_dtcs` (red, confirm → Mode 04 → re-run), `recheck` (re-run),
    and advisory `inspect/monitor/service` cards.
  - A **notice** banner explains any fallback (AI off / not configured / unreachable).

## Settings (Settings → AI assistant)

- **Enabled** toggle.
- **Server URL** — OpenAI-compatible base, with or without `/v1` (e.g. `http://192.168.1.50:1234`).
  Shows the resolved `…/v1/chat/completions` target.
- **Model** — free text, or **Detect model** to fill it from the server's `/v1/models`.
- **Structured output** — `Schema` sends `response_format: json_schema` (modern LM Studio / current
  OpenAI), `JSON` sends `json_object` (older OpenAI), `Off` sends plain text. Default `Schema`. The
  client **auto-retries without `response_format`** if the server rejects it (e.g. a 400 like
  `'response_format.type' must be 'json_schema' or 'text'`), so a diagnosis still succeeds and the
  tolerant parser extracts the JSON.
- **Timeout** — 15 / 30 / 60 s.
- **Test connection** — calls `/v1/models` and reports success/failure.

Settings live in `settingsStore.ai` and are **persisted across launches** (see [`settings.md`](./settings.md)), so the server URL, model and structured-output mode survive app restarts.

## Data flow

```
gatherSnapshot()                          analyze(snapshot)
  DTCs 03/07/0A (per profile dtcModes)      buildDiagnosisMessages(snapshot)  ── system + user (snapshot digest)
  readiness (PID 0101)            ──►       chatCompletion(messages, ai)      ── POST {base}/v1/chat/completions
  freeze frame (Mode 02)                    parseAiReport(content, snapshot)  ── tolerant JSON → AiReport
  live poll: KEY_DIAGNOSTIC_PIDS ∩ supported
                                          (any AI error → localHeuristicReport, with a notice)
```

## Layers

- **api** (`api/diagnoseService.ts`) — `gatherSnapshot()`, `analyze()`, `clearCodes()`. Talks to the
  live `DiagnosticSession` and the AI client; holds no React state.
- **hooks** (`hooks/useAiDiagnose.ts`) — orchestrates gather → analyse → store; exposes `run()` and a
  gated `clearCodes()` that re-runs afterwards.
- **model** (`model/aiDiagnoseStore.ts`, Zustand) — `phase`, `progress`, `snapshot`, `report`,
  `notice`, `error`.
- **AI client** (`@/shared/ai`) — thin I/O wrapper: `chatCompletion`, `listModels`, with timeout
  (AbortController) and friendly errors. Lives in `shared` so features don't depend on each other.
- **core** (`@/shared/obd-core` → `analysis/aiDiagnosis.ts`, **pure & unit-tested**):
  `DiagnosticSnapshot` / `AiReport` types, `KEY_DIAGNOSTIC_PIDS`, `summarizeSnapshot`,
  `localHeuristicReport`, `buildDiagnosisMessages`, `buildChatRequestBody`, `extractMessageContent`,
  `parseAiReport`, `normalizeBaseUrl`, `overallFromFindings`.

The split mirrors `analysis/notifications` (pure *decision*) vs `shared/notify` (the OS call): all
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
alongside, so the model sees both what the car *should* be and what was actually read.

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
