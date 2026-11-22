/** Canned AI "server" for development (plan 19). Selected by the dispatcher when the AI address is
 *  `mock://ai` in a development build (`__DEV__`), so the AI report, the guide links under its
 *  findings and the follow-up conversation can be exercised in the simulator with no AI server or
 *  key. Deterministic: the report has one finding per fault code found in the snapshot digest, and a
 *  follow-up answer quotes the question and counts the turns. With the agent action schema (plan
 *  34a) it plays a scripted agent conversation chosen from the request line, so the agent loop can
 *  be exercised end to end. Never used in a release build.
 *  See docs/features/ai-diagnose.md#mock-ai-server. */

import { AGENT_ACTION_SCHEMA_NAME, type AiChatMessage } from '@/shared/obd-core';
import type { AiChatOptions } from '../http';

export const MOCK_AI_MODEL = 'mock-diagnostic-model';

export interface MockAiClient {
  listModels(): Promise<string[]>;
  chat(messages: AiChatMessage[], opts?: AiChatOptions): Promise<string | null>;
}

const CODE_RE = /\b[PCBU][0-3][0-9A-F]{3}\b/g;

/** Fault codes named in the user messages, in first-seen order. */
function codesIn(messages: AiChatMessage[]): string[] {
  const out: string[] = [];
  for (const m of messages) {
    if (m.role !== 'user') continue;
    for (const c of m.content.match(CODE_RE) ?? []) if (!out.includes(c)) out.push(c);
  }
  return out;
}

interface MockFinding {
  title: string;
  severity: string;
  detail: string;
  codes: string[];
  likelyCauses: string[];
  steps?: number[];
}

interface MockAction {
  type: string;
  label: string;
  detail: string;
}

const RECHECK: MockAction = {
  type: 'recheck',
  label: 'Re-run diagnosis',
  detail: 'Read the car again.',
};

/** The report body shared by the canned report and the default agent final: one `warn` finding per
 *  code (citing `steps` when given), `clear_dtcs` only when codes are present, then `recheck`. */
function mockReportBody(
  codes: string[],
  steps?: number[],
): { overall: string; summary: string; findings: MockFinding[]; actions: MockAction[] } {
  return {
    overall: codes.length ? 'attention' : 'ok',
    summary: codes.length
      ? `Mock AI report: ${codes.length} fault code(s) to look at.`
      : 'Mock AI report: nothing to flag.',
    findings: codes.map((code) => ({
      title: `${code} needs a look (mock)`,
      severity: 'warn',
      detail: `Canned mock finding for ${code}. Follow the known check for this car if one is listed.`,
      codes: [code],
      likelyCauses: ['Mock cause one', 'Mock cause two'],
      ...(steps ? { steps } : {}),
    })),
    actions: [
      ...(codes.length
        ? [{ type: 'clear_dtcs', label: 'Clear fault codes', detail: 'Mock suggestion.' }]
        : []),
      RECHECK,
    ],
  };
}

function cannedReport(messages: AiChatMessage[]): string {
  return JSON.stringify(mockReportBody(codesIn(messages)));
}

function cannedAnswer(messages: AiChatMessage[]): string {
  const reportAt = messages.findIndex((m) => m.role === 'assistant');
  const asked = messages.slice(reportAt + 1).filter((m) => m.role === 'user');
  const question = asked[asked.length - 1]?.content ?? '';
  const code = codesIn(messages.slice(0, Math.max(reportAt, 0)))[0];
  return (
    `Mock answer ${asked.length}: you asked "${question}". ` +
    (code ? `Start with ${code} and its known check. ` : 'Nothing is flagged on this car. ') +
    'This is canned text from mock://ai.'
  );
}

// ---- scripted agent conversations (plan 34a) ----

const DRIVER_REPORTS = 'The driver reports: ';
const BATTERY_RE = /battery|baterie/i;

/** The driver's symptom from the request line of the first user message, or '' (Check everything,
 *  focus runs). The line carries the symptom JSON-quoted. */
function symptomOf(messages: AiChatMessage[]): string {
  const first = messages.find((m) => m.role === 'user')?.content ?? '';
  const line = first.split('\n').find((l) => l.startsWith(DRIVER_REPORTS));
  if (!line) return '';
  const quoted = line.slice(DRIVER_REPORTS.length).trim();
  try {
    const parsed: unknown = JSON.parse(quoted);
    return typeof parsed === 'string' ? parsed : quoted;
  } catch {
    return quoted;
  }
}

function toolAction(tool: string, args: Record<string, unknown>, why: string): string {
  return JSON.stringify({ tool, args, why });
}

function finalAction(final: Record<string, unknown>): string {
  return JSON.stringify({ final });
}

/** `open_skill battery` → `run_skill battery` → a final citing triage and the run. */
function batteryScript(position: number): string {
  if (position === 0)
    return toolAction('open_skill', { name: 'battery' }, 'The complaint is about the battery.');
  if (position === 1)
    return toolAction('run_skill', { name: 'battery' }, 'Run the battery check it describes.');
  return finalAction({
    overall: 'ok',
    summary: 'Mock AI report: battery and charging checked.',
    findings: [
      {
        title: 'Battery and charging checked (mock)',
        severity: 'info',
        detail: 'Canned mock finding over the battery check.',
        codes: [],
        likelyCauses: [],
        steps: [1, 3],
      },
    ],
    actions: [RECHECK],
  });
}

/** One idle `read_live` → a final with one `warn` finding per code in the first user message. */
function defaultScript(messages: AiChatMessage[], position: number): string {
  if (position === 0)
    return toolAction(
      'read_live',
      { pids: ['010C', '0105', '0142'], seconds: 0 },
      'Check the idle readings.',
    );
  const first = messages.find((m) => m.role === 'user');
  const codes = first ? codesIn([first]) : [];
  const body = mockReportBody(codes, [1]);
  return finalAction({
    ...body,
    findings: [
      ...body.findings,
      {
        title: 'Idle readings look normal (mock)',
        severity: 'ok',
        detail: 'Canned mock finding over the idle read.',
        codes: [],
        likelyCauses: [],
        steps: [2],
      },
    ],
  });
}

/** One agent turn: the script is picked from the symptom, the position is the number of assistant
 *  messages so far. */
function agentReply(messages: AiChatMessage[]): string {
  const symptom = symptomOf(messages);
  const position = messages.filter((m) => m.role === 'assistant').length;
  if (symptom.includes('mock:invalid')) return 'not json';
  if (symptom.includes('mock:loop'))
    return toolAction('read_live', { pids: ['010C'] }, 'Read the rpm again.');
  if (BATTERY_RE.test(symptom)) return batteryScript(position);
  return defaultScript(messages, position);
}

export function createMockAiClient(): MockAiClient {
  return {
    listModels: async () => [MOCK_AI_MODEL],
    chat: async (messages, opts = {}) => {
      if (opts.json === false) return cannedAnswer(messages);
      if (opts.schema?.name === AGENT_ACTION_SCHEMA_NAME) return agentReply(messages);
      return cannedReport(messages);
    },
  };
}
