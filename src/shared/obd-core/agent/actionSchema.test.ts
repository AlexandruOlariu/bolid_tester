import { buildActionSchema, parseAgentAction, validateArgs } from './actionSchema';
import type { ToolArgSchema } from './types';

const tools = new Map<string, { args: ToolArgSchema }>([
  [
    'read_live',
    {
      args: {
        type: 'object',
        properties: {
          pids: {
            type: 'array',
            items: { type: 'string', pattern: '^01[0-9A-F]{2}$' },
            maxItems: 8,
          },
          seconds: { type: 'integer', minimum: 0, maximum: 15 },
        },
        required: ['pids'],
      },
    },
  ],
]);

it('parses a tool action inside a code fence and prose', () =>
  expect(
    parseAgentAction(
      'Sure:\n```json\n{"tool":"read_live","args":{"pids":["010C"]},"why":"rpm"}\n```',
      tools,
    ),
  ).toEqual({ kind: 'tool', tool: 'read_live', args: { pids: ['010C'] }, why: 'rpm' }));

it('parses a final', () =>
  expect(parseAgentAction('{"final":{"overall":"ok"}}', tools).kind).toBe('final'));

it('rejects both tool and final', () =>
  expect(parseAgentAction('{"tool":"read_live","final":{}}', tools)).toEqual({
    kind: 'invalid',
    error: 'Send either "tool" or "final", not both.',
  }));

it('rejects an empty or non-JSON reply', () => {
  expect(parseAgentAction(null, tools)).toEqual({
    kind: 'invalid',
    error: 'Reply with one JSON object.',
  });
  expect(parseAgentAction('hello', tools)).toEqual({
    kind: 'invalid',
    error: 'Reply with one JSON object.',
  });
});

it('names the tools on an unknown tool', () =>
  expect(parseAgentAction('{"tool":"clear_dtcs"}', tools)).toEqual({
    kind: 'invalid',
    error: 'Unknown tool "clear_dtcs". Tools: read_live.',
  }));

it('reports the first bad argument', () => {
  expect(
    parseAgentAction('{"tool":"read_live","args":{"pids":["010C"],"seconds":60}}', tools),
  ).toEqual({ kind: 'invalid', error: 'read_live: seconds must be at most 15.' });
  expect(validateArgs(tools.get('read_live')!.args, {})).toEqual({
    ok: false,
    error: 'pids is required.',
  });
  expect(validateArgs(tools.get('read_live')!.args, { pids: ['0C'] })).toEqual({
    ok: false,
    error: 'pids[0] does not match ^01[0-9A-F]{2}$.',
  });
  expect(validateArgs(tools.get('read_live')!.args, { pids: ['010C'], x: 1 })).toEqual({
    ok: false,
    error: 'Unknown argument x.',
  });
});

it('trims "why" to 200 characters and defaults it to ""', () => {
  const a = parseAgentAction(
    JSON.stringify({ tool: 'read_live', args: { pids: ['010C'] }, why: 'w'.repeat(500) }),
    tools,
  );
  expect(a.kind === 'tool' && a.why.length).toBe(200);
  const b = parseAgentAction('{"tool":"read_live","args":{"pids":["010C"]}}', tools);
  expect(b.kind === 'tool' && b.why).toBe('');
});

it('buildActionSchema is flat: no anyOf, tool is an enum', () => {
  const s = buildActionSchema(['read_live', 'open_skill']);
  expect(JSON.stringify(s.schema)).not.toContain('anyOf');
  const props = s.schema.properties as Record<string, { enum?: unknown }>;
  expect(props.tool.enum).toEqual(['read_live', 'open_skill']);
  expect(s.name).toBe('bolid_agent_action');
});

// --- review focus and edge cases beyond the brief's minimum

it('uses the first balanced object when the model sends two', () => {
  expect(
    parseAgentAction(
      '{"tool":"read_live","args":{"pids":["010C"]},"why":"a {brace} in text"} {"tool":"read_live","args":{"pids":["0105"]}}',
      tools,
    ),
  ).toEqual({
    kind: 'tool',
    tool: 'read_live',
    args: { pids: ['010C'] },
    why: 'a {brace} in text',
  });
  expect(parseAgentAction('{"final":{"overall":"ok"}}\n{"tool":"read_live"}', tools)).toEqual({
    kind: 'final',
    final: { overall: 'ok' },
  });
});

it('treats a null tool or final as absent', () => {
  expect(parseAgentAction('{"tool":null,"args":null,"final":{"overall":"ok"}}', tools)).toEqual({
    kind: 'final',
    final: { overall: 'ok' },
  });
  expect(
    parseAgentAction('{"tool":"read_live","args":{"pids":["010C"]},"final":null}', tools).kind,
  ).toBe('tool');
});

it('rejects a reply with neither tool nor final, and a non-object JSON value', () => {
  expect(parseAgentAction('{"why":"thinking"}', tools)).toEqual({
    kind: 'invalid',
    error: 'Send either "tool" or "final".',
  });
  expect(parseAgentAction('[1,2]', tools)).toEqual({
    kind: 'invalid',
    error: 'Reply with one JSON object.',
  });
});

it('validates arguments by type, enum, bounds and array size', () => {
  const schema: ToolArgSchema = {
    type: 'object',
    properties: {
      mode: { type: 'string', enum: ['03', '07'] },
      n: { type: 'number', minimum: 1 },
      flag: { type: 'boolean' },
      ids: { type: 'array', items: { type: 'number' }, maxItems: 2 },
    },
  };
  expect(validateArgs(schema, [])).toEqual({ ok: false, error: 'args must be an object.' });
  expect(validateArgs(schema, { mode: '04' })).toEqual({
    ok: false,
    error: 'mode must be one of 03, 07.',
  });
  expect(validateArgs(schema, { mode: 3 })).toEqual({ ok: false, error: 'mode must be a string.' });
  expect(validateArgs(schema, { n: 0 })).toEqual({ ok: false, error: 'n must be at least 1.' });
  expect(validateArgs(schema, { n: '2' })).toEqual({ ok: false, error: 'n must be a number.' });
  expect(validateArgs(schema, { flag: 'yes' })).toEqual({
    ok: false,
    error: 'flag must be a boolean.',
  });
  expect(validateArgs(schema, { ids: 1 })).toEqual({ ok: false, error: 'ids must be an array.' });
  expect(validateArgs(schema, { ids: [1, 2, 3] })).toEqual({
    ok: false,
    error: 'ids must have at most 2 items.',
  });
  expect(validateArgs(schema, { ids: [1, 'x'] })).toEqual({
    ok: false,
    error: 'ids[1] must be a number.',
  });
  expect(validateArgs(tools.get('read_live')!.args, { pids: ['010C'], seconds: 1.5 })).toEqual({
    ok: false,
    error: 'seconds must be an integer.',
  });
  expect(validateArgs(schema, { mode: '07', n: 2, flag: true, ids: [1], x: null })).toEqual({
    ok: true,
    value: { mode: '07', n: 2, flag: true, ids: [1] },
  });
});

it('a missing args object counts as {} so required arguments are reported', () =>
  expect(parseAgentAction('{"tool":"read_live"}', tools)).toEqual({
    kind: 'invalid',
    error: 'read_live: pids is required.',
  }));

it('the final schema adds cited step ids to each finding', () => {
  const s = buildActionSchema(['read_live']);
  const props = s.schema.properties as Record<string, Record<string, unknown>>;
  expect(s.schema.required).toEqual([]);
  expect(props.args.type).toBe('object');
  expect(props.why.type).toBe('string');
  const findings = (props.final.properties as Record<string, { items: Record<string, unknown> }>)
    .findings;
  expect((findings.items.properties as Record<string, unknown>).steps).toEqual({
    type: 'array',
    items: { type: 'integer' },
  });
});
