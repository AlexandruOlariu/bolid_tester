/** Service layer for the AI diagnostic agent (plan 34a): builds a run's context from the connected
 *  session (behind the read-only facade), the active vehicle profile and the AI settings, runs
 *  triage then the agent loop, and turns how the run ended into the notice the screen shows. Also
 *  the triage-only re-read after Clear codes. Holds no React state; the screen's driver prompt is
 *  reached through the driver gate. See docs/features/ai-diagnose.md. */

import {
  type AgentChat,
  type AgentContribution,
  type AgentOutcome,
  type AgentProgress,
  type AgentRunRequest,
  type AgentStep,
  type AiReport,
  type DriverReply,
  type FindingTranslator,
  type ToolContext,
  type TriageResult,
  CORE_AGENT_CONTRIBUTION,
  agentRuleReport,
  aiConfigProblem,
  buildAgentRegistry,
  createReadOnlySession,
  runAgent,
  runTriage,
} from '@/shared/obd-core';
import { getAiClient } from '@/shared/ai';
import { currentLanguage, translate } from '@/shared/i18n';
import { curatedProfileId } from '@/shared/vehicles';
import { useSessionStore } from '@/shared/state/sessionStore';
import { useSettingsStore } from '@/shared/state/settingsStore';
import { logError } from '@/shared/state/errorLogStore';
import { getActiveProfile } from '@/features/vehicle-select/api/activeProfile';
import { knownChecksFor, toVehicleContext } from './diagnoseService';
import type { DriverGate } from './driverGate';

export interface AgentRunHooks {
  onProgress(p: AgentProgress): void;
  /** Triage finished (step 1 of every run). */
  onTriage(t: TriageResult): void;
  gate: DriverGate;
}

export type AgentRunOutcome = AgentOutcome & { notice: string | null };

export interface AgentRunHandle {
  done: Promise<AgentRunOutcome>;
  stop(): void;
}

/** On-device findings as report text: `<key>.title` / `<key>.detail` in the app's language. */
const translateFinding: FindingTranslator = (f) => ({
  title: translate(`${f.key}.title`, f.values),
  detail: translate(`${f.key}.detail`, f.values),
});

/** No driver prompts during triage: the stationary gate belongs to the agent loop. */
const noDriverAtTriage = async (): Promise<DriverReply> => ({ kind: 'cant' });

/** The run context (minus the driver) over the connected session, or the connect-first error. */
function buildContext(
  contributions: AgentContribution[],
  signal: AbortSignal,
): {
  ctx: Omit<ToolContext, 'askDriver'>;
  registry: ReturnType<typeof buildAgentRegistry>;
  knownChecks: (codes: string[]) => ReturnType<typeof knownChecksFor>;
} {
  const { session, info, status } = useSessionStore.getState();
  if (!session || status !== 'connected') throw new Error(translate('aiDiagnose:msg.connectFirst'));
  const profile = getActiveProfile();
  const guideProfileId = curatedProfileId(profile);
  return {
    ctx: {
      session: createReadOnlySession(session),
      profile,
      guideProfileId,
      vehicle: toVehicleContext(profile),
      vin: info?.vin ?? null,
      now: () => Date.now(),
      sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
      signal,
    },
    registry: buildAgentRegistry([CORE_AGENT_CONTRIBUTION, ...contributions]),
    knownChecks: (codes) => knownChecksFor(guideProfileId, codes),
  };
}

/** Start one agent run: triage, then the loop. Throws the connect-first error when no car is
 *  connected. `done` resolves with the outcome and its notice (null for the model's final report);
 *  it rejects only when triage itself fails (nothing gathered). `stop()` aborts the run and settles
 *  an open driver prompt as "Can't"; the run then ends `stopped` with the rule report. */
export function startAgentRun(
  req: AgentRunRequest,
  contributions: AgentContribution[],
  hooks: AgentRunHooks,
): AgentRunHandle {
  const controller = new AbortController();
  const { ctx, registry, knownChecks } = buildContext(contributions, controller.signal);
  const ai = useSettingsStore.getState().ai;
  const problem = aiConfigProblem(ai);
  const chat: AgentChat | null =
    problem !== null
      ? null
      : (messages, schema, signal) => getAiClient(ai).chat(messages, { schema, signal });

  const run = async (): Promise<AgentRunOutcome> => {
    try {
      const triage = await runTriage(
        { ...ctx, askDriver: noDriverAtTriage },
        registry,
        knownChecks,
      );
      hooks.onTriage(triage);
      const outcome = await runAgent(req, {
        registry,
        ctx,
        triage,
        chat,
        askDriver: (id) => hooks.gate.ask(id),
        onProgress: hooks.onProgress,
        signal: controller.signal,
        language: currentLanguage(),
        translate: translateFinding,
      });
      if (outcome.end === 'ai_error' || outcome.end === 'disconnected')
        logError({
          source: 'ai-diagnose',
          error:
            outcome.end === 'ai_error'
              ? (outcome.error ?? 'AI request failed')
              : 'The adapter disconnected during the agent run.',
          severity: 'warning',
          context: {
            phase: 'agent',
            end: outcome.end,
            steps: outcome.stepsUsed,
            provider: ai.provider,
            model: ai.model,
          },
        });
      // A typed symptom without AI was swept like Check everything: say why.
      const endKey =
        outcome.end === 'no_ai' && req.mode === 'symptom' ? 'no_ai_symptom' : outcome.end;
      const notice =
        outcome.end === 'final'
          ? null
          : translate(`aiDiagnose:agent.end.${endKey}`, {
              error: outcome.error ?? '',
              problem: problem ?? '',
            });
      return { ...outcome, notice };
    } finally {
      // A prompt still open (the loop's own timeout, a moving car) must not outlive the run.
      hooks.gate.cancel();
    }
  };

  return {
    done: run(),
    stop: () => {
      controller.abort();
      hooks.gate.cancel();
    },
  };
}

/** Triage only, for the re-read after Clear codes: one read pass and the on-device rule report
 *  over it. Throws the connect-first error when no car is connected. */
export async function runTriageOnly(
  contributions: AgentContribution[],
): Promise<{ triage: TriageResult; report: AiReport }> {
  const { ctx, registry, knownChecks } = buildContext(contributions, new AbortController().signal);
  const triage = await runTriage({ ...ctx, askDriver: noDriverAtTriage }, registry, knownChecks);
  const trail: AgentStep[] = [triage.step];
  return {
    triage,
    report: agentRuleReport(triage.snapshot, trail, { translate: translateFinding }),
  };
}
