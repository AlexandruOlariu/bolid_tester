/** Offline eval set for the AI diagnostic agent (plan 34c): each case runs a whole agent
 *  investigation (triage, then the loop) on the simulator with a scripted fault, against a real
 *  configured model, and checks whether the model's report puts the expected cause first. It is a
 *  measurement, not a gate: it prints one line per case and the pass count, and asserts only that
 *  every case finished. Skipped unless `BOLID_EVAL_URL` is set, so it never runs in CI.
 *
 *  Env: `BOLID_EVAL_URL` (server), `BOLID_EVAL_MODEL`, optional `BOLID_EVAL_KEY`, optional
 *  `BOLID_EVAL_PROVIDER` (`local` | `openai` | `anthropic` | `custom`, default `custom`).
 *  Run: `npm run eval:agent`. See docs/testing.md#agent-eval-set. */

import {
  AI_PROVIDER_IDS,
  CORE_AGENT_CONTRIBUTION,
  DIAG_SEVERITIES,
  DiagnosticSession,
  MockTransport,
  PLAYBOOK_CONTRIBUTION,
  buildAgentRegistry,
  buildScenario,
  createReadOnlySession,
  runAgent,
  runTriage,
  vagCodeForDtc,
  type AgentChat,
  type AgentOutcome,
  type AgentRunRequest,
  type AiFinding,
  type AiProviderId,
  type DriverInstructionId,
  type DriverReply,
  type FindingTranslator,
  type KnownCheck,
  type SimFaultId,
  type ToolContext,
  type VehicleContext,
} from '@/shared/obd-core';
import { getVehicleProfile, vehicleLabel, type VehicleProfile } from '@/shared/vehicles';
import { GENERIC_GUIDE, matchFaultGuide } from '@/shared/vehicles/faultGuides';
import en from '@/shared/i18n/locales/en/aiDiagnose.json';
import { getAiClient } from '../index';
import cases from './cases.json';

interface EvalCase {
  id: string;
  profile: string;
  simFault?: SimFaultId;
  symptom: string | null;
  /** Case-insensitive regex the most severe finding must match. */
  expect: string;
}

interface CaseResult {
  id: string;
  pass: boolean;
  outcome: AgentOutcome;
  wallMs: number;
}

const URL = process.env.BOLID_EVAL_URL;
/** How long the simulator holds 2500 rpm once the eval's driver confirms the rev hold (the same
 *  value the app uses, `SIM_REV_HOLD_MS` in src/app/ai-diagnose.tsx). */
const REV_HOLD_MS = 15_000;
/** Per case: the loop's 4-minute model + adapter budget, plus driver steps and the rev hold. */
const CASE_TIMEOUT_MS = 600_000;

const EVAL_CASES = cases as EvalCase[];

function provider(): AiProviderId {
  const p = process.env.BOLID_EVAL_PROVIDER ?? 'custom';
  if (!(AI_PROVIDER_IDS as readonly string[]).includes(p))
    throw new Error(`BOLID_EVAL_PROVIDER must be one of ${AI_PROVIDER_IDS.join(', ')}`);
  return p as AiProviderId;
}

/** `aiDiagnose:agent.finding.<module>.<id>.title` → the English text, `{{x}}` filled in. */
function englishText(key: string, values?: Record<string, string | number>): string {
  const path = key.replace(/^aiDiagnose:/, '').split('.');
  let node: unknown = en;
  for (const part of path) node = (node as Record<string, unknown> | undefined)?.[part];
  if (typeof node !== 'string') return key;
  return node.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name] ?? ''));
}

const translateFinding: FindingTranslator = (f) => ({
  title: englishText(`${f.key}.title`, f.values),
  detail: englishText(`${f.key}.detail`, f.values),
});

/** The curated guides matching the read codes, as the app's agent service lists them. */
function knownChecksFor(profileId: string, codes: string[]): KnownCheck[] {
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

function vehicleContext(p: VehicleProfile): VehicleContext {
  return {
    label: vehicleLabel(p),
    year: p.year || undefined,
    engine: p.engine && p.engine !== '—' ? p.engine : undefined,
    fuel: p.fuel && p.fuel !== 'other' ? p.fuel : undefined,
    make: p.make,
  };
}

/** The most severe finding, the first one on ties. */
function topFinding(findings: AiFinding[]): AiFinding | undefined {
  const rank = (f: AiFinding) => DIAG_SEVERITIES.indexOf(f.severity);
  return findings.reduce<AiFinding | undefined>(
    (best, f) => (best === undefined || rank(f) > rank(best) ? f : best),
    undefined,
  );
}

/** Pass = the model's own report (not the rule fallback) leads with a finding that matches
 *  `expect` and cites at least one step. */
function passes(c: EvalCase, outcome: AgentOutcome): boolean {
  if (outcome.report.source !== 'ai') return false;
  const top = topFinding(outcome.report.findings);
  if (!top || !(top.steps?.length ?? 0)) return false;
  const text = [top.title, top.detail, ...(top.codes ?? []), ...(top.likelyCauses ?? [])].join(
    '\n',
  );
  return new RegExp(c.expect, 'i').test(text);
}

async function runCase(c: EvalCase): Promise<CaseResult> {
  const profile = getVehicleProfile(c.profile);
  const transport = new MockTransport(
    buildScenario(c.profile, c.simFault ? { simFault: c.simFault } : {}),
  );
  const session = new DiagnosticSession(transport);
  const started = Date.now();
  const info = await session.connect();
  try {
    const signal = new AbortController().signal;
    const ctx: Omit<ToolContext, 'askDriver'> = {
      session: createReadOnlySession(session),
      profile,
      guideProfileId: profile.id,
      vehicle: vehicleContext(profile),
      vin: info.vin ?? null,
      now: () => Date.now(),
      sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
      signal,
    };
    const registry = buildAgentRegistry([CORE_AGENT_CONTRIBUTION, PLAYBOOK_CONTRIBUTION]);
    const client = getAiClient({
      baseUrl: URL ?? '',
      model: process.env.BOLID_EVAL_MODEL ?? '',
      apiKey: process.env.BOLID_EVAL_KEY || undefined,
      provider: provider(),
    });
    const chat: AgentChat = (messages, schema, s) => client.chat(messages, { schema, signal: s });
    // The eval's driver does every step; confirming the rev hold makes the simulator hold it.
    const askDriver = async (id: DriverInstructionId): Promise<DriverReply> => {
      if (id === 'hold_2500_rpm') transport.holdRevs(REV_HOLD_MS);
      return { kind: 'done' };
    };

    const triage = await runTriage(
      { ...ctx, askDriver: async () => ({ kind: 'cant' }) },
      registry,
      (codes) => knownChecksFor(profile.id, codes),
    );
    const req: AgentRunRequest =
      c.symptom === null ? { mode: 'everything' } : { mode: 'symptom', symptom: c.symptom };
    const outcome = await runAgent(req, {
      registry,
      ctx,
      triage,
      chat,
      askDriver,
      onProgress: () => undefined,
      signal,
      language: 'en',
      translate: translateFinding,
    });
    return { id: c.id, pass: passes(c, outcome), outcome, wallMs: Date.now() - started };
  } finally {
    await session.disconnect();
  }
}

function line(r: CaseResult): string {
  const top = topFinding(r.outcome.report.findings);
  return [
    r.id,
    r.pass ? 'PASS' : 'FAIL',
    r.outcome.end,
    String(r.outcome.stepsUsed),
    (r.wallMs / 1000).toFixed(1),
    top ? top.title : '-',
  ].join('  ');
}

(URL ? describe : describe.skip)('agent eval set', () => {
  const results: CaseResult[] = [];

  afterAll(() => {
    const passed = results.filter((r) => r.pass).length;
    process.stdout.write(`${passed}/${EVAL_CASES.length}\n`);
  });

  for (const c of EVAL_CASES) {
    it(
      c.id,
      async () => {
        const r = await runCase(c);
        results.push(r);
        process.stdout.write(`${line(r)}\n`);
        expect(r.outcome.report.findings).toBeDefined();
      },
      CASE_TIMEOUT_MS,
    );
  }
});
