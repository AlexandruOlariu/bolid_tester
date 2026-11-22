/** I/O for the Anthropic Messages API (plan 19): `GET {base}/models` and `POST {base}/messages`,
 *  authenticated with the user's own key (`x-api-key`). Request/response shaping is pure in obd-core
 *  (`analysis/aiProviders`: `buildAnthropicRequestBody`, `extractAnthropicContent`,
 *  `anthropicHeaders`); this file only does the calls through `http.ts`. The key comes from the
 *  settings store, which keeps it in the OS keystore (`secureApiKey.ts`). See
 *  docs/features/ai-diagnose.md#anthropic-wire. */

import {
  type AiChatMessage,
  type AiClientConfig,
  anthropicHeaders,
  anthropicStopReason,
  buildAnthropicRequestBody,
  extractAnthropicContent,
} from '@/shared/obd-core';
import { AiClientError, fetchJson } from './http';
import { requireBase } from './openaiClient';

function requireKey(config: AiClientConfig): string {
  const key = (config.apiKey ?? '').trim();
  if (!key)
    throw new AiClientError('No Anthropic API key is set. Add it in Settings → AI assistant.');
  return key;
}

/** GET {base}/models → model ids (`data[].id`), newest first as the API lists them. */
export async function listModels(config: AiClientConfig): Promise<string[]> {
  const base = requireBase(config);
  const json = await fetchJson(
    `${base}/models?limit=100`,
    { method: 'GET', headers: anthropicHeaders(requireKey(config)) },
    config.timeoutMs ?? 15000,
  );
  const data = (json as { data?: Array<{ id?: string }> })?.data;
  if (!Array.isArray(data)) return [];
  return data.map((m) => m?.id).filter((id): id is string => typeof id === 'string');
}

/** POST {base}/messages → the reply text (null when the model returned none). A `refusal` stop is
 *  reported as an error so the caller falls back / shows it instead of parsing a partial answer. */
export async function chatCompletion(
  messages: AiChatMessage[],
  config: AiClientConfig,
): Promise<string | null> {
  const base = requireBase(config);
  if (!config.model)
    throw new AiClientError('No model is selected. Set one in Settings → AI assistant.');
  const json = await fetchJson(
    `${base}/messages`,
    {
      method: 'POST',
      headers: anthropicHeaders(requireKey(config)),
      body: JSON.stringify(buildAnthropicRequestBody(messages, config)),
    },
    config.timeoutMs ?? 30000,
  );
  if (anthropicStopReason(json) === 'refusal')
    throw new AiClientError('The model declined to answer this request.');
  return extractAnthropicContent(json);
}
