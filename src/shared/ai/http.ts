/** Shared HTTP plumbing for the AI clients (`openaiClient`, `anthropicClient`): one JSON fetch with
 *  an AbortController timeout and friendly errors. `fetch` is injectable (`setAiFetch`) so the
 *  dispatcher tests assert the URL, headers and body without any network. See
 *  docs/features/ai-diagnose.md. */

export class AiClientError extends Error {}

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

export async function fetchJson(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));
  let res: Response;
  try {
    // The cast bridges the DOM and React Native `AbortSignal` declarations (same object at runtime).
    const signal = controller.signal as unknown as RequestInit['signal'];
    res = await currentFetch()(url, { ...init, signal });
  } catch (e) {
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
      body = await res.text();
    } catch {
      // ignore: the status line is enough
    }
    throw new AiClientError(
      `Server returned ${res.status} ${res.statusText}.${statusHint(res.status)} ${body.slice(0, 300)}`.trim(),
    );
  }

  try {
    return await res.json();
  } catch {
    throw new AiClientError('Server response was not valid JSON.');
  }
}
