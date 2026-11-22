/** The AI client dispatcher (plan 19): `getAiClient` picks the wire from the provider preset. `fetch`
 *  is injected through `setAiFetch`, so these tests assert the URL, headers and body of each call
 *  with no network at all. */
import { AiClientError, getAiClient, setAiFetch } from './index';
import { ANTHROPIC_API_VERSION, type AiChatMessage } from '@/shared/obd-core';

interface Call {
  url: string;
  init: RequestInit;
}

function fakeFetch(respond: (url: string) => unknown, status = 200) {
  const calls: Call[] = [];
  setAiFetch(async (url, init) => {
    calls.push({ url, init });
    const body = respond(url);
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as Response;
  });
  return calls;
}

const headersOf = (c: Call) => c.init.headers as Record<string, string>;
const bodyOf = (c: Call) => JSON.parse(String(c.init.body)) as Record<string, unknown>;

const MESSAGES: AiChatMessage[] = [
  { role: 'system', content: 'You are a mechanic.' },
  { role: 'user', content: 'Snapshot' },
];

afterEach(() => setAiFetch(null));

describe('getAiClient — Anthropic', () => {
  const settings = {
    provider: 'anthropic' as const,
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-sonnet-5-5',
    apiKey: 'sk-ant-test',
    jsonMode: 'off' as const,
  };

  it('chat posts to /v1/messages with the Anthropic headers and body', async () => {
    const calls = fakeFetch(() => ({
      content: [{ type: 'text', text: '{"overall":"ok"}' }],
      stop_reason: 'end_turn',
    }));
    const text = await getAiClient(settings).chat(MESSAGES, { json: true });
    expect(text).toBe('{"overall":"ok"}');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.anthropic.com/v1/messages');
    expect(calls[0].init.method).toBe('POST');
    expect(headersOf(calls[0])['x-api-key']).toBe('sk-ant-test');
    expect(headersOf(calls[0])['anthropic-version']).toBe(ANTHROPIC_API_VERSION);
    expect(headersOf(calls[0])).not.toHaveProperty('Authorization');
    const body = bodyOf(calls[0]);
    expect(body.model).toBe('claude-sonnet-5-5');
    expect(body.system).toBe('You are a mechanic.');
    expect(body.messages).toEqual([{ role: 'user', content: 'Snapshot' }]);
    expect(body).not.toHaveProperty('response_format');
  });

  it('listModels reads data[].id from GET /v1/models', async () => {
    const calls = fakeFetch(() => ({
      data: [{ id: 'claude-sonnet-5-5' }, { id: 'claude-opus-5-5' }],
    }));
    expect(await getAiClient(settings).listModels()).toEqual([
      'claude-sonnet-5-5',
      'claude-opus-5-5',
    ]);
    expect(calls[0].url).toMatch(/^https:\/\/api\.anthropic\.com\/v1\/models/);
    expect(calls[0].init.method).toBe('GET');
    expect(headersOf(calls[0])['x-api-key']).toBe('sk-ant-test');
  });

  it('a refusal is an error, a missing key fails before any request', async () => {
    fakeFetch(() => ({ content: [], stop_reason: 'refusal' }));
    await expect(getAiClient(settings).chat(MESSAGES)).rejects.toThrow(/declined/);
    const calls = fakeFetch(() => ({}));
    await expect(getAiClient({ ...settings, apiKey: '' }).chat(MESSAGES)).rejects.toBeInstanceOf(
      AiClientError,
    );
    expect(calls).toHaveLength(0);
  });

  it('an HTTP 401 names the API key', async () => {
    fakeFetch(() => ({ error: { type: 'authentication_error' } }), 401);
    await expect(getAiClient(settings).listModels()).rejects.toThrow(/401.*API key/);
  });

  it('the provider is inferred from the URL when the settings carry none', async () => {
    const calls = fakeFetch(() => ({ content: [{ type: 'text', text: 'hi' }] }));
    const { provider: _p, ...noProvider } = settings;
    void _p;
    await getAiClient(noProvider).chat(MESSAGES);
    expect(calls[0].url).toBe('https://api.anthropic.com/v1/messages');
  });
});

describe('getAiClient — OpenAI-compatible', () => {
  const settings = {
    provider: 'openai' as const,
    baseUrl: 'https://api.openai.com',
    model: 'gpt-5-mini',
    apiKey: 'sk-openai',
    jsonMode: 'schema' as const,
  };

  it('chat posts to /v1/chat/completions with a bearer token and response_format', async () => {
    const calls = fakeFetch(() => ({ choices: [{ message: { content: 'report' } }] }));
    expect(await getAiClient(settings).chat(MESSAGES)).toBe('report');
    expect(calls[0].url).toBe('https://api.openai.com/v1/chat/completions');
    expect(headersOf(calls[0]).Authorization).toBe('Bearer sk-openai');
    expect(bodyOf(calls[0]).response_format).toMatchObject({ type: 'json_schema' });
  });

  it('json: false (follow-ups) sends plain text, no response_format', async () => {
    const calls = fakeFetch(() => ({ choices: [{ message: { content: 'answer' } }] }));
    await getAiClient(settings).chat(MESSAGES, { json: false });
    expect(bodyOf(calls[0])).not.toHaveProperty('response_format');
  });

  it('a local server gets no Authorization header without a key', async () => {
    const calls = fakeFetch(() => ({ data: [{ id: 'qwen' }] }));
    const local = {
      provider: 'local' as const,
      baseUrl: 'http://192.168.1.50:1234',
      model: '',
      apiKey: '',
    };
    expect(await getAiClient(local).listModels()).toEqual(['qwen']);
    expect(calls[0].url).toBe('http://192.168.1.50:1234/v1/models');
    expect(headersOf(calls[0])).not.toHaveProperty('Authorization');
  });
});

describe('getAiClient — mock://ai', () => {
  const g = globalThis as { __DEV__?: boolean };
  afterEach(() => {
    delete g.__DEV__;
  });

  it('serves a canned report and follow-up answers in a development build, with no fetch', async () => {
    g.__DEV__ = true;
    const calls = fakeFetch(() => ({}));
    const client = getAiClient({ provider: 'custom', baseUrl: 'mock://ai', model: '' });
    expect(await client.listModels()).toEqual(['mock-diagnostic-model']);
    const snapshot: AiChatMessage = {
      role: 'user',
      content: 'Stored DTCs (2): P0401 — EGR; P2015 — flap.',
    };
    const report = JSON.parse((await client.chat([snapshot], { json: true })) ?? '{}');
    expect(report.findings.map((f: { codes: string[] }) => f.codes[0])).toEqual(['P0401', 'P2015']);
    const answer = await client.chat(
      [snapshot, { role: 'assistant', content: '{}' }, { role: 'user', content: 'What first?' }],
      { json: false },
    );
    expect(answer).toContain('What first?');
    expect(answer).toContain('P0401');
    expect(calls).toHaveLength(0);
  });

  it('is refused outside a development build', () => {
    expect(() => getAiClient({ baseUrl: 'mock://ai', model: '' })).toThrow(/development-only/);
  });
});

describe('getAiClient — per-call schema, fallback ladder and Stop', () => {
  const openaiSettings = {
    provider: 'openai' as const,
    baseUrl: 'https://api.openai.com',
    model: 'gpt-5-mini',
    apiKey: 'sk-openai',
    jsonMode: 'schema' as const,
  };
  const anthropicSettings = {
    provider: 'anthropic' as const,
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-sonnet-5-5',
    apiKey: 'sk-ant-test',
    jsonMode: 'off' as const,
  };
  const AGENT_LIKE = { name: 'bolid_agent_action', schema: { type: 'object' } };

  /** A fetch that answers each call with the next canned `{ status, body }` and records the sent
   *  request bodies. */
  function sequenceFetch(replies: { status: number; body: unknown }[]) {
    const sentBodies: Record<string, unknown>[] = [];
    let i = 0;
    setAiFetch(async (_url, init) => {
      sentBodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      const reply = replies[Math.min(i++, replies.length - 1)];
      return {
        ok: reply.status >= 200 && reply.status < 300,
        status: reply.status,
        statusText: reply.status === 200 ? 'OK' : 'Bad Request',
        json: async () => reply.body,
        text: async () =>
          typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body),
      } as Response;
    });
    return sentBodies;
  }

  const formatOf = (b: Record<string, unknown>) =>
    (b.response_format as { type?: string } | undefined)?.type;

  it('sends the per-call schema as json_schema', async () => {
    const sentBodies = sequenceFetch([
      { status: 200, body: { choices: [{ message: { content: '{}' } }] } },
    ]);
    await getAiClient(openaiSettings).chat(MESSAGES, { schema: AGENT_LIKE });
    expect(sentBodies[0].response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'bolid_agent_action', strict: false, schema: { type: 'object' } },
    });
  });

  it('a rejected json_schema falls back to json_object, then to no response_format', async () => {
    const sentBodies = sequenceFetch([
      { status: 400, body: 'response_format json_schema not supported' },
      { status: 400, body: 'json_object not supported' },
      { status: 200, body: { choices: [{ message: { content: '{"tool":"x"}' } }] } },
    ]);
    const text = await getAiClient(openaiSettings).chat(MESSAGES, { schema: AGENT_LIKE });
    expect(text).toBe('{"tool":"x"}');
    expect(sentBodies.map(formatOf)).toEqual(['json_schema', 'json_object', undefined]);
  });

  it('object mode falls back straight to no response_format', async () => {
    const sentBodies = sequenceFetch([
      { status: 400, body: 'json_object not supported' },
      { status: 200, body: { choices: [{ message: { content: 'ok' } }] } },
    ]);
    await getAiClient({ ...openaiSettings, jsonMode: 'object' }).chat(MESSAGES);
    expect(sentBodies.map(formatOf)).toEqual(['json_object', undefined]);
  });

  it('a non-format error is not retried, and the last rung error surfaces', async () => {
    let sentBodies = sequenceFetch([{ status: 500, body: 'boom' }]);
    await expect(getAiClient(openaiSettings).chat(MESSAGES)).rejects.toThrow(/500/);
    expect(sentBodies).toHaveLength(1);
    sentBodies = sequenceFetch([{ status: 400, body: 'response_format is not allowed' }]);
    await expect(getAiClient(openaiSettings).chat(MESSAGES)).rejects.toThrow(/response_format/);
    expect(sentBodies.map(formatOf)).toEqual(['json_schema', 'json_object', undefined]);
  });

  it('json: false still forces plain text even with a schema', async () => {
    const sentBodies = sequenceFetch([
      { status: 200, body: { choices: [{ message: { content: 'answer' } }] } },
    ]);
    await getAiClient(openaiSettings).chat(MESSAGES, { json: false, schema: AGENT_LIKE });
    expect(sentBodies[0]).not.toHaveProperty('response_format');
  });

  it('aborting the signal rejects with "Stopped."', async () => {
    setAiFetch(() => new Promise<Response>(() => undefined)); // fetch never resolves
    const ac = new AbortController();
    const p = getAiClient(openaiSettings).chat(MESSAGES, { signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toThrow('Stopped.');
    await expect(p).rejects.toBeInstanceOf(AiClientError);
  });

  it('an already-aborted signal sends nothing', async () => {
    const sentBodies = sequenceFetch([{ status: 200, body: {} }]);
    const ac = new AbortController();
    ac.abort();
    await expect(
      getAiClient(anthropicSettings).chat(MESSAGES, { signal: ac.signal }),
    ).rejects.toThrow('Stopped.');
    expect(sentBodies).toHaveLength(0);
  });

  it('the Anthropic wire puts the per-call schema in the prompt', async () => {
    const sentBodies = sequenceFetch([
      { status: 200, body: { content: [{ type: 'text', text: '{}' }], stop_reason: 'end_turn' } },
    ]);
    await getAiClient(anthropicSettings).chat(MESSAGES, { schema: AGENT_LIKE });
    expect(sentBodies[0].system).toContain('bolid_agent_action');
    expect(sentBodies[0].response_format).toBeUndefined();
  });

  it('the mock client accepts the chat options', async () => {
    const g = globalThis as { __DEV__?: boolean };
    g.__DEV__ = true;
    try {
      const client = getAiClient({ provider: 'custom', baseUrl: 'mock://ai', model: '' });
      const text = await client.chat(MESSAGES, { schema: AGENT_LIKE });
      expect(JSON.parse(text ?? '{}')).toHaveProperty('overall');
    } finally {
      delete g.__DEV__;
    }
  });
});
