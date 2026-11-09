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
