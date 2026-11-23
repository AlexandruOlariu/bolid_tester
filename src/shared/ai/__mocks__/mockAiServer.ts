/** Canned AI "server" for development (plan 19). Selected by the dispatcher when the AI address is
 *  `mock://ai` in a development build (`__DEV__`), so the AI report, the guide links under its
 *  findings and the follow-up conversation can be exercised in the simulator with no AI server or
 *  key. Deterministic: the report has one finding per fault code found in the snapshot digest, and a
 *  follow-up answer quotes the question and counts the turns. With the agent action schema (plan
 *  34a) it plays a scripted agent conversation chosen from the request line (battery, boost, the
 *  default read, `mock:invalid`, `mock:loop`), so the agent loop can be exercised end to end.
 *  Never used in a release build.
 *  See docs/features/ai-diagnose.md#mock-ai-server. */

import {
  AGENT_ACTION_SCHEMA_NAME,
  type AiChatMessage,
  type BoostFindingId,
  type DiagSeverity,
} from '@/shared/obd-core';
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
const BOOST_RE = /pulls weak|boost|turbo/i;

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

/** The boost verdicts and the sentence of the boost analysis (`assessBoost` notes) that says each
 *  one in the procedure's digest. The digest carries sentences, not finding keys, so the mock reads
 *  the verdicts back from them; the test builds its digests from `assessBoost` to catch drift. */
const BOOST_VERDICTS: { id: BoostFindingId; severity: DiagSeverity; says: string }[] = [
  { id: 'map_below_baro', severity: 'warn', says: 'below baro at idle' },
  { id: 'stuck_vnt', severity: 'warn', says: 'points to a stuck (closed) VNT' },
  { id: 'idle_high', severity: 'info', says: 'Idle boost above the expected range' },
  { id: 'hold_not_reached', severity: 'info', says: 'rev hold not reached' },
  { id: 'stuck_sensor', severity: 'warn', says: 'the MAP reading looks stuck' },
  { id: 'no_boost_hold', severity: 'warn', says: 'Boost at the rev hold below the expected range' },
  {
    id: 'overboost_hold',
    severity: 'warn',
    says: 'Boost at the rev hold above the expected range',
  },
];
/** A judged boost line ("… kPa over baro (expected …)"): with no verdict sentence, boost is `ok`. */
const BOOST_JUDGED = 'over baro (expected';

/** The digest of step `id` from its `Step <id> result:` message, or ''. */
function stepDigest(messages: AiChatMessage[], id: number): string {
  const head = `Step ${id} result:\n`;
  const m = messages.find((x) => x.role === 'user' && x.content.startsWith(head));
  return m ? m.content.slice(head.length) : '';
}

/** The boost verdicts said in a boost procedure digest, in table order; `ok` when the digest judged
 *  boost and found nothing; none when it judged nothing (no data, no range). */
function boostVerdicts(digest: string): { id: BoostFindingId; severity: DiagSeverity }[] {
  const found = BOOST_VERDICTS.filter((v) => digest.includes(v.says));
  if (found.length) return found;
  return digest.includes(BOOST_JUDGED) ? [{ id: 'ok', severity: 'ok' }] : [];
}

/** `open_skill boost` → `run_skill boost` → a final citing triage and the run, one finding per
 *  boost verdict in the step-3 digest. */
function boostScript(messages: AiChatMessage[], position: number): string {
  if (position === 0)
    return toolAction('open_skill', { name: 'boost' }, 'The complaint points at boost.');
  if (position === 1)
    return toolAction('run_skill', { name: 'boost' }, 'Run the boost check it describes.');
  const verdicts = boostVerdicts(stepDigest(messages, 3));
  return finalAction({
    overall: verdicts.some((v) => v.severity === 'warn') ? 'attention' : 'ok',
    summary: `Mock AI report: boost checked (${verdicts.map((v) => v.id).join(', ') || 'not judged'}).`,
    findings: verdicts.map((v) => ({
      title: `Boost check: ${v.id} (mock)`,
      severity: v.severity,
      detail: `Canned mock finding for the boost verdict ${v.id}.`,
      codes: [],
      likelyCauses: [],
      steps: [1, 3],
    })),
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
  if (BOOST_RE.test(symptom)) return boostScript(messages, position);
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
