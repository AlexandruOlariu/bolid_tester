/** Shared HTTP plumbing for the AI clients (`openaiClient`, `anthropicClient`): one JSON fetch with
 *  an AbortController timeout and friendly errors. `fetch` is injectable (`setAiFetch`) so the
 *  dispatcher tests assert the URL, headers and body without any network. See
 *  docs/features/ai-diagnose.md. */

import type { AiJsonSchema } from '@/shared/obd-core';

export class AiClientError extends Error {}

/** Per-call options of `AiClient.chat`. `json: false` forces plain text (no `response_format`) for
 *  follow-ups; `schema` replaces the report schema for a structured call (the agent's action
 *  schema); `signal` aborts the call, which then rejects with `AiClientError('Stopped.')`. */
export interface AiChatOptions {
  json?: boolean;
  schema?: AiJsonSchema;
  signal?: AbortSignal;
}

type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

let fetchImpl: FetchFn | null = null;

/** Replace the `fetch` the AI clients use (tests), or pass null to restore the global one. */
export function setAiFetch(fn: FetchFn | null): void {
  fetchImpl = fn;
}

function currentFetch(): FetchFn {
  return fetchImpl ?? ((url, init) => fetch(url, init));
}

function statusHint(status: number): string {
  if (status === 401 || status === 403) return ' Check the API key in Settings → AI assistant.';
  if (status === 404) return ' Check the server address and the model name.';
  if (status === 429) return ' The provider is rate-limiting this key; wait a moment and retry.';
  return '';
}

/** Message of the error every AI call rejects with once the caller's signal is aborted (Stop). */
const STOPPED = 'Stopped.';

/** One JSON request. An aborted `signal` (the user tapped Stop) cancels the request and rejects
 *  with `AiClientError('Stopped.')` at once, even if the underlying fetch ignores the abort. */
export async function fetchJson(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<unknown> {
  if (signal?.aborted) throw new AiClientError(STOPPED);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));
  let rejectStopped: (e: AiClientError) => void = () => undefined;
  const stopped = new Promise<never>((_, reject) => {
    rejectStopped = reject;
  });
  // Handled here so a Stop that lands after the response settled is not an unhandled rejection.
  stopped.catch(() => undefined);
  const onStop = () => {
    controller.abort();
    rejectStopped(new AiClientError(STOPPED));
  };
  signal?.addEventListener('abort', onStop);
  const untilStopped = <T>(p: Promise<T>): Promise<T> => Promise.race([p, stopped]);

  try {
    let res: Response;
    try {
      // The cast bridges the DOM and React Native `AbortSignal` declarations (same object at runtime).
      const fetchSignal = controller.signal as unknown as RequestInit['signal'];
      res = await untilStopped(currentFetch()(url, { ...init, signal: fetchSignal }));
    } catch (e) {
      if (signal?.aborted) throw new AiClientError(STOPPED);
      const aborted = e instanceof Error && e.name === 'AbortError';
      throw new AiClientError(
        aborted
          ? `Request timed out after ${Math.round(timeoutMs / 1000)}s. Is the server reachable at this address?`
          : `Could not reach the AI server. Check the address and your connection (a local server must be on the same network as the phone). (${e instanceof Error ? e.message : String(e)})`,
      );
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      let body = '';
      try {
        body = await untilStopped(res.text());
      } catch {
        // ignore: the status line is enough
      }
      if (signal?.aborted) throw new AiClientError(STOPPED);
      throw new AiClientError(
        `Server returned ${res.status} ${res.statusText}.${statusHint(res.status)} ${body.slice(0, 300)}`.trim(),
      );
    }

    try {
      return await untilStopped(res.json());
    } catch {
      if (signal?.aborted) throw new AiClientError(STOPPED);
      throw new AiClientError('Server response was not valid JSON.');
    }
  } finally {
    signal?.removeEventListener('abort', onStop);
  }
}
