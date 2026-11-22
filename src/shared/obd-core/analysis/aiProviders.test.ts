import {
  AI_PROVIDER_PRESETS,
  ANTHROPIC_API_VERSION,
  aiConfigProblem,
  anthropicHeaders,
  anthropicStopReason,
  applyProviderPreset,
  buildAnthropicRequestBody,
  extractAnthropicContent,
  inferProvider,
  isMockAiUrl,
  resolveProvider,
  schemaPromptHint,
  type AiPresetFields,
} from './aiProviders';
import type { AiChatMessage } from './aiDiagnosis';

const LOCAL: AiPresetFields = {
  provider: 'local',
  baseUrl: 'http://192.168.1.50:1234',
  model: 'qwen2.5-7b-instruct',
  jsonMode: 'object',
};

describe('inferProvider', () => {
  it('recognises the two cloud hosts in any URL form', () => {
    expect(inferProvider('https://api.openai.com')).toBe('openai');
    expect(inferProvider('https://api.openai.com/v1/')).toBe('openai');
    expect(inferProvider('api.openai.com/v1')).toBe('openai');
    expect(inferProvider('https://api.anthropic.com')).toBe('anthropic');
    expect(inferProvider('HTTPS://API.ANTHROPIC.COM/v1')).toBe('anthropic');
  });

  it('blank is local, anything else is custom', () => {
    expect(inferProvider('')).toBe('local');
    expect(inferProvider('   ')).toBe('local');
    expect(inferProvider('http://192.168.1.50:1234')).toBe('custom');
    expect(inferProvider('https://openrouter.ai/api')).toBe('custom');
    // a look-alike host is not the cloud provider
    expect(inferProvider('https://api.openai.com.evil.example')).toBe('custom');
  });

  it('resolveProvider prefers an explicit provider', () => {
    expect(resolveProvider({ provider: 'local', baseUrl: 'http://10.0.0.2:1234' })).toBe('local');
    expect(resolveProvider({ baseUrl: 'https://api.anthropic.com' })).toBe('anthropic');
  });
});

describe('presets', () => {
  it('Anthropic speaks the Messages wire with JSON mode off and needs a key', () => {
    const a = AI_PROVIDER_PRESETS.anthropic;
    expect(a.wire).toBe('anthropic-messages');
    expect(a.baseUrl).toBe('https://api.anthropic.com');
    expect(a.defaultModel).toBe('claude-sonnet-5-5');
    expect(a.jsonMode).toBe('off');
    expect(a.needsKey).toBe(true);
  });

  it('local needs no key and leaves the model to Detect', () => {
    expect(AI_PROVIDER_PRESETS.local.needsKey).toBe(false);
    expect(AI_PROVIDER_PRESETS.local.defaultModel).toBe('');
    expect(AI_PROVIDER_PRESETS.openai.wire).toBe('openai-chat');
    for (const p of Object.values(AI_PROVIDER_PRESETS)) expect(p.hint.length).toBeGreaterThan(0);
  });
});

describe('applyProviderPreset', () => {
  it('local → anthropic fills the URL, claude-sonnet-5-5 and JSON mode off', () => {
    const a = applyProviderPreset(LOCAL, 'anthropic');
    expect(a.provider).toBe('anthropic');
    expect(a.baseUrl).toBe('https://api.anthropic.com');
    expect(a.model).toBe('claude-sonnet-5-5');
    expect(a.jsonMode).toBe('off');
  });

  it('switching back to local restores the user URL, model and output mode', () => {
    const back = applyProviderPreset(applyProviderPreset(LOCAL, 'anthropic'), 'local');
    expect(back.provider).toBe('local');
    expect(back.baseUrl).toBe('http://192.168.1.50:1234');
    expect(back.model).toBe('qwen2.5-7b-instruct');
    expect(back.jsonMode).toBe('object');
  });

  it('remembers a model the user picked on a cloud provider', () => {
    const a = { ...applyProviderPreset(LOCAL, 'anthropic'), model: 'claude-opus-5-5' };
    const again = applyProviderPreset(applyProviderPreset(a, 'openai'), 'anthropic');
    expect(again.model).toBe('claude-opus-5-5');
    expect(again.baseUrl).toBe('https://api.anthropic.com');
  });

  it('carries a typed URL between local and custom, never a cloud host into local', () => {
    expect(applyProviderPreset(LOCAL, 'custom').baseUrl).toBe('http://192.168.1.50:1234');
    const fresh: AiPresetFields = {
      provider: 'openai',
      baseUrl: 'https://api.openai.com',
      model: 'm',
      jsonMode: 'schema',
    };
    expect(applyProviderPreset(fresh, 'local').baseUrl).toBe('');
    // the "edit the address" path: a cloud host is a starting point for a custom server
    expect(applyProviderPreset(fresh, 'custom').baseUrl).toBe('https://api.openai.com');
  });

  it('is a no-op for the same provider', () => {
    expect(applyProviderPreset(LOCAL, 'local')).toBe(LOCAL);
  });
});

describe('aiConfigProblem', () => {
  const base = {
    enabled: true,
    provider: 'anthropic' as const,
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-sonnet-5-5',
    apiKey: 'sk-ant',
  };
  it('null when everything needed is set', () => {
    expect(aiConfigProblem(base)).toBeNull();
    expect(
      aiConfigProblem({ enabled: true, provider: 'local', baseUrl: 'http://x:1234', model: 'm' }),
    ).toBeNull();
  });
  it('names the missing piece', () => {
    expect(aiConfigProblem({ ...base, enabled: false })).toMatch(/turned off/);
    expect(aiConfigProblem({ ...base, baseUrl: '' })).toMatch(/No AI server/);
    expect(aiConfigProblem({ ...base, apiKey: ' ' })).toMatch(/No API key for Anthropic/);
    expect(aiConfigProblem({ ...base, model: '' })).toMatch(/No model/);
  });
  it('the dev mock address needs nothing else', () => {
    expect(
      aiConfigProblem({ enabled: true, provider: 'custom', baseUrl: 'mock://ai', model: '' }),
    ).toBeNull();
    expect(isMockAiUrl('mock://ai/v1/')).toBe(true);
    expect(isMockAiUrl('http://mock')).toBe(false);
  });
});

describe('Anthropic Messages shaping', () => {
  const cfg = { baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-5-5' };

  it('splits system out, merges consecutive user turns and sets max_tokens', () => {
    const messages: AiChatMessage[] = [
      { role: 'system', content: 'You are a mechanic.' },
      { role: 'user', content: 'Snapshot' },
      { role: 'user', content: 'Focus on P0401' },
      { role: 'assistant', content: '{"overall":"ok"}' },
      { role: 'user', content: 'What first?' },
    ];
    const body = buildAnthropicRequestBody(messages, cfg, 1234);
    expect(body).toEqual({
      model: 'claude-sonnet-5-5',
      max_tokens: 1234,
      system: 'You are a mechanic.',
      messages: [
        { role: 'user', content: 'Snapshot\n\nFocus on P0401' },
        { role: 'assistant', content: '{"overall":"ok"}' },
        { role: 'user', content: 'What first?' },
      ],
    });
    // nothing the 2026-10-21 API version rejects
    for (const k of ['temperature', 'top_p', 'top_k', 'response_format', 'stream'])
      expect(body).not.toHaveProperty(k);
  });

  it('defaults max_tokens, joins several system messages and fixes a leading assistant turn', () => {
    const body = buildAnthropicRequestBody(
      [
        { role: 'system', content: 'A' },
        { role: 'system', content: 'B' },
        { role: 'assistant', content: 'hi' },
      ],
      cfg,
    );
    expect(body.max_tokens).toBeGreaterThanOrEqual(2048);
    expect(body.system).toBe('A\n\nB');
    expect((body.messages as { role: string }[]).map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  it('buildAnthropicRequestBody appends the schema hint to system', () => {
    const msgs: AiChatMessage[] = [
      { role: 'system', content: 'You are a mechanic.' },
      { role: 'user', content: 'Snapshot' },
    ];
    const body = buildAnthropicRequestBody(msgs, cfg, 1024, {
      name: 'bolid_agent_action',
      schema: { type: 'object' },
    });
    expect(body.system).toContain('matching this JSON Schema (bolid_agent_action)');
    expect(body.system).toContain('{"type":"object"}');
    expect(String(body.system).startsWith('You are a mechanic.\n\n')).toBe(true);
    expect(body).not.toHaveProperty('response_format');
  });

  it('schemaPromptHint is the exact one-object instruction plus the schema JSON', () => {
    expect(schemaPromptHint({ name: 'x', schema: { type: 'object' } })).toBe(
      'Reply with ONE JSON object only, no prose, matching this JSON Schema (x):\n{"type":"object"}',
    );
    // with no system message the hint alone becomes the system text
    const body = buildAnthropicRequestBody([{ role: 'user', content: 'hi' }], cfg, 10, {
      name: 'x',
      schema: { type: 'object' },
    });
    expect(body.system).toBe(schemaPromptHint({ name: 'x', schema: { type: 'object' } }));
  });

  it('extractAnthropicContent joins text blocks and skips the rest', () => {
    expect(
      extractAnthropicContent({
        content: [
          { type: 'thinking', thinking: '' },
          { type: 'text', text: 'Part one' },
          { type: 'text', text: 'Part two' },
        ],
      }),
    ).toBe('Part one\nPart two');
  });

  it('extractAnthropicContent returns null for empty or malformed responses', () => {
    expect(extractAnthropicContent({ content: [] })).toBeNull();
    expect(extractAnthropicContent({ content: [{ type: 'text', text: '  ' }] })).toBeNull();
    expect(extractAnthropicContent({})).toBeNull();
    expect(extractAnthropicContent(null)).toBeNull();
  });

  it('anthropicHeaders carries the key, the API version and the content type', () => {
    const h = anthropicHeaders('sk-ant-test');
    expect(h['x-api-key']).toBe('sk-ant-test');
    expect(h['anthropic-version']).toBe(ANTHROPIC_API_VERSION);
    expect(h['content-type']).toBe('application/json');
    expect(h).not.toHaveProperty('Authorization');
  });

  it('anthropicStopReason reads stop_reason', () => {
    expect(anthropicStopReason({ stop_reason: 'refusal' })).toBe('refusal');
    expect(anthropicStopReason({})).toBeNull();
  });
});
