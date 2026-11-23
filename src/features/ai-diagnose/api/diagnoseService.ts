/** Service layer for AI diagnosis around the agent (plan 34a): the vehicle context and the per-car
 *  known checks an agent run starts from, follow-up questions over a run's trail, and clearing codes
 *  on request. The run itself lives in `agentService.ts`. Talks to the OBD2 core + the AI client
 *  dispatcher (`getAiClient`); holds no React state. See docs/features/ai-diagnose.md. */

import {
  type AgentStep,
  type AiChatMessage,
  type AiReport,
  aiConfigProblem,
  buildAgentFollowUpMessages,
} from '@/shared/obd-core';
import { getAiClient } from '@/shared/ai';
import { useSessionStore } from '@/shared/state/sessionStore';
import { useSettingsStore } from '@/shared/state/settingsStore';

/** The vehicle context and known checks live in `@/shared/vehicles/agentContext` (store-free, shared
 *  with the offline eval set); re-exported here for the agent service. */
export { knownChecksFor, toVehicleContext } from '@/shared/vehicles/agentContext';

/** Answer one follow-up question about `report` (plan 19, over the agent trail since plan 34a): the
 *  trail's digests, the report and the last turns of the conversation go to the configured provider
 *  as plain text (`json: false`). Throws a friendly Error when the report came from the on-device
 *  rules or the AI is not set up, or when the model returns nothing. */
export async function followUp(
  trail: AgentStep[],
  report: AiReport,
  conversation: AiChatMessage[],
  question: string,
): Promise<string> {
  if (report.source === 'local')
    throw new Error(
      'Follow-ups need an AI provider. Set one up in Settings → AI assistant, then re-run the diagnosis.',
    );
  const ai = useSettingsStore.getState().ai;
  const problem = aiConfigProblem(ai);
  if (problem) throw new Error(problem);
  const answer = await getAiClient(ai).chat(
    buildAgentFollowUpMessages(trail, report, conversation, question),
    { json: false },
  );
  const text = (answer ?? '').trim();
  if (!text) throw new Error('The AI returned no answer. Try asking again.');
  return text;
}

export async function clearCodes(): Promise<boolean> {
  const { session } = useSessionStore.getState();
  if (!session) return false;
  return session.clearDtcs();
}
