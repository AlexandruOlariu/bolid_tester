/** Service layer for AI diagnosis around the agent (plan 34a): the vehicle context and the per-car
 *  known checks an agent run starts from, follow-up questions over a run's trail, and clearing codes
 *  on request. The run itself lives in `agentService.ts`. Talks to the OBD2 core + the AI client
 *  dispatcher (`getAiClient`); holds no React state. See docs/features/ai-diagnose.md. */

import {
  type AgentStep,
  type AiChatMessage,
  type AiReport,
  type KnownCheck,
  type VehicleContext,
  aiConfigProblem,
  buildAgentFollowUpMessages,
  vagCodeForDtc,
} from '@/shared/obd-core';
import { getAiClient } from '@/shared/ai';
import { vehicleLabel, type VehicleProfile } from '@/shared/vehicles';
import { GENERIC_GUIDE, matchFaultGuide } from '@/shared/vehicles/faultGuides';
import { useSessionStore } from '@/shared/state/sessionStore';
import { useSettingsStore } from '@/shared/state/settingsStore';

/** Map the selected vehicle profile into the AI's default vehicle context. Always returns something
 *  (even for the generic profile) so the model knows what kind of car it is looking at. */
export function toVehicleContext(p: VehicleProfile): VehicleContext {
  return {
    label: vehicleLabel(p),
    year: p.year || undefined,
    engine: p.engine && p.engine !== '—' ? p.engine : undefined,
    fuel: p.fuel && p.fuel !== 'other' ? p.fuel : undefined,
    expectedProtocol:
      p.expectedProtocol && p.expectedProtocol !== 'AUTO' ? p.expectedProtocol : undefined,
    notes: p.notes || undefined,
    make: p.make,
  };
}

/** The curated guides (not the generic fallback) that match the read codes on this car, one entry
 *  per distinct guide, listed to the model as "Known checks for this car". */
export function knownChecksFor(profileId: string, codes: string[]): KnownCheck[] {
  const out: KnownCheck[] = [];
  const seen = new Set<object>();
  for (const code of codes) {
    const guide = matchFaultGuide(profileId, code, vagCodeForDtc(code) || undefined);
    if (guide === GENERIC_GUIDE || seen.has(guide)) continue;
    seen.add(guide);
    out.push({ code, note: guide.note });
  }
  return out;
}

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
