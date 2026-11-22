/** The agent's one-action-per-turn reply format (plan 34a). Each model turn answers with one JSON
 *  object holding either a tool call (`tool`, `args`, `why`) or the final report (`final`). The
 *  structured-output schema is deliberately flat (no `anyOf`) so permissive local servers accept
 *  it; the app, not the schema, enforces "exactly one of tool / final" and each tool's arguments.
 *  Error strings are fed back to the model verbatim, so they stay short and English. */

import { REPORT_JSON_SCHEMA, extractJsonObject, type AiJsonSchema } from '../analysis/aiDiagnosis';
import type { ToolArgProp, ToolArgSchema } from './types';

export const AGENT_ACTION_SCHEMA_NAME = 'bolid_agent_action';

/** Longest `why` kept from a tool action. */
const MAX_WHY_CHARS = 200;

const REPLY_WITH_JSON = 'Reply with one JSON object.';

const REPORT_FINDING_ITEMS = REPORT_JSON_SCHEMA.properties.findings.items;

/** The report schema with each finding also carrying the step ids it rests on. */
const FINAL_REPORT_SCHEMA = {
  ...REPORT_JSON_SCHEMA,
  properties: {
    ...REPORT_JSON_SCHEMA.properties,
    findings: {
      ...REPORT_JSON_SCHEMA.properties.findings,
      items: {
        ...REPORT_FINDING_ITEMS,
        properties: {
          ...REPORT_FINDING_ITEMS.properties,
          steps: { type: 'array', items: { type: 'integer' } },
        },
      },
    },
  },
};

/** The structured-output schema for one agent turn: a flat object whose `tool` is an enum of the
 *  tools offered this run. Nothing is required — `parseAgentAction` validates. */
export function buildActionSchema(toolNames: string[]): AiJsonSchema {
  return {
    name: AGENT_ACTION_SCHEMA_NAME,
    schema: {
      type: 'object',
      properties: {
        tool: { type: 'string', enum: [...toolNames] },
        args: { type: 'object' },
        why: { type: 'string' },
        final: FINAL_REPORT_SCHEMA,
      },
      required: [],
    },
  };
}

export type ParsedAction =
  | { kind: 'tool'; tool: string; args: Record<string, unknown>; why: string }
  | { kind: 'final'; final: unknown }
  | { kind: 'invalid'; error: string };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function hasOwn(o: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(o, key);
}

/** The first balanced `{…}` in `text` (string- and escape-aware), or null when none closes. */
function firstBalancedObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** Parse the model's reply into one JSON object: fence and prose stripped, and when the model sent
 *  more than one object, the first balanced one wins. */
function parseReplyObject(text: string | null): Record<string, unknown> | null {
  if (!text) return null;
  const region = extractJsonObject(text);
  if (!region) return null;
  const json = firstBalancedObject(region) ?? region;
  try {
    const value: unknown = JSON.parse(json);
    return isPlainObject(value) ? value : null;
  } catch {
    return null;
  }
}

/** A key the model filled with null (or left out) counts as absent. */
function isAbsent(v: unknown): boolean {
  return v === undefined || v === null;
}

/** Turn one model reply into a tool call, a final report or an error message for the model. A reply
 *  carrying both `tool` and `final` is invalid — never half-executed. */
export function parseAgentAction(
  text: string | null,
  tools: ReadonlyMap<string, { args: ToolArgSchema }>,
): ParsedAction {
  const raw = parseReplyObject(text);
  if (!raw) return { kind: 'invalid', error: REPLY_WITH_JSON };

  const hasTool = !isAbsent(raw.tool) && raw.tool !== '';
  const hasFinal = !isAbsent(raw.final);
  if (hasTool && hasFinal)
    return { kind: 'invalid', error: 'Send either "tool" or "final", not both.' };
  if (hasFinal) return { kind: 'final', final: raw.final };
  if (!hasTool) return { kind: 'invalid', error: 'Send either "tool" or "final".' };

  const name = String(raw.tool);
  const tool = typeof raw.tool === 'string' ? tools.get(raw.tool) : undefined;
  if (!tool) {
    return {
      kind: 'invalid',
      error: `Unknown tool ${JSON.stringify(name)}. Tools: ${[...tools.keys()].join(', ')}.`,
    };
  }

  const checked = validateArgs(tool.args, isAbsent(raw.args) ? {} : raw.args);
  if (!checked.ok) return { kind: 'invalid', error: `${name}: ${checked.error}` };

  const why = typeof raw.why === 'string' ? raw.why.trim().slice(0, MAX_WHY_CHARS) : '';
  return { kind: 'tool', tool: name, args: checked.value, why };
}

const TYPE_NOUN: Record<ToolArgProp['type'], string> = {
  string: 'a string',
  number: 'a number',
  integer: 'an integer',
  boolean: 'a boolean',
  array: 'an array',
};

function hasType(v: unknown, type: ToolArgProp['type']): boolean {
  switch (type) {
    case 'string':
      return typeof v === 'string';
    case 'number':
      return typeof v === 'number' && Number.isFinite(v);
    case 'integer':
      return typeof v === 'number' && Number.isInteger(v);
    case 'boolean':
      return typeof v === 'boolean';
    case 'array':
      return Array.isArray(v);
  }
}

/** The first problem with one argument value, or null when it fits its schema. */
function checkProp(name: string, prop: ToolArgProp, v: unknown): string | null {
  if (!hasType(v, prop.type)) return `${name} must be ${TYPE_NOUN[prop.type]}.`;
  if (prop.enum && !prop.enum.includes(v as string | number))
    return `${name} must be one of ${prop.enum.join(', ')}.`;
  if (typeof v === 'number') {
    if (prop.minimum !== undefined && v < prop.minimum)
      return `${name} must be at least ${prop.minimum}.`;
    if (prop.maximum !== undefined && v > prop.maximum)
      return `${name} must be at most ${prop.maximum}.`;
  }
  if (typeof v === 'string' && prop.pattern && !new RegExp(prop.pattern).test(v))
    return `${name} does not match ${prop.pattern}.`;
  if (Array.isArray(v)) {
    if (prop.maxItems !== undefined && v.length > prop.maxItems)
      return `${name} must have at most ${prop.maxItems} items.`;
    const items = prop.items;
    if (items) {
      for (let i = 0; i < v.length; i++) {
        const item: unknown = v[i];
        if (!hasType(item, items.type)) return `${name}[${i}] must be ${TYPE_NOUN[items.type]}.`;
        if (typeof item === 'string' && items.pattern && !new RegExp(items.pattern).test(item))
          return `${name}[${i}] does not match ${items.pattern}.`;
      }
    }
  }
  return null;
}

/** Check a tool's arguments against its schema and report the first problem. Keys the model set to
 *  null count as absent and are dropped from the returned value. */
export function validateArgs(
  schema: ToolArgSchema,
  args: unknown,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  if (!isPlainObject(args)) return { ok: false, error: 'args must be an object.' };
  const value: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(args)) {
    if (isAbsent(v)) continue;
    if (!hasOwn(schema.properties, key)) return { ok: false, error: `Unknown argument ${key}.` };
    value[key] = v;
  }
  for (const key of schema.required ?? []) {
    if (!hasOwn(value, key)) return { ok: false, error: `${key} is required.` };
  }
  for (const [key, prop] of Object.entries(schema.properties)) {
    if (!hasOwn(value, key)) continue;
    const error = checkProp(key, prop, value[key]);
    if (error) return { ok: false, error };
  }
  return { ok: true, value };
}
