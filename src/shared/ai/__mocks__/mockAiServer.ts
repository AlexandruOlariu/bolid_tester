/** Canned AI "server" for development (plan 19). Selected by the dispatcher when the AI address is
 *  `mock://ai` in a development build (`__DEV__`), so the AI report, the guide links under its
 *  findings and the follow-up conversation can be exercised in the simulator with no AI server or
 *  key. Deterministic: the report has one finding per fault code found in the snapshot digest, and a
 *  follow-up answer quotes the question and counts the turns. Never used in a release build.
 *  See docs/features/ai-diagnose.md#mock-ai-server. */

import type { AiChatMessage } from '@/shared/obd-core';
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

function cannedReport(messages: AiChatMessage[]): string {
  const codes = codesIn(messages);
  const findings = codes.map((code) => ({
    title: `${code} needs a look (mock)`,
    severity: 'warn',
    detail: `Canned mock finding for ${code}. Follow the known check for this car if one is listed.`,
    codes: [code],
    likelyCauses: ['Mock cause one', 'Mock cause two'],
  }));
  const actions = [
    ...(codes.length
      ? [{ type: 'clear_dtcs', label: 'Clear fault codes', detail: 'Mock suggestion.' }]
      : []),
    { type: 'recheck', label: 'Re-run diagnosis', detail: 'Read the car again.' },
  ];
  return JSON.stringify({
    overall: codes.length ? 'attention' : 'ok',
    summary: codes.length
      ? `Mock AI report: ${codes.length} fault code(s) to look at.`
      : 'Mock AI report: nothing to flag.',
    findings,
    actions,
  });
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

export function createMockAiClient(): MockAiClient {
  return {
    listModels: async () => [MOCK_AI_MODEL],
    chat: async (messages, opts = {}) =>
      opts.json === false ? cannedAnswer(messages) : cannedReport(messages),
  };
}
