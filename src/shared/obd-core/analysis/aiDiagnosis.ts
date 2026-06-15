/** Pure logic for the AI auto-diagnosis feature. Builds a structured snapshot of everything we read
 *  from the car, turns it into a prompt for an OpenAI-compatible chat endpoint (e.g. an LM Studio
 *  server), and parses the model's JSON answer back into a typed report. A deterministic rule-based
 *  report (`localHeuristicReport`) is the fallback when the model is unavailable or returns garbage,
 *  so the feature is always useful and is fully unit-testable with **no network and no device**.
 *
 *  The network call itself lives in the feature layer (`features/ai-diagnose/api/aiClient`) — this
 *  module only shapes requests and parses responses, mirroring how `analysis/notifications` is pure
 *  while `shared/notify` does the I/O. See docs/features/ai-diagnose.md. */

import type { Dtc } from '../obd/dtc';
import type { MonitorStatus } from '../obd/readiness';
import type { ProtocolId } from '../obd/protocols';
import type { LiveValue, FreezeFrame } from '../session/DiagnosticSession';

// ----------------------------------------------------------------------------- types

export const DIAG_SEVERITIES = ['ok', 'info', 'warn', 'critical'] as const;
export type DiagSeverity = (typeof DIAG_SEVERITIES)[number];

export const OVERALL_HEALTH = ['ok', 'attention', 'urgent'] as const;
export type OverallHealth = (typeof OVERALL_HEALTH)[number];

/** Actions the report may recommend. The UI only renders the ones it recognises, and `clear_dtcs`
 *  is always gated behind an explicit confirmation — the model can suggest it but never run it. */
export const AI_ACTION_TYPES = ['clear_dtcs', 'recheck', 'monitor', 'inspect', 'service'] as const;
export type AiActionType = (typeof AI_ACTION_TYPES)[number];

/** Details of the car under test, passed to the model as default context so its analysis is
 *  tailored to the specific vehicle (engine, fuel, expected transport, known quirks). Decoupled from
 *  the vehicle-registry `VehicleProfile` type to keep obd-core dependency-free. */
export interface VehicleContext {
  /** Display label, e.g. "VW Golf Plus 2009 (2009)" or "Auto / Generic OBD2". */
  label: string;
  year?: number;
  engine?: string;
  fuel?: string;
  /** Expected/known OBD2 transport for this car (a profile hint, not the live-detected protocol). */
  expectedProtocol?: string;
  /** Free-form profile notes (quirks, what works/doesn't on this car). */
  notes?: string;
}

/** Everything we gathered from the car in one read pass. The unit of input to the analysis. */
export interface DiagnosticSnapshot {
  protocol: ProtocolId;
  vin: string | null;
  /** Adapter-reported battery/control-module voltage (ELM327 `ATRV`), volts. */
  voltage: number | null;
  supportedPidCount: number;
  readiness: MonitorStatus | null;
  dtcs: { stored: Dtc[]; pending: Dtc[]; permanent: Dtc[] };
  freezeFrame: FreezeFrame | null;
  /** One-shot poll of the key live parameters that were supported. */
  live: LiveValue[];
  /** Details of the selected/identified vehicle profile, given to the model as default context. */
  vehicle?: VehicleContext;
}

export interface AiFinding {
  title: string;
  severity: DiagSeverity;
  detail: string;
  /** Related DTC codes, if any. */
  codes?: string[];
  likelyCauses?: string[];
}

export interface AiAction {
  type: AiActionType;
  label: string;
  detail?: string;
}

export interface AiReport {
  overall: OverallHealth;
  summary: string;
  findings: AiFinding[];
  actions: AiAction[];
  /** Where this report came from: the model, or the local rule-based fallback. */
  source: 'ai' | 'local';
  disclaimer: string;
}

export interface AiChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Connection settings for the OpenAI-compatible endpoint (LM Studio, llama.cpp server, etc.). */
export interface AiClientConfig {
  /** Base URL of the server, with or without a trailing `/v1` — see {@link normalizeBaseUrl}. */
  baseUrl: string;
  model: string;
  apiKey?: string;
  timeoutMs?: number;
  /** Structured-output mode: 'schema' (json_schema — modern LM Studio / current OpenAI), 'object'
   *  (json_object — older OpenAI), or 'off' (plain text + tolerant parsing). Defaults to 'schema'. */
  jsonMode?: 'schema' | 'object' | 'off';
}

// ------------------------------------------------------------------------- constants

/** Live PIDs the diagnosis polls (intersected with what the ECU actually supports). */
export const KEY_DIAGNOSTIC_PIDS = [
  '0105', // coolant temp
  '010C', // RPM
  '0104', // engine load
  '010B', // intake MAP
  '010F', // intake air temp
  '0110', // MAF
  '0106', // short fuel trim B1
  '0107', // long fuel trim B1
  '010D', // vehicle speed
  '012F', // fuel level
  '0142', // control module voltage
  '015C', // engine oil temp
  '0111', // throttle
  '0133', // barometric pressure
  '0146', // ambient air temp
] as const;

const DISCLAIMER_AI =
  'AI-generated from your car’s live OBD2 data. It can be wrong — verify before acting, and it is ' +
  'not a substitute for inspection by a qualified mechanic.';
const DISCLAIMER_LOCAL =
  'Generated on-device from rule-based checks (the AI server was unavailable). Not a substitute for ' +
  'inspection by a qualified mechanic.';

// --------------------------------------------------------------------- URL handling

/** Normalise a user-entered server URL to an OpenAI-style API base ending in `/v1` (no trailing
 *  slash). Accepts `http://host:1234`, `http://host:1234/`, or `.../v1`. Returns '' for blank input. */
export function normalizeBaseUrl(url: string): string {
  let u = (url ?? '').trim();
  if (!u) return '';
  u = u.replace(/\/+$/, ''); // strip trailing slashes
  if (!/\/v\d+$/.test(u)) u = `${u}/v1`;
  return u;
}

// ------------------------------------------------------------------- snapshot → text

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function liveLine(v: LiveValue): string {
  return `- ${v.name}: ${fmt(v.value)} ${v.unit}`.trimEnd();
}

/** Deterministic, human-readable digest of the snapshot. Used both as the model's evidence and as
 *  the body of the local fallback report, so the two stay consistent. */
export function summarizeSnapshot(s: DiagnosticSnapshot): string {
  const lines: string[] = [];
  if (s.vehicle) {
    const v = s.vehicle;
    lines.push(`Vehicle: ${v.label}`);
    const specs: string[] = [];
    if (v.engine) specs.push(`engine ${v.engine}`);
    if (v.fuel) specs.push(`fuel ${v.fuel}`);
    if (v.expectedProtocol) specs.push(`expected transport ${v.expectedProtocol}`);
    if (specs.length) lines.push(`  Specs: ${specs.join(', ')}.`);
    if (v.notes) lines.push(`  Profile notes: ${v.notes}`);
  } else {
    lines.push('Vehicle: unknown / generic OBD2');
  }
  lines.push(`Protocol (live-detected): ${s.protocol}`);
  if (s.vin) lines.push(`VIN: ${s.vin}`);
  if (s.voltage !== null) lines.push(`Battery/module voltage: ${fmt(s.voltage)} V`);
  lines.push(`Supported live PIDs: ${s.supportedPidCount}`);

  if (s.readiness) {
    const sup = s.readiness.monitors.filter((m) => m.supported);
    const done = sup.filter((m) => m.complete).length;
    const notReady = sup.filter((m) => !m.complete).map((m) => m.name);
    lines.push(
      `MIL (check-engine light): ${s.readiness.milOn ? 'ON' : 'off'}; reported DTC count: ${s.readiness.dtcCount}; ` +
        `ignition: ${s.readiness.ignition}.`,
    );
    lines.push(`Readiness monitors: ${done}/${sup.length} complete.`);
    if (notReady.length) lines.push(`Monitors not ready: ${notReady.join(', ')}.`);
  } else {
    lines.push('Readiness: not available.');
  }

  const dtcText = (label: string, list: Dtc[]) =>
    lines.push(
      list.length
        ? `${label} DTCs (${list.length}): ${list.map((d) => `${d.code} — ${d.description}`).join('; ')}.`
        : `${label} DTCs: none.`,
    );
  dtcText('Stored', s.dtcs.stored);
  dtcText('Pending', s.dtcs.pending);
  dtcText('Permanent', s.dtcs.permanent);

  if (s.freezeFrame && s.freezeFrame.values.length) {
    lines.push(
      `Freeze frame (captured when ${s.freezeFrame.triggerDtc ?? 'a code'} set): ` +
        s.freezeFrame.values.map((v) => `${v.name} ${fmt(v.value)} ${v.unit}`).join(', ') +
        '.',
    );
  }

  if (s.live.length) {
    lines.push('Live readings:');
    for (const v of s.live) lines.push(liveLine(v));
  } else {
    lines.push('Live readings: none captured.');
  }

  return lines.join('\n');
}

// --------------------------------------------------------------- local heuristics

function liveValue(s: DiagnosticSnapshot, pid: string): number | undefined {
  return s.live.find((v) => v.pid === pid)?.value;
}

export function overallFromFindings(findings: AiFinding[]): OverallHealth {
  if (findings.some((f) => f.severity === 'critical')) return 'urgent';
  if (findings.some((f) => f.severity === 'warn')) return 'attention';
  return 'ok';
}

/** Rule-based assessment: flags the obvious stuff (MIL, DTCs, overheating, over-fuel-trim, low
 *  charging voltage, emissions not ready). Deterministic and dependency-free. */
export function localHeuristicReport(s: DiagnosticSnapshot): AiReport {
  const findings: AiFinding[] = [];

  if (s.readiness?.milOn) {
    findings.push({
      title: 'Check-engine light is on',
      severity: 'critical',
      detail:
        'The MIL is illuminated, so the ECU has recorded an emissions-related fault. Review the ' +
        'stored codes below.',
    });
  }

  for (const d of s.dtcs.stored)
    findings.push({
      title: `${d.code} (stored)`,
      severity: 'warn',
      detail: d.description,
      codes: [d.code],
    });
  for (const d of s.dtcs.permanent)
    findings.push({
      title: `${d.code} (permanent)`,
      severity: 'warn',
      detail:
        `${d.description}. Permanent codes clear themselves only after the fault is fixed and ` +
        `the monitor re-runs — they cannot be erased with a scan tool.`,
      codes: [d.code],
    });
  for (const d of s.dtcs.pending)
    findings.push({
      title: `${d.code} (pending)`,
      severity: 'info',
      detail:
        `${d.description}. Pending codes appear before a fault is confirmed; it may clear on ` +
        `its own if it does not recur.`,
      codes: [d.code],
    });

  const coolant = liveValue(s, '0105');
  if (coolant !== undefined && coolant >= 115)
    findings.push({
      title: 'Coolant temperature very high',
      severity: 'critical',
      detail: `Coolant is ${fmt(coolant)} °C. Risk of overheating — stop and let the engine cool before driving on.`,
    });
  else if (coolant !== undefined && coolant >= 105)
    findings.push({
      title: 'Coolant temperature high',
      severity: 'warn',
      detail: `Coolant is ${fmt(coolant)} °C, above the normal ~90 °C band. Watch the gauge and check coolant level/cooling fan.`,
    });

  const oil = liveValue(s, '015C');
  if (oil !== undefined && oil >= 135)
    findings.push({
      title: 'Engine oil temperature high',
      severity: 'warn',
      detail: `Oil is ${fmt(oil)} °C. Sustained high oil temperature accelerates wear; ease off and check oil level/cooling.`,
    });

  const ltft = liveValue(s, '0107');
  if (ltft !== undefined && Math.abs(ltft) >= 12)
    findings.push({
      title: ltft > 0 ? 'Fuel mixture running lean' : 'Fuel mixture running rich',
      severity: 'warn',
      detail: `Long-term fuel trim is ${fmt(ltft)} %. ${ltft > 0 ? 'Lean trims this high suggest an intake/vacuum leak, weak fuel delivery, or a MAF reading low.' : 'Rich trims this high suggest a leaking injector, high fuel pressure, or a MAF reading high.'}`,
    });

  const rpm = liveValue(s, '010C');
  const volts = liveValue(s, '0142') ?? s.voltage ?? undefined;
  if (volts !== undefined) {
    if (rpm !== undefined && rpm > 300 && volts < 13.0)
      findings.push({
        title: 'Charging voltage low',
        severity: 'warn',
        detail: `With the engine running, system voltage is ${fmt(volts)} V (expected ~13.5–14.5 V). Check the alternator and belt.`,
      });
    else if ((rpm === undefined || rpm <= 300) && volts < 12.2)
      findings.push({
        title: 'Battery voltage low',
        severity: 'info',
        detail: `Resting voltage is ${fmt(volts)} V (a healthy 12 V battery rests near 12.6 V). It may be discharged or ageing.`,
      });
  }

  if (s.readiness) {
    const notReady = s.readiness.monitors.filter((m) => m.supported && !m.complete);
    if (notReady.length)
      findings.push({
        title: 'Emissions monitors not ready',
        severity: 'info',
        detail:
          `${notReady.length} monitor(s) incomplete: ${notReady.map((m) => m.name).join(', ')}. ` +
          `The car may fail an emissions test until a full drive cycle completes (common right after clearing codes or a battery disconnect).`,
      });
  }

  const overall = overallFromFindings(findings);
  const hasCodes =
    s.dtcs.stored.length > 0 || s.dtcs.pending.length > 0 || s.dtcs.permanent.length > 0;

  const summary =
    findings.length === 0
      ? 'No problems detected in the data read from the engine/emissions ECU. Live values are within normal ranges and no fault codes are stored.'
      : overall === 'urgent'
        ? 'At least one urgent issue was found. Review the findings and address the critical items before driving further.'
        : overall === 'attention'
          ? 'Some issues need attention. None are immediately critical, but they should be investigated.'
          : 'Minor, informational notes only — nothing requiring immediate action.';

  const actions: AiAction[] = [];
  if (s.dtcs.stored.length > 0 || s.dtcs.pending.length > 0)
    actions.push({
      type: 'clear_dtcs',
      label: 'Clear fault codes',
      detail: 'Erase stored/pending codes and reset readiness monitors. Codes return if the fault persists.',
    });
  if (hasCodes)
    actions.push({
      type: 'inspect',
      label: 'Inspect the flagged systems',
      detail: 'Follow up on the codes/systems above.',
    });
  actions.push({ type: 'recheck', label: 'Re-run diagnosis', detail: 'Read the car again to confirm.' });

  return { overall, summary, findings, actions, source: 'local', disclaimer: DISCLAIMER_LOCAL };
}

// ------------------------------------------------------------------ prompt building

const REPORT_SCHEMA_HINT = `Return ONLY a JSON object, no prose, no markdown fences, with this shape:
{
  "overall": "ok" | "attention" | "urgent",
  "summary": string,                 // 1-3 sentences, plain language
  "findings": [
    {
      "title": string,
      "severity": "ok" | "info" | "warn" | "critical",
      "detail": string,              // what it means and why
      "codes": string[],             // related DTCs, optional
      "likelyCauses": string[]       // optional, most-likely first
    }
  ],
  "actions": [
    { "type": "clear_dtcs" | "recheck" | "monitor" | "inspect" | "service", "label": string, "detail": string }
  ]
}`;

export function buildSystemPrompt(): string {
  return [
    'You are an expert automotive diagnostic assistant embedded in a generic OBD2/EOBD scan-tool app.',
    'You receive a snapshot read from a car’s engine/emissions ECU over a standard ELM327 adapter and',
    'produce a concise, practical health assessment for the car’s owner.',
    '',
    'Rules:',
    '- The snapshot starts with the vehicle’s details (make/model/year/engine/fuel where known) — tailor your analysis to that specific car and its fuel type.',
    '- Use ONLY the data provided. Do not invent readings, mileage, or codes that are not present.',
    '- A generic OBD2 adapter only reaches the engine/emissions ECU — do not claim ABS/airbag/transmission findings.',
    '- Be specific and prioritise. Map symptoms to the most likely causes; say what to check.',
    '- Severities: "critical" = stop/urgent safety or damage risk; "warn" = needs attention soon; "info" = FYI; "ok" = normal.',
    '- Set "overall" to the worst severity among findings ("urgent" if any critical, "attention" if any warn, else "ok").',
    '- Only suggest "clear_dtcs" when codes are present; clearing is destructive and the user must confirm it.',
    '- Do not give a definitive repair guarantee; you are an aid, not a substitute for a mechanic.',
    '',
    REPORT_SCHEMA_HINT,
  ].join('\n');
}

export function buildDiagnosisMessages(s: DiagnosticSnapshot): AiChatMessage[] {
  return [
    { role: 'system', content: buildSystemPrompt() },
    {
      role: 'user',
      content:
        'Here is the OBD2 snapshot from my car. Analyse it and return the JSON report.\n\n' +
        summarizeSnapshot(s),
    },
  ];
}

/** JSON Schema describing the diagnosis report — used for `response_format: json_schema` (the modern
 *  structured-output mode that LM Studio and current OpenAI require). Kept permissive (no strict
 *  all-required rules) so a range of servers/models accept it; `parseAiReport` sanitises the result. */
export const REPORT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    overall: { type: 'string', enum: ['ok', 'attention', 'urgent'] },
    summary: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          severity: { type: 'string', enum: ['ok', 'info', 'warn', 'critical'] },
          detail: { type: 'string' },
          codes: { type: 'array', items: { type: 'string' } },
          likelyCauses: { type: 'array', items: { type: 'string' } },
        },
        required: ['title', 'severity', 'detail'],
      },
    },
    actions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['clear_dtcs', 'recheck', 'monitor', 'inspect', 'service'] },
          label: { type: 'string' },
          detail: { type: 'string' },
        },
        required: ['type', 'label'],
      },
    },
  },
  required: ['overall', 'summary', 'findings', 'actions'],
} as const;

/** Build the body for `POST {base}/chat/completions` (OpenAI-compatible). */
export function buildChatRequestBody(
  messages: AiChatMessage[],
  config: AiClientConfig,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    stream: false,
  };
  const mode = config.jsonMode ?? 'schema';
  if (mode === 'schema') {
    body.response_format = {
      type: 'json_schema',
      json_schema: { name: 'obd_diagnosis_report', strict: false, schema: REPORT_JSON_SCHEMA },
    };
  } else if (mode === 'object') {
    body.response_format = { type: 'json_object' };
  }
  return body;
}

// --------------------------------------------------------------- response parsing

/** Pull the assistant text out of an OpenAI-compatible chat-completions response. Tolerant of the
 *  `content`-as-array variant some servers emit. Returns null if nothing usable is present. */
export function extractMessageContent(json: unknown): string | null {
  const choices = (json as { choices?: unknown })?.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const msg = (choices[0] as { message?: { content?: unknown } })?.message;
  const content = msg?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const text = content
      .map((p) => (typeof p === 'string' ? p : ((p as { text?: string })?.text ?? '')))
      .join('');
    return text || null;
  }
  return null;
}

/** Extract the first balanced JSON object from a string that may be fenced or wrapped in prose. */
function extractJsonObject(text: string): string | null {
  let t = text.trim();
  // strip a leading ```json / ``` fence and the trailing fence, if present
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return t.slice(start, end + 1);
}

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
  return out.length ? out : undefined;
}

function coerceSeverity(v: unknown): DiagSeverity {
  return (DIAG_SEVERITIES as readonly string[]).includes(v as string) ? (v as DiagSeverity) : 'info';
}

function sanitizeFindings(v: unknown): AiFinding[] {
  if (!Array.isArray(v)) return [];
  const out: AiFinding[] = [];
  for (const raw of v) {
    const o = raw as Record<string, unknown>;
    const title = asString(o?.title).trim();
    const detail = asString(o?.detail).trim();
    if (!title && !detail) continue;
    out.push({
      title: title || 'Finding',
      severity: coerceSeverity(o?.severity),
      detail,
      codes: asStringArray(o?.codes),
      likelyCauses: asStringArray(o?.likelyCauses),
    });
  }
  return out;
}

function sanitizeActions(v: unknown): AiAction[] {
  if (!Array.isArray(v)) return [];
  const out: AiAction[] = [];
  for (const raw of v) {
    const o = raw as Record<string, unknown>;
    const type = o?.type as string;
    if (!(AI_ACTION_TYPES as readonly string[]).includes(type)) continue;
    out.push({
      type: type as AiActionType,
      label: asString(o?.label).trim() || type,
      detail: asString(o?.detail).trim() || undefined,
    });
  }
  return out;
}

function coerceOverall(v: unknown, findings: AiFinding[]): OverallHealth {
  return (OVERALL_HEALTH as readonly string[]).includes(v as string)
    ? (v as OverallHealth)
    : overallFromFindings(findings);
}

/** Parse the model's answer into an AiReport. Falls back to {@link localHeuristicReport} when the
 *  text is missing, unparseable, or empty — so the caller always gets a usable report. */
export function parseAiReport(content: string | null, snapshot: DiagnosticSnapshot): AiReport {
  if (!content) return localHeuristicReport(snapshot);
  const jsonText = extractJsonObject(content);
  if (!jsonText) return localHeuristicReport(snapshot);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return localHeuristicReport(snapshot);
  }

  const o = parsed as Record<string, unknown>;
  const findings = sanitizeFindings(o?.findings);
  const summary = asString(o?.summary).trim();
  if (!summary && findings.length === 0) return localHeuristicReport(snapshot);

  return {
    overall: coerceOverall(o?.overall, findings),
    summary: summary || 'Analysis complete.',
    findings,
    actions: sanitizeActions(o?.actions),
    source: 'ai',
    disclaimer: DISCLAIMER_AI,
  };
}
