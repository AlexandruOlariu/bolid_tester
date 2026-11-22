/** AI client dispatcher (plan 19). `getAiClient(settings)` picks the wire from the provider preset
 *  (`AI_PROVIDER_PRESETS[provider].wire`): the OpenAI-compatible chat-completions client for local /
 *  OpenAI / custom servers, the native Anthropic Messages client for Anthropic, and, in development
 *  builds only, the canned mock server for the `mock://ai` address. Features call only this. See
 *  docs/features/ai-diagnose.md#providers. */

import {
  type AiChatMessage,
  type AiClientConfig,
  type AiProviderId,
  AI_PROVIDER_PRESETS,
  isMockAiUrl,
  resolveProvider,
} from '@/shared/obd-core';
import { type AiChatOptions, AiClientError } from './http';
import * as openai from './openaiClient';
import * as anthropic from './anthropicClient';
import { createMockAiClient } from './__mocks__/mockAiServer';

export { type AiChatOptions, AiClientError, setAiFetch } from './http';
export { chatCompletion, listModels } from './openaiClient';

export interface AiClient {
  listModels(): Promise<string[]>;
  /** Send a conversation. `json: false` forces plain text (no `response_format`) for follow-ups;
   *  the default uses the settings' structured-output mode with `schema` (the report schema unless
   *  given). An aborted `signal` rejects with `AiClientError('Stopped.')`. */
  chat(messages: AiChatMessage[], opts?: AiChatOptions): Promise<string | null>;
}

/** What the dispatcher needs from `AiSettings`: the connection config plus the provider (inferred
 *  from the URL when absent). */
export type AiClientSettings = AiClientConfig & { provider?: AiProviderId };

/** React Native's `__DEV__` global (undefined under plain Node). */
function isDevBuild(): boolean {
  return (globalThis as { __DEV__?: boolean }).__DEV__ === true;
}

export function getAiClient(settings: AiClientSettings): AiClient {
  if (isMockAiUrl(settings.baseUrl)) {
    if (!isDevBuild())
      throw new AiClientError('mock://ai is a development-only address. Pick a real provider.');
    return createMockAiClient();
  }
  const config: AiClientConfig = {
    baseUrl: settings.baseUrl,
    model: settings.model,
    apiKey: settings.apiKey,
    timeoutMs: settings.timeoutMs,
    jsonMode: settings.jsonMode,
  };
  const wire = AI_PROVIDER_PRESETS[resolveProvider(settings)].wire;
  if (wire === 'anthropic-messages')
    return {
      listModels: () => anthropic.listModels(config),
      chat: (messages, opts = {}) =>
        anthropic.chatCompletion(messages, config, {
          schema: opts.json === false ? undefined : opts.schema,
          signal: opts.signal,
        }),
    };
  return {
    listModels: () => openai.listModels(config),
    chat: (messages, opts = {}) =>
      openai.chatCompletion(
        messages,
        opts.json === false ? { ...config, jsonMode: 'off' } : config,
        { schema: opts.schema, signal: opts.signal },
      ),
  };
}
