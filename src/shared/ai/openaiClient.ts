/** Thin I/O wrapper around an OpenAI-compatible chat server (LM Studio, llama.cpp server, Ollama's
 *  OpenAI shim, the OpenAI cloud API, etc.). The request/response *shaping* is pure and lives in
 *  obd-core (`analysis/aiDiagnosis`); this file only performs the network call (through `http.ts`,
 *  with a timeout and friendly errors). Lives in `shared` so features don't depend on one another.
 *  See docs/features/ai-diagnose.md. */

import {
  AiChatMessage,
  AiClientConfig,
  type AiJsonSchema,
  buildChatRequestBody,
  extractMessageContent,
  normalizeBaseUrl,
} from '@/shared/obd-core';
import { AiClientError, fetchJson } from './http';

export { AiClientError } from './http';

function authHeaders(config: AiClientConfig): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.apiKey) h.Authorization = `Bearer ${config.apiKey}`;
  return h;
}

export function requireBase(config: AiClientConfig): string {
  const base = normalizeBaseUrl(config.baseUrl);
  if (!base) throw new AiClientError('No AI server URL is set. Add it in Settings → AI assistant.');
  return base;
}

/** GET {base}/models → list of model ids. Used for "Test connection" and model auto-detect. */
export async function listModels(config: AiClientConfig): Promise<string[]> {
  const base = requireBase(config);
  const json = await fetchJson(
    `${base}/models`,
    { method: 'GET', headers: authHeaders(config) },
    config.timeoutMs ?? 15000,
  );
  const data = (json as { data?: Array<{ id?: string }> })?.data;
  if (!Array.isArray(data)) return [];
  return data.map((m) => m?.id).filter((id): id is string => typeof id === 'string');
}

/** Whether an error is the server refusing our structured-output request format. */
function isFormatRejection(e: unknown): boolean {
  return e instanceof AiClientError && /response_format|json_schema|json_object/i.test(e.message);
}

/** The request bodies to try in order: the configured structured-output mode first, then each
 *  weaker one (`json_schema` → `json_object` → no `response_format`). */
function formatLadder(body: Record<string, unknown>): Record<string, unknown>[] {
  const { response_format: format, ...withoutFormat } = body;
  if (!format) return [body];
  const type = (format as { type?: unknown }).type;
  const ladder = [body];
  if (type === 'json_schema')
    ladder.push({ ...withoutFormat, response_format: { type: 'json_object' } });
  ladder.push(withoutFormat);
  return ladder;
}

/** POST {base}/chat/completions → assistant message text (or null if the server returned none).
 *  If the server rejects our `response_format` (some builds accept only some modes), we step down
 *  the ladder (`json_schema` → `json_object` → none) so the call still succeeds — the prompt already
 *  asks for JSON and the parser is tolerant. `opts.schema` replaces the report schema; an aborted
 *  `opts.signal` rejects with `AiClientError('Stopped.')`. */
export async function chatCompletion(
  messages: AiChatMessage[],
  config: AiClientConfig,
  opts: { schema?: AiJsonSchema; signal?: AbortSignal } = {},
): Promise<string | null> {
  const base = requireBase(config);
  if (!config.model)
    throw new AiClientError('No model is selected. Set one in Settings → AI assistant.');
  const url = `${base}/chat/completions`;
  const headers = authHeaders(config);
  const timeout = config.timeoutMs ?? 30000;
  const ladder = formatLadder(buildChatRequestBody(messages, config, opts.schema));

  for (let i = 0; ; i++) {
    try {
      const json = await fetchJson(
        url,
        { method: 'POST', headers, body: JSON.stringify(ladder[i]) },
        timeout,
        opts.signal,
      );
      return extractMessageContent(json);
    } catch (e) {
      if (i === ladder.length - 1 || !isFormatRejection(e)) throw e;
    }
  }
}
