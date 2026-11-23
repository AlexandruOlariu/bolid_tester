/** The AI diagnostic agent loop (plan 34a): after triage, the model answers one JSON action per
 *  turn; the app validates it, runs the one tool (or skill, or driver prompt) it names and sends the
 *  digest back, until the model sends a cited final report or the budget ends. Budget: 12 steps
 *  (triage included), 4 min of model + adapter time, 2 min of adapter time, 3 invalid replies in a
 *  row. Time waiting for the driver counts toward none of them. Every ending other than a valid
 *  final falls back to the on-device rule report over what was gathered. Without AI (plan 34c) the
 *  run sweeps every available skill with a procedure in `NO_AI_SKILL_ORDER` (driver steps
 *  included, same Stop / adapter / disconnect rules, no step cap), then ends with the rule report.
 *  Pure: the model, the driver prompt and the clock are injected. See docs/features/ai-diagnose.md. */

import type { AiReport, DiagnosticSnapshot, VehicleContext } from '../analysis/aiDiagnosis';
import { Elm327ClosedError } from '../elm327/Elm327Client';
import { buildActionSchema, parseAgentAction, validateArgs } from './actionSchema';
import { MAX_DIGEST_CHARS, clampDigest } from './digest';
import { DRIVER_INSTRUCTIONS } from './driver';
import { buildAgentMessages, buildAgentSystemPrompt } from './prompt';
import { BUILTIN_TOOLS, availableSkills, availableTools, type AgentRegistry } from './registry';
import { agentRuleReport, parseAgentFinal } from './report';
import { renderSkillForModel } from './skillFile';
import type { TriageResult } from './triage';
import type {
  AgentChat,
  AgentEnd,
  AgentRunRequest,
  AgentStep,
  AvailabilityContext,
  DriverInstructionId,
  DriverReply,
  FindingTranslator,
  ProcedureContext,
  SkillFinding,
  ToolArgSchema,
  ToolContext,
  ToolResult,
} from './types';

/** Without AI: the skills a run sweeps after triage, in this order, when available for the car and
 *  backed by a procedure. */
export const NO_AI_SKILL_ORDER = [
  'used_car_check',
  'fuel_trims',
  'boost',
  'misfire',
  'cooling',
  'dpf',
  'battery_charging',
  'maintenance',
] as const;

export const AGENT_BUDGET = {
  maxSteps: 12,
  wallMs: 240_000,
  adapterMs: 120_000,
  driverTimeoutMs: 180_000,
  driverSpeedPollMs: 1000,
  maxInvalidInRow: 3,
} as const;

/** What the screen shows while a run goes on. */
export interface AgentProgress {
  trail: AgentStep[];
  stepsUsed: number;
  phase: 'thinking' | 'tool' | 'driver';
  driver: DriverInstructionId | null;
}

export interface AgentDeps {
  registry: AgentRegistry;
  ctx: Omit<ToolContext, 'askDriver'>;
  triage: TriageResult;
  /** null when AI is off or not configured: the run sweeps `NO_AI_SKILL_ORDER`, then ends with the
   *  rule report. */
  chat: AgentChat | null;
  /** Shows the driver prompt; the loop's gate decides whether it may open. */
  askDriver: (id: DriverInstructionId) => Promise<DriverReply>;
  onProgress: (p: AgentProgress) => void;
  signal: AbortSignal;
  language: 'en' | 'ro';
  translate: FindingTranslator;
}

export interface AgentOutcome {
  report: AiReport;
  trail: AgentStep[];
  snapshot: DiagnosticSnapshot;
  end: AgentEnd;
  /** Steps of the 12-step budget used (triage included); 0 when no model ran. */
  stepsUsed: number;
  error?: string;
}

const SPEED_PID = '010D';
/** Longest error text kept in an invalid step's one-line summary. */
const MAX_SUMMARY_ERROR_CHARS = 120;
const DRIVER_TIMEOUT_MINUTES = AGENT_BUDGET.driverTimeoutMs / 60_000;
const UNCITED_FINAL =
  'The final report needs a summary or findings, each citing the ids of successful steps.';

/** What one executed action produced, before it becomes a step. */
interface ActionResult {
  digest: string;
  summary: string;
  status: AgentStep['status'];
  findings?: SkillFinding[];
  unconfirmed?: boolean;
}

/** A validated tool action from the model. */
interface ToolAction {
  tool: string;
  args: Record<string, unknown>;
  why: string;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function vehicleLine(v: VehicleContext): string {
  const specs = [v.engine, v.fuel].filter((s): s is string => Boolean(s));
  return `Vehicle: ${v.label}${specs.length ? ` (${specs.join(', ')})` : ''}`;
}

/** A tool's arguments as translation values: strings and numbers as they are, arrays joined. */
function labelValues(args: Record<string, unknown>): Record<string, string | number> | undefined {
  const values: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(args)) {
    if (typeof v === 'string' || typeof v === 'number') values[k] = v;
    else if (Array.isArray(v)) values[k] = v.join(', ');
  }
  return Object.keys(values).length ? values : undefined;
}

function fromToolResult(r: ToolResult): ActionResult {
  return {
    digest: clampDigest(r.digest),
    summary: r.summary,
    status: r.status ?? 'ok',
    ...(r.findings?.length ? { findings: r.findings } : {}),
    ...(r.unconfirmed ? { unconfirmed: true } : {}),
  };
}

/** The driver step's result as the model and the trail read it. */
function driverResult(id: DriverInstructionId, reply: DriverReply, stopped: boolean): ActionResult {
  const text = DRIVER_INSTRUCTIONS[id].en;
  const cant = (digest: string): ActionResult => ({
    digest,
    summary: `Driver: ${id} — can't`,
    status: 'cant',
  });
  switch (reply.kind) {
    case 'done':
      return { digest: `Driver did: ${text}`, summary: `Driver: ${id} — done`, status: 'ok' };
    case 'choice':
      return {
        digest: `Driver was asked: ${text} Driver answered: ${reply.value}.`,
        summary: `Driver: ${id} — ${reply.value}`,
        status: 'ok',
      };
    case 'cant':
      return cant(
        stopped
          ? `Stopped before the driver answered: ${text}`
          : `Driver could not do it: ${text} Counted as "Can't".`,
      );
    case 'timeout':
      return cant(
        `No answer within ${DRIVER_TIMEOUT_MINUTES} minutes to: ${text} Counted as "Can't".`,
      );
    case 'moving':
      return cant(
        `The car started moving while waiting for: ${text} Step aborted, counted as "Can't".`,
      );
    case 'refused':
      return {
        digest:
          reply.reason === 'moving'
            ? 'Refused: the car is moving. Ask the driver only while the car is stationary.'
            : 'Refused: speed unknown (no answer to 010D), so the car may be moving. Ask the driver only while the car reads 0 km/h.',
        summary: `Driver: ${id} — refused (${reply.reason === 'moving' ? 'moving' : 'speed unknown'})`,
        status: 'refused',
      };
  }
}

/** Run one agent investigation after triage. Never throws for a model, tool or link failure: every
 *  ending returns an outcome with a report (the model's cited final, or the rule report). */
export async function runAgent(req: AgentRunRequest, deps: AgentDeps): Promise<AgentOutcome> {
  const { ctx, registry, triage, signal } = deps;
  const trail: AgentStep[] = [triage.step];
  const outcome = (end: AgentEnd, stepsUsed: number, error?: string): AgentOutcome => ({
    report: agentRuleReport(triage.snapshot, trail, {
      focusCode: req.focusCode,
      translate: deps.translate,
    }),
    trail,
    snapshot: triage.snapshot,
    end,
    stepsUsed,
    ...(error !== undefined ? { error } : {}),
  });

  // What this car offers: once per run.
  const availability: AvailabilityContext = {
    profile: ctx.profile,
    protocol: ctx.session.currentProtocol,
    supportedPids: ctx.session.supportedPids,
    canMonitor: ctx.session.canMonitor,
  };
  const tools = availableTools(registry, availability);
  const skills = availableSkills(registry, availability);
  const toolByName = new Map(tools.map((t) => [t.name, t]));
  const skillByName = new Map(skills.map((s) => [s.name, s]));
  const skillArg: ToolArgSchema = {
    type: 'object',
    properties: { name: { type: 'string', enum: skills.map((s) => s.name) } },
    required: ['name'],
  };
  const actionTools = new Map<string, { args: ToolArgSchema }>([
    ...tools.map((t) => [t.name, t] as const),
    ['open_skill', { args: skillArg }],
    ['run_skill', { args: skillArg }],
    [
      'ask_driver',
      {
        args: {
          type: 'object',
          properties: { id: { type: 'string', enum: Object.keys(DRIVER_INSTRUCTIONS) } },
          required: ['id'],
        },
      },
    ],
  ]);

  const startedAt = ctx.now();
  let driverMs = 0;
  let adapterMs = 0;
  let invalidInRow = 0;
  /** The reply text that led to each step after triage, echoed back as the assistant's turn. */
  const actions: string[] = [];
  let phase: AgentProgress['phase'] = 'thinking';
  let driverOpen: DriverInstructionId | null = null;
  const emit = () =>
    deps.onProgress({ trail: [...trail], stepsUsed: trail.length, phase, driver: driverOpen });

  // ---- the driver gate: stationary only, 3 min timeout, aborted when the car moves ----

  /** `010D` in km/h, or null when the car gives no value. A closed link propagates. */
  const readSpeed = async (): Promise<number | null> => {
    try {
      return (await ctx.session.readValue(SPEED_PID))?.value ?? null;
    } catch (e) {
      if (e instanceof Elm327ClosedError) throw e;
      return null;
    }
  };

  const waitForDriver = async (id: DriverInstructionId): Promise<DriverReply> => {
    const answer: { reply?: DriverReply; failure?: { error: unknown } } = {};
    const answered = deps.askDriver(id).then(
      (reply) => {
        answer.reply = reply;
      },
      (error: unknown) => {
        answer.failure = { error };
      },
    );
    let onAbort: () => void = () => undefined;
    const stopped = new Promise<void>((resolve) => {
      onAbort = () => resolve();
      signal.addEventListener('abort', onAbort, { once: true });
    });
    const started = ctx.now();
    try {
      for (;;) {
        if (answer.failure) throw answer.failure.error;
        if (answer.reply) return answer.reply;
        if (signal.aborted) return { kind: 'cant' };
        if (ctx.now() - started >= AGENT_BUDGET.driverTimeoutMs) return { kind: 'timeout' };
        await Promise.race([answered, stopped, ctx.sleep(AGENT_BUDGET.driverSpeedPollMs)]);
        if (answer.reply || answer.failure || signal.aborted) continue;
        // No value (engine off, ECU asleep while restarting) counts as stationary.
        const speed = await readSpeed();
        if (speed !== null && speed > 0) return { kind: 'moving' };
      }
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  };

  /** The `askDriver` of `ask_driver` steps, tools and procedures alike. */
  const askDriver = async (id: DriverInstructionId): Promise<DriverReply> => {
    if (signal.aborted) return { kind: 'cant' };
    const speed = await readSpeed();
    if (speed === null) return { kind: 'refused', reason: 'speed_unknown' };
    if (speed !== 0) return { kind: 'refused', reason: 'moving' };
    const opened = ctx.now();
    const before = phase;
    driverOpen = id;
    phase = 'driver';
    emit();
    try {
      return await waitForDriver(id);
    } finally {
      driverMs += ctx.now() - opened;
      driverOpen = null;
      phase = before;
      emit();
    }
  };

  const toolCtx: ToolContext = { ...ctx, askDriver };
  const procCtx: ProcedureContext = {
    ...toolCtx,
    callTool: async (name, args = {}) => {
      const tool = toolByName.get(name);
      if (!tool) throw new Error(`Unknown tool "${name}"`);
      const checked = validateArgs(tool.args, args);
      if (!checked.ok) throw new Error(`${name}: ${checked.error}`);
      return tool.run(checked.value, toolCtx);
    },
    runProcedure: async (id) => {
      const procedure = registry.procedures.get(id);
      if (!procedure) throw new Error(`Unknown procedure "${id}"`);
      return procedure.run(procCtx);
    },
    hasTool: (name) => toolByName.has(name),
    hasSkill: (name) => skillByName.has(name),
  };

  // ---- steps ----

  const invalidStep = (error: string, action?: ToolAction): AgentStep => ({
    id: trail.length + 1,
    kind: 'invalid',
    ...(action ? { tool: action.tool, args: action.args } : {}),
    why: action?.why ?? '',
    digest: error,
    summary: `Invalid reply: ${error.slice(0, MAX_SUMMARY_ERROR_CHARS)}`,
    label: { key: 'aiDiagnose:agent.invalid' },
    status: 'error',
    durationMs: 0,
  });

  /** Run one action. Its time minus the driver's waiting counts as adapter time. A failure is a
   *  failed step; a closed link propagates and ends the run. */
  const execute = async (
    kind: AgentStep['kind'],
    action: ToolAction,
    label: AgentStep['label'],
    run: () => Promise<ActionResult>,
  ): Promise<AgentStep> => {
    const started = ctx.now();
    const driverBefore = driverMs;
    phase = 'tool';
    emit();
    let r: ActionResult;
    try {
      r = await run();
    } catch (e) {
      if (e instanceof Elm327ClosedError) throw e;
      r = {
        digest: `Read failed: ${errorMessage(e)}`,
        summary: `${action.tool}: read failed`,
        status: 'error',
      };
    }
    const durationMs = ctx.now() - started;
    adapterMs += Math.max(0, durationMs - (driverMs - driverBefore));
    return {
      id: trail.length + 1,
      kind,
      tool: action.tool,
      args: action.args,
      why: action.why,
      digest: r.digest,
      summary: r.summary,
      label,
      status: r.status,
      ...(r.unconfirmed ? { unconfirmed: true } : {}),
      ...(r.findings ? { findings: r.findings } : {}),
      durationMs,
    };
  };

  const skillLabel = (name: string): AgentStep['label'] => ({
    key: 'aiDiagnose:agent.tool.run_skill',
    values: { name },
  });

  const notEnoughTime = (costMs: number, action: ToolAction): AgentStep | null =>
    costMs > AGENT_BUDGET.adapterMs - adapterMs
      ? invalidStep(`Not enough adapter time left for ${action.tool}; finish now.`, action)
      : null;

  const perform = async (action: ToolAction): Promise<AgentStep> => {
    switch (action.tool) {
      case 'open_skill': {
        const skill = skillByName.get(String(action.args.name));
        if (!skill) return invalidStep(`Unknown skill ${JSON.stringify(action.args.name)}.`);
        return execute(
          'skill',
          action,
          { key: 'aiDiagnose:agent.tool.open_skill', values: { name: skill.name } },
          async () => ({
            digest: renderSkillForModel(skill, ctx.guideProfileId),
            summary: `Opened skill ${skill.name}`,
            status: 'ok',
          }),
        );
      }
      case 'run_skill': {
        const skill = skillByName.get(String(action.args.name));
        if (!skill) return invalidStep(`Unknown skill ${JSON.stringify(action.args.name)}.`);
        const procedure = skill.procedure ? registry.procedures.get(skill.procedure) : undefined;
        if (!procedure)
          return invalidStep(
            `Skill "${skill.name}" has no procedure to run; follow its steps with the tools.`,
            action,
          );
        return (
          notEnoughTime(skill.maxAdapterMs ?? procedure.costMs, action) ??
          execute('skill', action, skillLabel(skill.name), async () =>
            fromToolResult(await procedure.run(procCtx)),
          )
        );
      }
      case 'ask_driver': {
        const id = action.args.id as DriverInstructionId;
        return execute(
          'driver',
          action,
          { key: 'aiDiagnose:agent.tool.ask_driver', values: { id } },
          async () => driverResult(id, await askDriver(id), signal.aborted),
        );
      }
      default: {
        const tool = toolByName.get(action.tool);
        if (!tool) return invalidStep(`Unknown tool ${JSON.stringify(action.tool)}.`);
        const label = { key: tool.labelKey, values: labelValues(action.args) };
        return (
          notEnoughTime(tool.costMs, action) ??
          execute('tool', action, label.values ? label : { key: tool.labelKey }, async () =>
            fromToolResult(await tool.run(action.args, toolCtx)),
          )
        );
      }
    }
  };

  /** Without AI: each skill of `NO_AI_SKILL_ORDER` the car offers that has a procedure, one step
   *  each. Stop and the adapter cap end the sweep early; a skill whose declared cost no longer fits
   *  the adapter time left ends it as `adapter`. No model steps are used. */
  const sweep = async (): Promise<AgentOutcome> => {
    for (const name of NO_AI_SKILL_ORDER) {
      if (signal.aborted) return outcome('stopped', 0);
      if (adapterMs >= AGENT_BUDGET.adapterMs) return outcome('adapter', 0);
      const skill = skillByName.get(name);
      const procedure = skill?.procedure ? registry.procedures.get(skill.procedure) : undefined;
      if (!skill || !procedure) continue;
      if ((skill.maxAdapterMs ?? procedure.costMs) > AGENT_BUDGET.adapterMs - adapterMs)
        return outcome('adapter', 0);
      trail.push(
        await execute('skill', { tool: name, args: {}, why: '' }, skillLabel(name), async () =>
          fromToolResult(await procedure.run(procCtx)),
        ),
      );
      emit();
    }
    return outcome(signal.aborted ? 'stopped' : 'no_ai', 0);
  };

  const budgetEnd = (): AgentEnd | null => {
    if (signal.aborted) return 'stopped';
    if (trail.length >= AGENT_BUDGET.maxSteps) return 'steps';
    if (ctx.now() - startedAt - driverMs >= AGENT_BUDGET.wallMs) return 'time';
    if (adapterMs >= AGENT_BUDGET.adapterMs) return 'adapter';
    return null;
  };

  const chat = deps.chat;
  if (chat === null) {
    emit();
    try {
      return await sweep();
    } catch (e) {
      if (e instanceof Elm327ClosedError) return outcome('disconnected', 0);
      throw e;
    }
  }

  // ---- the loop (the schema and the system prompt: once per run) ----

  const schema = buildActionSchema([...tools.map((t) => t.name), ...BUILTIN_TOOLS]);
  const system = buildAgentSystemPrompt({
    language: deps.language,
    tools,
    skills,
    maxSteps: AGENT_BUDGET.maxSteps,
  });
  const vehicle = vehicleLine(ctx.vehicle);

  emit();
  try {
    for (;;) {
      const end = budgetEnd();
      if (end) return outcome(end, trail.length);

      let reply: string | null;
      try {
        reply = await chat(
          buildAgentMessages({
            system,
            vehicleLine: vehicle,
            triage: triage.step,
            request: req,
            steps: trail.slice(1),
            actions,
            stepNo: trail.length + 1,
            maxSteps: AGENT_BUDGET.maxSteps,
          }),
          schema,
          signal,
        );
      } catch (e) {
        if (signal.aborted) return outcome('stopped', trail.length);
        return outcome('ai_error', trail.length, errorMessage(e));
      }
      if (signal.aborted) return outcome('stopped', trail.length);

      const action = parseAgentAction(reply, actionTools);
      let step: AgentStep;
      if (action.kind === 'final') {
        const report = parseAgentFinal(action.final, trail);
        if (report)
          return {
            report,
            trail,
            snapshot: triage.snapshot,
            end: 'final',
            stepsUsed: trail.length,
          };
        step = invalidStep(UNCITED_FINAL);
      } else if (action.kind === 'invalid') {
        step = invalidStep(action.error);
      } else {
        step = await perform(action);
      }

      actions.push(clampDigest(reply?.trim() || '(empty reply)', MAX_DIGEST_CHARS));
      trail.push(step);
      invalidInRow = step.kind === 'invalid' ? invalidInRow + 1 : 0;
      phase = 'thinking';
      emit();
      if (invalidInRow >= AGENT_BUDGET.maxInvalidInRow) return outcome('invalid', trail.length);
    }
  } catch (e) {
    if (e instanceof Elm327ClosedError) return outcome('disconnected', trail.length);
    throw e;
  }
}
