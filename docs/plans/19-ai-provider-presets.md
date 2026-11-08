# Plan 19 — AI provider presets, follow-up questions, guide citations

**Size:** M–L (1½–2 days) · **Depends on:** nothing (05 adds `focus` and better descriptions;
06 for garage vehicle context) · **Roadmap:** v0.4 "AI provider presets"

## Goal

The AI assistant works out of the box with a **local server** (LM Studio / Ollama), **OpenAI**, or
**Anthropic**, each with sane defaults; the user can ask **follow-up questions** about the report in
a bounded conversation; findings **cite the per-car fault guides** (deep links to measuring blocks
and routines) and the model is told about them.

## Why

`src/shared/ai/openaiClient.ts` speaks only the OpenAI chat-completions wire; `AiSettings` is one
flat `{ baseUrl, model, apiKey, timeoutMs, jsonMode }` with no notion of provider; the report is
one-shot (no way to ask "what first?"); `AiFinding.codes` are shown as chips but never linked to
`matchFaultGuide`, which the Faults screen already uses.

## Read first

- `src/shared/ai/openaiClient.ts` (`AiClientError`, `fetchJson` with AbortController, `authHeaders`
  → `Authorization: Bearer`, `requireBase` → `normalizeBaseUrl`, `listModels` → `GET {base}/models`,
  `chatCompletion` with the `response_format` retry) and `src/shared/ai/index.ts`.
- `src/shared/obd-core/analysis/aiDiagnosis.ts`: `AiClientConfig { baseUrl, model, apiKey?,
timeoutMs?, jsonMode? }`, `AiChatMessage { role: 'system' | 'user' | 'assistant'; content }`,
  `buildSystemPrompt`, `buildDiagnosisMessages(s)`, `REPORT_JSON_SCHEMA`, `buildChatRequestBody`,
  `extractMessageContent`, `parseAiReport`, `summarizeSnapshot`, `normalizeBaseUrl` (appends `/v1`),
  `localHeuristicReport`, `KEY_DIAGNOSTIC_PIDS`; `aiDiagnosis.test.ts`.
- `src/shared/state/settingsStore.ts` (`AiSettings`, `DEFAULT_AI_SETTINGS`, `setAi` writing the key
  to the keystore, `partialize` redaction, `hydrateApiKey`), `src/shared/state/secureApiKey.ts`
  (`API_KEY_STORE_KEY = 'bolid.ai.apiKey'`, `secureGetApiKey`, `secureSetApiKey`, `redactApiKey`,
  `planApiKeyHydration`) and its test.
- `src/features/ai-diagnose/{api/diagnoseService.ts (gatherSnapshot, analyze, clearCodes,
toVehicleContext), hooks/useAiDiagnose.ts, model/aiDiagnoseStore.ts, ui/AiDiagnoseScreen.tsx
(FindingCard, ActionsView, ReportView)}`.
- `src/features/settings/ui/SettingsScreen.tsx` `AiSection` (Server URL, Model + Detect, Structured
  output, Timeout, Test connection).
- `src/shared/vehicles/faultGuides.ts` (`FaultGuide { relatedDids?, routineId?, freezeFrame?, note }`,
  `matchFaultGuide(profileId, code, vagCode?)`, `GENERIC_GUIDE`) and how `DtcRow` in
  `src/features/fault-codes/ui/FaultCodesScreen.tsx` renders its buttons (`/extended`, `/routines`).
- `docs/features/ai-diagnose.md`, `docs/features/settings.md`.

## Design

### Providers (pure, `src/shared/obd-core/analysis/aiProviders.ts`)

```ts
export type AiProviderId = 'local' | 'openai' | 'anthropic' | 'custom';
export type AiWire = 'openai-chat' | 'anthropic-messages';
export interface AiProviderPreset {
  id: AiProviderId;
  label: string;
  wire: AiWire;
  baseUrl: string; // '' for local/custom (user fills), 'https://api.openai.com', 'https://api.anthropic.com'
  defaultModel: string; // local: '' (Detect), openai: confirm against GET /v1/models at implementation time, anthropic: 'claude-sonnet-5-5'
  jsonMode: 'schema' | 'object' | 'off'; // local 'schema', openai 'schema', anthropic 'off' (no response_format; prompt + tolerant parser)
  needsKey: boolean; // local false, others true
  canListModels: boolean; // all true (Anthropic: GET /v1/models)
  hint: string; // one line shown under the picker
}
export const AI_PROVIDER_PRESETS: Record<AiProviderId, AiProviderPreset>;
export function inferProvider(baseUrl: string): AiProviderId; // host api.openai.com → openai, api.anthropic.com → anthropic, '' → local, else custom
```

### Anthropic wire (pure shaping in `aiProviders.ts`, I/O in `src/shared/ai/anthropicClient.ts`)

Decision: a **native Messages API** client rather than relying on an OpenAI-compatibility shim —
the native endpoint is the documented, stable surface and keeps error messages meaningful.
Verify the request shape against the current Anthropic documentation when implementing (the
`claude-api` skill in this repo is the reference); as of writing:

```ts
export function buildAnthropicRequestBody(
  messages: AiChatMessage[],
  config: AiClientConfig,
  maxTokens = 2048,
): Record<string, unknown>;
//   { model, max_tokens, system: <joined system messages>, messages: [{ role: 'user' | 'assistant', content: string }] } — consecutive same-role turns merged
export function extractAnthropicContent(json: unknown): string | null; // content[].filter(type==='text').map(text).join('\n')
export function anthropicHeaders(apiKey: string): Record<string, string>; // 'x-api-key', 'anthropic-version': '2023-06-01', 'content-type'
```

`anthropicClient.ts`: `listModels(config)` → `GET {base}/models` → `data[].id`; `chatCompletion`
→ `POST {base}/messages`. Reuse `fetchJson` by exporting it from `openaiClient.ts` (move it to
`src/shared/ai/http.ts`). `normalizeBaseUrl` already yields `https://api.anthropic.com/v1`.

`src/shared/ai/index.ts` becomes a dispatcher:

```ts
export interface AiClient {
  listModels(): Promise<string[]>;
  chat(messages: AiChatMessage[], opts?: { json?: boolean }): Promise<string | null>;
}
export function getAiClient(settings: AiSettings): AiClient; // by AI_PROVIDER_PRESETS[settings.provider].wire; `json: false` forces jsonMode 'off' for follow-ups
```

### Settings

`AiSettings` gains `provider: AiProviderId` (default `'local'`); `migrateSettings` (plan 01) sets
`provider = inferProvider(baseUrl)` for older blobs. `setAi({ provider })` applies the preset's
`baseUrl`/`model`/`jsonMode` **only when switching providers** (not on every patch) via a helper
`applyProviderPreset(ai, provider): AiSettings` (pure, tested) that keeps a non-empty user `baseUrl`
for `local`/`custom`.

API keys per provider: `secureApiKey.ts` keys become `bolid.ai.apiKey.<provider>`
(`apiKeyStoreKey(provider)`); `secureGetApiKey(provider)` / `secureSetApiKey(provider, key)`; a
one-time migration moves a legacy `bolid.ai.apiKey` value to the current provider's slot
(`planApiKeyHydration` gains the provider; update its test). `redactApiKey` unchanged. Switching
provider loads that provider's key into runtime state.

`AiSection` UI: segmented **Provider** (Local server · OpenAI · Anthropic · Custom) at the top with
`preset.hint`; Server URL shown for local/custom (read-only for openai/anthropic with an "edit"
affordance that flips to custom); API key `Input` (secureTextEntry) when `needsKey` with the note
"stored in the phone's secure keystore, never in backups"; Model + **Detect** (uses the dispatcher);
Structured output hidden for anthropic; **Test connection** unchanged.

### Follow-up questions (multi-turn, bounded)

`aiDiagnosis.ts`:

```ts
export const MAX_FOLLOWUP_TURNS = 8; // user+assistant messages kept
export function buildFollowUpMessages(
  snapshot: DiagnosticSnapshot,
  report: AiReport,
  conversation: AiChatMessage[],
  question: string,
): AiChatMessage[];
//   [system (buildSystemPrompt minus the JSON-schema hint + "Answer in plain language, ≤ 120 words, cite codes by id"), user(summarizeSnapshot), assistant(JSON.stringify(report)), ...conversation.slice(-MAX_FOLLOWUP_TURNS), user(question)]
export const SUGGESTED_FOLLOWUPS: string[]; // 'What should I check first?', 'Is it safe to drive?', 'Which finding is most urgent?', 'What does {code} mean for this car?'
```

`aiDiagnoseStore.ts`: `conversation: AiChatMessage[]`, `asking: boolean`, `askError: string |
null`, `pushTurn(user, assistant)`, `clearConversation()`; `reset()` clears it. `diagnoseService.ts`:
`followUp(question): Promise<string>` → `getAiClient(ai).chat(buildFollowUpMessages(...), { json:
false })`; throws a friendly error when `report.source === 'local'` ("Follow-ups need an AI provider").
`useAiDiagnose` exposes `ask(question)`. UI (`AiDiagnoseScreen`): below Actions, a **Ask about this
report** card with suggestion chips, an `Input` + send button, the conversation rendered as
alternating bubbles (plain text, selectable), "Clear" link; disabled with the hint when local.

Plan 05's `focus` param: when present, prepend `What does ${focus} mean for this car?` as the
first follow-up automatically after the report arrives.

### Guide citations

- `FindingCard`: for each `finding.codes[i]`, `const g = matchFaultGuide(profileId, code,
vagCodeForDtc(code) || undefined)`; render the same buttons as `DtcRow` (**Measuring blocks** →
  `/extended`, **Routine** → `/routines`) when `g.relatedDids?.length` / `g.routineId`; show `g.note`
  under the chips. Extract the button group from `DtcRow` into `src/features/fault-codes/ui/GuideLinks.tsx`
  and export it from `@/features/fault-codes` (ai-diagnose may import another feature's **public
  index**; keep it to this one component, mirroring how history imports `useDtcExport`).
- Prompt enrichment: `summarizeSnapshot(s, guides?: { code: string; note: string }[])` appends a
  "Known checks for this car" section; `gatherSnapshot()` collects guides for all read codes.
  `buildSystemPrompt` gains the rule: "When a finding relates to a listed known check, mention it in
  `detail`." Pure + tested.

## Steps

1. `aiProviders.ts` (presets, `inferProvider`, Anthropic shaping) + tests; `http.ts`;
   `anthropicClient.ts`; dispatcher in `src/shared/ai/index.ts`.
2. `AiSettings.provider`, `applyProviderPreset`, `migrateSettings`, per-provider secure keys +
   hydration migration; `AiSection` UI.
3. Follow-ups: pure builders, store, service, hook, UI.
4. Guide citations: `GuideLinks.tsx`, `FindingCard`, `summarizeSnapshot` guides, system rule.
5. Docs; `npm run ci`.

## Simulator

No AI server is needed to develop: add `src/shared/ai/mockAiServer.ts` (test-only, not shipped in
the bundle — put it under `src/shared/ai/__mocks__/`) that implements `AiClient` and returns a
canned JSON report and canned follow-up text; wire it when `settings.ai.baseUrl === 'mock://ai'`
(dev-only string documented in `docs/features/ai-diagnose.md`) so the whole follow-up UI and guide
citations can be exercised in the simulator. The local heuristic path remains the default.

## Tests

- `aiProviders.test.ts`: `inferProvider` for the three hosts and blanks; `applyProviderPreset`
  switching local→anthropic sets `baseUrl`, `model 'claude-sonnet-5-5'`, `jsonMode 'off'` and keeps
  the user's local URL when switching back; `buildAnthropicRequestBody` splits system, merges
  consecutive user turns, sets `max_tokens`; `extractAnthropicContent` joins text blocks and returns
  null for empty; `anthropicHeaders` has the three headers.
- `aiDiagnosis.test.ts`: `buildFollowUpMessages` structure, bounded to `MAX_FOLLOWUP_TURNS`, no
  schema hint in the system prompt; `summarizeSnapshot` with guides appends the section.
- `secureApiKey.test.ts`: per-provider keys; legacy migration plan.
- `settingsStore.test.ts` (plan 01): `migrateSettings` infers `provider`.
- Dispatcher: `getAiClient({ provider: 'anthropic' })` calls the Anthropic path (inject `fetch` via
  `http.ts` so the test asserts URL + headers without network).

## Docs

- `docs/features/ai-diagnose.md`: providers table, Anthropic wire, follow-ups, guide citations,
  `mock://ai`.
- `docs/features/settings.md`: Provider picker, per-provider keys.
- `docs/privacy-policy.md` (plan 08): data sent to the chosen provider (snapshot digest, VIN) and
  that cloud providers see it.

## Acceptance

- [ ] Switching Provider to Anthropic fills the URL and `claude-sonnet-5-5`, hides Structured
      output, shows the key field; **Test connection** against a real key lists models (owner has
      a key) — otherwise the mocked dispatcher test covers the wire.
- [ ] With `mock://ai`: run → report with guide links under findings that carry codes known to the
      Golf guides (`P0401` → Routine button, `P2015` → Measuring blocks); asking a suggested question
      appends a bubble; the 9th turn drops the oldest.
- [ ] Local heuristic report: follow-up card disabled with the explanatory hint.
- [ ] Backup (plan 18) never contains a key; keystore holds one slot per provider.
- [ ] `npm run ci` green.

## Out of scope

Streaming responses; image input; a hosted Bolid proxy; translating AI output (plan 11 handles UI
strings only).

## Deferred until an on-car session

None — the AI path is network-only and the OBD snapshot comes from the simulator.
