/** AI provider presets and the Anthropic Messages wire shaping (plan 19). Pure: no network, no React
 *  Native. The assistant can talk to a **local server** (LM Studio / Ollama, OpenAI-compatible), the
 *  **OpenAI** cloud API, the **Anthropic** cloud API (native Messages API, not a compatibility shim)
 *  or any **custom** OpenAI-compatible server. Each preset carries the defaults the Settings screen
 *  applies when the user switches provider; the I/O lives in `shared/ai` (`openaiClient`,
 *  `anthropicClient`, the `getAiClient` dispatcher). See docs/features/ai-diagnose.md#providers. */

import type { AiChatMessage, AiClientConfig, AiJsonSchema } from './aiDiagnosis';

export const AI_PROVIDER_IDS = ['local', 'openai', 'anthropic', 'custom'] as const;
export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

/** Which HTTP wire a provider speaks. */
export type AiWire = 'openai-chat' | 'anthropic-messages';

export type AiJsonModeSetting = 'schema' | 'object' | 'off';

export interface AiProviderPreset {
  id: AiProviderId;
  label: string;
  wire: AiWire;
  /** Fixed API host for the cloud providers; '' for local / custom (the user fills it in). */
  baseUrl: string;
  /** Model filled in on switching; '' means "use Detect model". */
  defaultModel: string;
  /** Structured-output mode applied on switching. Anthropic is 'off': no `response_format`, the
   *  prompt asks for JSON and `parseAiReport` is tolerant. */
  jsonMode: AiJsonModeSetting;
  /** Whether a request without an API key is pointless (the cloud APIs reject it). */
  needsKey: boolean;
  /** Whether `GET {base}/models` lists models (Test connection / Detect model). */
  canListModels: boolean;
  /** One line shown under the provider picker. */
  hint: string;
}

/** Anthropic API version header value. `2026-10-21` is the current version; this app sends none of
 *  the fields it removed (`temperature`, `top_p`, `top_k`, assistant documents, user citations). */
export const ANTHROPIC_API_VERSION = '2026-10-21';

/** Default `max_tokens` for an Anthropic request. Current Claude models think adaptively by default
 *  and thinking counts against `max_tokens`, so this leaves room for the thinking plus a full JSON
 *  report (about 1-2 k tokens). */
export const ANTHROPIC_DEFAULT_MAX_TOKENS = 8192;

export const AI_PROVIDER_PRESETS: Record<AiProviderId, AiProviderPreset> = {
  local: {
    id: 'local',
    label: 'Local server',
    wire: 'openai-chat',
    baseUrl: '',
    defaultModel: '',
    jsonMode: 'schema',
    needsKey: false,
    canListModels: true,
    hint: 'LM Studio, Ollama or llama.cpp on your own computer. Nothing leaves your network.',
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    wire: 'openai-chat',
    baseUrl: 'https://api.openai.com',
    defaultModel: 'gpt-5-mini',
    jsonMode: 'schema',
    needsKey: true,
    canListModels: true,
    hint: 'OpenAI cloud API. Needs an API key from platform.openai.com; OpenAI bills the usage.',
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic',
    wire: 'anthropic-messages',
    baseUrl: 'https://api.anthropic.com',
    defaultModel: 'claude-sonnet-5-5',
    jsonMode: 'off',
    needsKey: true,
    canListModels: true,
    hint: 'Anthropic Claude API. Needs an API key from console.anthropic.com; Anthropic bills the usage.',
  },
  custom: {
    id: 'custom',
    label: 'Custom',
    wire: 'openai-chat',
    baseUrl: '',
    defaultModel: '',
    jsonMode: 'schema',
    needsKey: false,
    canListModels: true,
    hint: 'Any other OpenAI-compatible server. Add an API key if the server asks for one.',
  },
};

export function isAiProviderId(v: unknown): v is AiProviderId {
  return (AI_PROVIDER_IDS as readonly string[]).includes(v as string);
}

/** Development-only address that routes the assistant to the canned in-app mock server
 *  (`shared/ai/__mocks__/mockAiServer.ts`), so the report, follow-ups and guide links can be
 *  exercised in the simulator with no AI server. */
export const MOCK_AI_URL = 'mock://ai';

export function isMockAiUrl(url: string): boolean {
  const u = (url ?? '')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/v\d+$/, '');
  return u.toLowerCase() === MOCK_AI_URL;
}

function hostOf(url: string): string {
  const m = (url ?? '')
    .trim()
    .toLowerCase()
    .match(/^(?:[a-z][a-z0-9+.-]*:\/\/)?([^/:?#]+)/);
  return m ? m[1] : '';
}

/** Best guess of the provider behind a stored URL (settings written before plan 19 have none). */
export function inferProvider(baseUrl: string): AiProviderId {
  if (!(baseUrl ?? '').trim()) return 'local';
  const host = hostOf(baseUrl);
  if (host === 'api.openai.com') return 'openai';
  if (host === 'api.anthropic.com') return 'anthropic';
  return 'custom';
}

/** The provider a config should be served by: its explicit `provider`, else inferred from the URL. */
export function resolveProvider(config: {
  provider?: AiProviderId;
  baseUrl: string;
}): AiProviderId {
  return config.provider && isAiProviderId(config.provider)
    ? config.provider
    : inferProvider(config.baseUrl);
}

/** What `applyProviderPreset` remembers per provider, so switching back restores the user's own
 *  server URL, model and output mode (never the API key: keys live in the keystore, one slot per
 *  provider). */
export interface AiProviderMemory {
  baseUrl: string;
  model: string;
  jsonMode: AiJsonModeSetting;
}

export interface AiPresetFields {
  provider: AiProviderId;
  baseUrl: string;
  model: string;
  jsonMode: AiJsonModeSetting;
  remembered?: Partial<Record<AiProviderId, AiProviderMemory>>;
}

/** Switch the AI settings to `provider`: remember the current provider's URL / model / output mode,
 *  then apply the target's (the preset's fixed host for the cloud providers, the remembered or
 *  carried-over user URL for local / custom). Only call it on an actual switch; a same-provider call
 *  returns the input unchanged. Pure; the API key is handled by the settings store. */
export function applyProviderPreset<T extends AiPresetFields>(ai: T, provider: AiProviderId): T {
  if (ai.provider === provider) return ai;
  const preset = AI_PROVIDER_PRESETS[provider];
  const remembered: Partial<Record<AiProviderId, AiProviderMemory>> = {
    ...(ai.remembered ?? {}),
    [ai.provider]: { baseUrl: ai.baseUrl, model: ai.model, jsonMode: ai.jsonMode },
  };
  const memory = ai.remembered?.[provider];

  let baseUrl: string;
  if (preset.baseUrl) baseUrl = preset.baseUrl;
  else if (memory?.baseUrl.trim()) baseUrl = memory.baseUrl;
  // local <-> custom carry a typed URL over; a cloud host is only carried into `custom` (the
  // "edit the address" path), never into `local`.
  else if (provider === 'custom' || ai.provider === 'custom') baseUrl = ai.baseUrl;
  else baseUrl = '';

  const model = memory?.model.trim() ? memory.model : preset.defaultModel;
  const jsonMode = memory && provider !== 'anthropic' ? memory.jsonMode : preset.jsonMode;
  return { ...ai, provider, baseUrl, model, jsonMode, remembered };
}

/** Why the assistant cannot run with these settings, in plain words, or null when it can. */
export function aiConfigProblem(ai: {
  enabled: boolean;
  provider?: AiProviderId;
  baseUrl: string;
  model: string;
  apiKey?: string;
}): string | null {
  if (!ai.enabled) return 'AI is turned off. Enable it in Settings → AI assistant.';
  if (isMockAiUrl(ai.baseUrl)) return null;
  if (!(ai.baseUrl ?? '').trim())
    return 'No AI server configured. Pick a provider in Settings → AI assistant.';
  const preset = AI_PROVIDER_PRESETS[resolveProvider(ai)];
  if (preset.needsKey && !(ai.apiKey ?? '').trim())
    return `No API key for ${preset.label}. Add it in Settings → AI assistant.`;
  if (!(ai.model ?? '').trim())
    return 'No model selected. Set one (or tap Detect model) in Settings → AI assistant.';
  return null;
}

// ------------------------------------------------------------------ Anthropic Messages wire

/** The Messages API has no `response_format`, so a per-call schema travels in the system prompt. */
export function schemaPromptHint(schema: AiJsonSchema): string {
  return (
    'Reply with ONE JSON object only, no prose, matching this JSON Schema (' +
    schema.name +
    '):\n' +
    JSON.stringify(schema.schema)
  );
}

/** Body for `POST {base}/messages` (Anthropic Messages API). System messages are joined into the
 *  top-level `system` field; consecutive same-role turns are merged (the API wants alternating
 *  turns starting with `user`); a leading assistant turn gets a short user turn before it. No
 *  `temperature` / `top_p` / `top_k` (rejected on API version 2026-10-21) and no assistant prefill.
 *  A per-call `schema` is appended to the system text as {@link schemaPromptHint}. */
export function buildAnthropicRequestBody(
  messages: AiChatMessage[],
  config: AiClientConfig,
  maxTokens = ANTHROPIC_DEFAULT_MAX_TOKENS,
  schema?: AiJsonSchema,
): Record<string, unknown> {
  const systemParts = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content.trim())
    .filter(Boolean);
  if (schema) systemParts.push(schemaPromptHint(schema));
  const system = systemParts.join('\n\n');
  const turns: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    const last = turns[turns.length - 1];
    if (last && last.role === m.role) last.content = `${last.content}\n\n${m.content}`;
    else turns.push({ role: m.role, content: m.content });
  }
  if (turns.length > 0 && turns[0].role === 'assistant')
    turns.unshift({ role: 'user', content: 'Continue.' });
  const body: Record<string, unknown> = {
    model: config.model,
    max_tokens: maxTokens,
    messages: turns,
  };
  if (system) body.system = system;
  return body;
}

/** Text of an Anthropic Messages response: every `text` content block joined by newlines (thinking
 *  and other block types are skipped). Null when there is no text. */
export function extractAnthropicContent(json: unknown): string | null {
  const content = (json as { content?: unknown })?.content;
  if (!Array.isArray(content)) return null;
  const text = content
    .filter(
      (b): b is { type: 'text'; text: string } =>
        (b as { type?: unknown })?.type === 'text' &&
        typeof (b as { text?: unknown }).text === 'string',
    )
    .map((b) => b.text)
    .join('\n');
  return text.trim() ? text : null;
}

/** The response's `stop_reason` (e.g. `end_turn`, `max_tokens`, `refusal`), or null. */
export function anthropicStopReason(json: unknown): string | null {
  const r = (json as { stop_reason?: unknown })?.stop_reason;
  return typeof r === 'string' ? r : null;
}

/** Request headers for the Anthropic API. `anthropic-dangerous-direct-browser-access` lets a web
 *  build call the API directly with the user's own key (the native app is unaffected). */
export function anthropicHeaders(apiKey: string): Record<string, string> {
  return {
    'x-api-key': apiKey,
    'anthropic-version': ANTHROPIC_API_VERSION,
    'content-type': 'application/json',
    'anthropic-dangerous-direct-browser-access': 'true',
  };
}
