import type { AiChatMessage, DiagnosticSnapshot } from '../analysis/aiDiagnosis';
import { Elm327ClosedError } from '../elm327/Elm327Client';
import { DiagnosticSession, type LiveValue } from '../session/DiagnosticSession';
import { MockTransport } from '../transport/MockTransport';
import { buildScenario } from '../transport/scenarios';
import { golfPlus2009 } from '../../vehicles/golf-plus-2009-20tdi';
import { CORE_AGENT_CONTRIBUTION } from './coreTools';
import {
  AGENT_BUDGET,
  NO_AI_SKILL_ORDER,
  runAgent,
  type AgentDeps,
  type AgentProgress,
} from './loop';
import { PLAYBOOK_CONTRIBUTION } from './playbooks';
import { createReadOnlySession, type ReadOnlySession } from './readOnlySession';
import { buildAgentRegistry, type AgentRegistry } from './registry';
import { SKILL_FORMAT, type SkillFile } from './skillFile';
import type { TriageResult } from './triage';
import type {
  AgentContribution,
  AgentRunRequest,
  AgentTool,
  DriverReply,
  ProcedureContext,
  SkillProcedure,
  ToolContext,
  ToolResult,
} from './types';

// ---- scripted model replies ----

const FINAL = '{"final":{"summary":"done","findings":[]}}';
const TOOL_T = '{"tool":"t","args":{},"why":"w"}';
/** A 50 s step: the model thinks for 30 s, then the `slow` tool reads for 20 s. */
const TOOL_50S: Scripted = { reply: '{"tool":"slow","args":{},"why":"w"}', thinkMs: 30_000 };
/** A tool that declares and uses 40 s of adapter time. */
const TOOL_COST_40S = '{"tool":"cost40","args":{},"why":"w"}';
const DRIVER_HOLD = '{"tool":"ask_driver","args":{"id":"hold_2500_rpm"},"why":"w"}';
const DRIVER_RESTART = '{"tool":"ask_driver","args":{"id":"restart_engine"},"why":"w"}';
const TOOL_THROWS_CLOSED = '{"tool":"drop","args":{}}';

type Scripted = string | null | Error | { reply: string; thinkMs: number };

// ---- fake tools, skills and procedures ----

let active = 0;
let maxConcurrentRuns = 0;

function fakeTool(name: string, costMs: number, run: AgentTool['run']): AgentTool {
  return {
    name,
    description: `Fake ${name}.`,
    labelKey: `aiDiagnose:agent.tool.${name}`,
    args: { type: 'object', properties: {} },
    costMs,
    available: () => true,
    run,
  };
}

const ok = (digest: string): ToolResult => ({ digest, summary: digest });

const TOOLS: AgentTool[] = [
  fakeTool('t', 1000, async () => {
    active++;
    maxConcurrentRuns = Math.max(maxConcurrentRuns, active);
    await Promise.resolve();
    active--;
    return ok('T ok');
  }),
  fakeTool('slow', 20_000, async (_args, ctx) => {
    await ctx.sleep(20_000);
    return ok('slow ok');
  }),
  fakeTool('cost40', 40_000, async (_args, ctx) => {
    await ctx.sleep(40_000);
    return ok('cost40 ok');
  }),
  fakeTool('cost50', 50_000, async (_args, ctx) => {
    await ctx.sleep(50_000);
    return ok('cost50 ok');
  }),
  fakeTool('drop', 1000, async () => {
    throw new Elm327ClosedError();
  }),
  fakeTool('fail', 1000, async () => {
    throw new Error('NO DATA');
  }),
];

function skill(name: string, over: Partial<SkillFile> = {}): SkillFile {
  return {
    format: SKILL_FORMAT,
    name,
    kind: 'capability',
    description: `The ${name} skill.`,
    tools: ['t'],
    instructions: ['Call t.'],
    interpret: ['T ok is fine.'],
    ...over,
  };
}

const PROCEDURES: SkillProcedure[] = [
  {
    id: 'proc_driver',
    costMs: 10_000,
    run: async (ctx: ProcedureContext) => {
      const reply = await ctx.askDriver('restart_engine');
      const t = await ctx.callTool('t');
      return ok(`driver ${reply.kind}; ${t.digest}`);
    },
  },
  {
    id: 'proc_triple',
    costMs: 120_000,
    run: async (ctx: ProcedureContext) => {
      for (let i = 0; i < 3; i++) await ctx.callTool('cost40');
      return ok('triple ok');
    },
  },
  { id: 'proc_big', costMs: 1000, run: async () => ok('big ok') },
];

const REGISTRY = buildAgentRegistry([
  {
    tools: TOOLS,
    skills: [
      skill('doc'),
      skill('capture', { procedure: 'proc_driver' }),
      skill('triple', { tools: ['cost40'], procedure: 'proc_triple' }),
      skill('big', { procedure: 'proc_big', maxAdapterMs: 100_000 }),
    ],
    procedures: PROCEDURES,
  },
]);

// ---- the fake car, clock, model and driver ----

const SNAPSHOT: DiagnosticSnapshot = {
  protocol: 'ISO_15765_4_CAN_11_500',
  vin: null,
  voltage: 12.6,
  supportedPidCount: 20,
  readiness: null,
  dtcs: { stored: [], pending: [], permanent: [] },
  freezeFrame: null,
  live: [],
};

const TRIAGE: TriageResult = {
  snapshot: SNAPSHOT,
  step: {
    id: 1,
    kind: 'triage',
    why: '',
    digest: 'Triage digest',
    summary: 'Triage: 0 codes, battery 12.6 V',
    label: { key: 'aiDiagnose:agent.step.triage', values: { count: 0, volts: '12.6' } },
    status: 'ok',
    durationMs: 0,
  },
};

type DriverMode = 'done' | 'cant' | 'never' | 'done-after-3-polls' | 'done-after-170s';

interface DepsOpts {
  signal?: AbortSignal;
  afterStep?: (n: number) => unknown;
  onProgress?: (p: AgentProgress) => void;
  /** `010D` on every read (default 0); `null` = no answer. */
  speed?: number | null;
  /** `010D` read by read, the gate's check first; the last value repeats. */
  speedAfter?: (number | null)[];
  driver?: DriverMode;
  registry?: AgentRegistry;
  /** A real (simulated) car instead of the speed-only fake. */
  session?: ReadOnlySession;
}

type TestDeps = AgentDeps & { sentMessages: AiChatMessage[][]; progress: AgentProgress[] };

function deps(script: Scripted[], opts: DepsOpts = {}): TestDeps {
  let clock = 0;
  let speedReads = 0;
  const mode = opts.driver ?? 'done-after-170s';
  let waiting: { resolve: (r: DriverReply) => void; askedAt: number; polls: number } | null = null;

  const speedAt = (i: number): number | null => {
    if (opts.speedAfter) return opts.speedAfter[Math.min(i, opts.speedAfter.length - 1)];
    return opts.speed === undefined ? 0 : opts.speed;
  };

  const fakeSession = {
    currentProtocol: 'ISO_15765_4_CAN_11_500',
    supportedPids: ['010C', '010D'],
    canMonitor: true,
    readValue: async (pid: string): Promise<LiveValue | null> => {
      if (pid !== '010D') return null;
      const v = speedAt(speedReads++);
      if (waiting) {
        waiting.polls++;
        if (
          (mode === 'done-after-3-polls' && waiting.polls >= 3) ||
          (mode === 'done-after-170s' && clock - waiting.askedAt >= 170_000)
        ) {
          waiting.resolve({ kind: 'done' });
          waiting = null;
        }
      }
      return v === null ? null : { pid, name: 'Vehicle speed', unit: 'km/h', value: v, ts: clock };
    },
  } as unknown as ReadOnlySession;

  const signal = opts.signal ?? new AbortController().signal;
  const ctx: Omit<ToolContext, 'askDriver'> = {
    session: opts.session ?? fakeSession,
    profile: golfPlus2009,
    guideProfileId: golfPlus2009.id,
    vehicle: { label: golfPlus2009.name, engine: '2.0 TDI', fuel: 'diesel' },
    vin: null,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    signal,
  };

  const sentMessages: AiChatMessage[][] = [];
  const progress: AgentProgress[] = [];
  let calls = 0;
  let lastLen = 0;
  return {
    registry: opts.registry ?? REGISTRY,
    ctx,
    triage: TRIAGE,
    chat: async (messages) => {
      sentMessages.push(messages);
      if (calls >= script.length) throw new Error('script exhausted');
      const next = script[calls++];
      if (next instanceof Error) throw next;
      if (next !== null && typeof next === 'object') {
        clock += next.thinkMs;
        return next.reply;
      }
      return next;
    },
    askDriver: (): Promise<DriverReply> => {
      if (mode === 'done') return Promise.resolve({ kind: 'done' });
      if (mode === 'cant') return Promise.resolve({ kind: 'cant' });
      if (mode === 'never') return new Promise<DriverReply>(() => undefined);
      return new Promise<DriverReply>((resolve) => {
        waiting = { resolve, askedAt: clock, polls: 0 };
      });
    },
    onProgress: (p) => {
      progress.push(p);
      opts.onProgress?.(p);
      if (p.trail.length > lastLen) {
        lastLen = p.trail.length;
        opts.afterStep?.(lastLen);
      }
    },
    signal,
    language: 'en',
    translate: (f) => ({ title: f.key, detail: f.key }),
    sentMessages,
    progress,
  };
}

const sym = (symptom: string): AgentRunRequest => ({ mode: 'symptom', symptom });

beforeEach(() => {
  active = 0;
  maxConcurrentRuns = 0;
});

// ---- the brief's behaviour ----

it('ends with the cited final', async () => {
  const o = await runAgent(
    sym('weak'),
    deps([
      '{"tool":"t","args":{},"why":"w"}',
      '{"final":{"summary":"s","findings":[{"title":"a","severity":"warn","detail":"d","steps":[2]}]}}',
    ]),
  );
  expect(o.end).toBe('final');
  expect(o.trail.map((s) => s.id)).toEqual([1, 2]);
  expect(o.report.findings[0].steps).toEqual([2]);
});
it('an unknown tool is answered with an error and counts as a step', async () => {
  const d = deps(['{"tool":"clear_dtcs"}', FINAL]);
  const o = await runAgent(sym('x'), d);
  expect(o.trail[1]).toMatchObject({ kind: 'invalid', status: 'error' });
  expect(d.sentMessages[1].at(-1)!.content).toContain('Unknown tool "clear_dtcs"');
});
it('three invalid replies in a row end with the rule report', async () =>
  expect(await runAgent(sym('x'), deps(['no', 'no', 'no']))).toMatchObject({
    end: 'invalid',
    report: { source: 'local' },
  }));
it('a valid action resets the invalid counter', async () =>
  expect((await runAgent(sym('x'), deps(['no', 'no', TOOL_T, 'no', 'no', FINAL]))).end).toBe(
    'final',
  ));
it('stops after 12 steps', async () => {
  const o = await runAgent(sym('x'), deps(Array(20).fill(TOOL_T)));
  expect(o.end).toBe('steps');
  expect(o.stepsUsed).toBe(12);
});
it('wall time ends the run; driver waiting does not count', async () => {
  // each TOOL_50S step takes 50 s (30 s model + 20 s adapter); ask_driver waits 170 s (answered done)
  expect(
    (await runAgent(sym('x'), deps([TOOL_50S, DRIVER_HOLD, TOOL_50S, TOOL_50S, FINAL]))).end,
  ).toBe('final');
  expect((await runAgent(sym('x'), deps(Array(6).fill(TOOL_50S)))).end).toBe('time');
});
it('the adapter cap ends the run', async () =>
  expect((await runAgent(sym('x'), deps(Array(5).fill(TOOL_COST_40S)))).end).toBe('adapter'));
it('Stop keeps the trail and ends stopped', async () => {
  const ac = new AbortController();
  const d = deps([TOOL_T, TOOL_T, FINAL], {
    signal: ac.signal,
    afterStep: (n) => n === 2 && ac.abort(),
  });
  const o = await runAgent(sym('x'), d);
  expect(o.end).toBe('stopped');
  expect(o.trail).toHaveLength(2);
});
it('a model error ends ai_error with the rule report', async () =>
  expect(await runAgent(sym('x'), deps([new Error('503')]))).toMatchObject({
    end: 'ai_error',
    error: '503',
    report: { source: 'local' },
  }));
it('no AI → rule report from triage', async () => {
  const core = buildAgentRegistry([CORE_AGENT_CONTRIBUTION]);
  const o = await runAgent(sym('x'), { ...deps([], { registry: core }), chat: null });
  expect(o).toMatchObject({ end: 'no_ai', stepsUsed: 0, report: { source: 'local' } });
  expect(o.trail).toHaveLength(1);
});
it('an adapter drop ends disconnected', async () =>
  expect((await runAgent(sym('x'), deps([TOOL_THROWS_CLOSED]))).end).toBe('disconnected'));
it('ask_driver is refused while moving and when speed is unknown', async () => {
  expect(
    (await runAgent(sym('x'), deps([DRIVER_HOLD, FINAL], { speed: 12 }))).trail[1],
  ).toMatchObject({ status: 'refused' });
  expect(
    (await runAgent(sym('x'), deps([DRIVER_HOLD, FINAL], { speed: null }))).trail[1].digest,
  ).toContain('speed unknown');
});
it("a driver step aborts when the car starts moving, and times out after 180 s as Can't", async () => {
  expect(
    (
      await runAgent(
        sym('x'),
        deps([DRIVER_HOLD, FINAL], { speedAfter: [0, 0, 5], driver: 'never' }),
      )
    ).trail[1].status,
  ).toBe('cant');
  expect(
    (await runAgent(sym('x'), deps([DRIVER_HOLD, FINAL], { driver: 'never' }))).trail[1].digest,
  ).toContain('No answer within 3 minutes');
});
it('no speed value while the driver restarts the engine does not abort the step', async () =>
  expect(
    (
      await runAgent(
        sym('x'),
        deps([DRIVER_RESTART, FINAL], {
          speedAfter: [0, null, null, 0],
          driver: 'done-after-3-polls',
        }),
      )
    ).trail[1].status,
  ).toBe('ok'));
it('open_skill returns the document; run_skill without a procedure is invalid', async () => {
  const o = await runAgent(
    sym('x'),
    deps([
      '{"tool":"open_skill","args":{"name":"doc"}}',
      '{"tool":"run_skill","args":{"name":"doc"}}',
      FINAL,
    ]),
  );
  expect(o.trail[1]).toMatchObject({ kind: 'skill' });
  expect(o.trail[1].digest).toContain('# doc');
  expect(o.trail[2]).toMatchObject({ kind: 'invalid' });
});
it('runs tools one at a time', async () => {
  await runAgent(sym('x'), deps([TOOL_T, TOOL_T, FINAL]));
  expect(maxConcurrentRuns).toBe(1);
});

// ---- details of the same behaviour ----

describe('details', () => {
  it('exposes the spec budget', () =>
    expect(AGENT_BUDGET).toEqual({
      maxSteps: 12,
      wallMs: 240_000,
      adapterMs: 120_000,
      driverTimeoutMs: 180_000,
      driverSpeedPollMs: 1000,
      maxInvalidInRow: 3,
    }));

  it('a tool error is recorded as a failed step and the run goes on', async () => {
    const o = await runAgent(sym('x'), deps(['{"tool":"fail","args":{},"why":"w"}', FINAL]));
    expect(o.end).toBe('final');
    expect(o.trail[1]).toMatchObject({
      kind: 'tool',
      tool: 'fail',
      status: 'error',
      digest: 'Read failed: NO DATA',
    });
  });

  it('an empty model reply and an uncited final count as invalid replies', async () => {
    const o = await runAgent(
      sym('x'),
      deps([null, '{"final":{"summary":"","findings":[]}}', 'no']),
    );
    expect(o.end).toBe('invalid');
    expect(o.trail.map((s) => s.kind)).toEqual(['triage', 'invalid', 'invalid', 'invalid']);
    expect(o.trail[1].digest).toBe('Reply with one JSON object.');
  });

  it('a tool that needs more adapter time than is left is refused', async () => {
    const o = await runAgent(
      sym('x'),
      deps([TOOL_COST_40S, TOOL_COST_40S, '{"tool":"cost50","args":{}}', FINAL]),
    );
    expect(o.end).toBe('final');
    expect(o.trail[3]).toMatchObject({
      kind: 'invalid',
      status: 'error',
      digest: 'Not enough adapter time left for cost50; finish now.',
    });
  });

  it('run_skill is refused when the skill’s maxAdapterMs no longer fits', async () => {
    const o = await runAgent(
      sym('x'),
      deps([TOOL_COST_40S, '{"tool":"run_skill","args":{"name":"big"}}', FINAL]),
    );
    expect(o.trail[2]).toMatchObject({
      kind: 'invalid',
      digest: 'Not enough adapter time left for run_skill; finish now.',
    });
  });

  it('run_skill of an unavailable skill is invalid', async () => {
    const o = await runAgent(
      sym('x'),
      deps(['{"tool":"run_skill","args":{"name":"nope"}}', FINAL]),
    );
    expect(o.trail[1]).toMatchObject({ kind: 'invalid', status: 'error' });
    expect(o.trail[1].digest).toContain('name must be one of');
  });

  it('run_skill runs the procedure in one step; nested tool time counts as adapter time', async () => {
    const o = await runAgent(
      sym('x'),
      deps(['{"tool":"run_skill","args":{"name":"triple"}}', FINAL]),
    );
    expect(o.trail.map((s) => s.kind)).toEqual(['triage', 'skill']);
    expect(o.trail[1]).toMatchObject({ tool: 'run_skill', status: 'ok', digest: 'triple ok' });
    expect(o.end).toBe('adapter');
  });

  it('a procedure’s driver wait goes through the gate and is not adapter time', async () => {
    const d = deps(['{"tool":"run_skill","args":{"name":"capture"}}', FINAL]);
    const o = await runAgent(sym('x'), d);
    expect(o.end).toBe('final');
    expect(o.trail[1].digest).toBe('driver done; T ok');
    expect(d.progress.some((p) => p.phase === 'driver' && p.driver === 'restart_engine')).toBe(
      true,
    );
  });

  it('a procedure’s driver step is refused by the same gate while moving', async () => {
    const o = await runAgent(
      sym('x'),
      deps(['{"tool":"run_skill","args":{"name":"capture"}}', FINAL], { speed: 30 }),
    );
    expect(o.trail[1].digest).toBe('driver refused; T ok');
  });

  it('onProgress reports the driver prompt opening and closing', async () => {
    const d = deps([DRIVER_HOLD, FINAL], { driver: 'done' });
    await runAgent(sym('x'), d);
    const open = d.progress.findIndex((p) => p.phase === 'driver');
    expect(d.progress[open]).toMatchObject({ driver: 'hold_2500_rpm', stepsUsed: 1 });
    expect(d.progress[open + 1]).toMatchObject({ driver: null });
    expect(d.progress.at(-1)).toMatchObject({ stepsUsed: 2, phase: 'thinking', driver: null });
  });

  it('Stop while the driver prompt is open settles the step and ends stopped', async () => {
    const ac = new AbortController();
    const d = deps([DRIVER_HOLD, FINAL], {
      signal: ac.signal,
      driver: 'never',
      onProgress: (p) => p.phase === 'driver' && ac.abort(),
    });
    const o = await runAgent(sym('x'), d);
    expect(o.end).toBe('stopped');
    expect(o.trail[1]).toMatchObject({ kind: 'driver', status: 'cant' });
  });

  it('a model call cut short by Stop ends stopped, not ai_error', async () => {
    const ac = new AbortController();
    const d = deps([], { signal: ac.signal });
    const o = await runAgent(sym('x'), {
      ...d,
      chat: async () => {
        ac.abort();
        throw new Error('Stopped.');
      },
    });
    expect(o).toMatchObject({ end: 'stopped', report: { source: 'local' } });
  });

  it('sends the action schema with every tool offered plus the built-ins', async () => {
    const schemas: unknown[] = [];
    const d = deps([]);
    await runAgent(sym('x'), {
      ...d,
      chat: async (_m, schema) => {
        schemas.push(schema);
        return FINAL;
      },
    });
    expect(schemas[0]).toMatchObject({
      name: 'bolid_agent_action',
      schema: {
        properties: {
          tool: {
            enum: [
              't',
              'slow',
              'cost40',
              'cost50',
              'drop',
              'fail',
              'open_skill',
              'run_skill',
              'ask_driver',
            ],
          },
        },
      },
    });
  });
});

// ---- without AI: triage plus every available skill with a procedure, then the rule report ----

/** Stand-ins for the 34b feature contributions the sweep reaches (obd-core never imports a
 *  feature): the real skills' names, `requires` and procedure ids, with canned results. */
function featureStandIn(
  name: string,
  tool: string,
  over: Partial<SkillFile>,
  result: ToolResult,
): AgentContribution {
  return {
    tools: [fakeTool(tool, 1000, async () => result)],
    skills: [skill(name, { tools: [tool], procedure: name, ...over })],
    procedures: [{ id: name, costMs: 1000, run: async (ctx) => ctx.callTool(tool) }],
  };
}

const FEATURE_STAND_INS: AgentContribution[] = [
  featureStandIn('used_car_check', 'read_inspection', {}, ok('Verdict: pass (score 92/100)')),
  featureStandIn(
    'dpf',
    'read_dpf',
    { requires: { fuel: ['diesel'], protocol: 'can', profile: ['extendedPids'] } },
    ok('Soot 12 g'),
  ),
  featureStandIn(
    'maintenance',
    'read_maintenance',
    {},
    {
      ...ok('Oil change overdue by 1200 km'),
      findings: [{ key: 'aiDiagnose:agent.finding.maintenance.overdue', severity: 'warn' }],
    },
  ),
  // Has a procedure but is not in the no-AI order: never swept.
  featureStandIn(
    'module_scan',
    'scan_modules',
    { requires: { protocol: 'can', profile: ['modules'] } },
    ok('scan'),
  ),
];

const golfFullRegistry = buildAgentRegistry([
  CORE_AGENT_CONTRIBUTION,
  ...FEATURE_STAND_INS,
  PLAYBOOK_CONTRIBUTION,
]);

/** The simulator Golf behind the read-only facade. */
async function golfSession(): Promise<ReadOnlySession> {
  const real = new DiagnosticSession(new MockTransport(buildScenario(golfPlus2009.id)), {
    commandTimeoutMs: 1000,
    firstCommandTimeoutMs: 1000,
  });
  await real.connect();
  return createReadOnlySession(real);
}

describe('without AI', () => {
  it('exposes the fixed sweep order', () =>
    expect(NO_AI_SKILL_ORDER).toEqual([
      'used_car_check',
      'fuel_trims',
      'boost',
      'misfire',
      'cooling',
      'dpf',
      'battery_charging',
      'maintenance',
    ]));

  it('without AI it runs the available skills in the fixed order', async () => {
    const d = deps([], {
      registry: golfFullRegistry,
      session: await golfSession(),
      driver: 'cant',
    });
    const o = await runAgent({ mode: 'everything' }, { ...d, chat: null });
    expect(o.end).toBe('no_ai');
    expect(o.stepsUsed).toBe(0);
    expect(o.trail.filter((s) => s.kind === 'skill').map((s) => s.tool)).toEqual([
      'used_car_check',
      'boost',
      'cooling',
      'dpf',
      'battery_charging',
      'maintenance',
    ]);
    expect(o.trail.map((s) => s.id)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(o.trail[1]).toMatchObject({
      why: '',
      args: {},
      label: { key: 'aiDiagnose:agent.tool.run_skill', values: { name: 'used_car_check' } },
    });
    expect(o.report.source).toBe('local');
    expect(o.report.findings.some((f) => (f.steps ?? [])[0] > 1)).toBe(true);
    // the swept skills' driver steps went through the same gate (rev hold, restart, load)
    expect(d.progress.some((p) => p.phase === 'driver' && p.driver === 'hold_2500_rpm')).toBe(true);
    expect(d.sentMessages).toHaveLength(0);
  });

  it('a symptom without AI sweeps the same way', async () => {
    const d = deps([], {
      registry: golfFullRegistry,
      session: await golfSession(),
      driver: 'cant',
    });
    const o = await runAgent(sym('pulls weak'), { ...d, chat: null });
    expect(o.end).toBe('no_ai');
    expect(o.trail.filter((s) => s.kind === 'skill')).toHaveLength(6);
  });

  it('Stop during the no-AI sweep keeps what was gathered', async () => {
    const ac = new AbortController();
    const d = deps([], {
      registry: golfFullRegistry,
      session: await golfSession(),
      driver: 'cant',
      signal: ac.signal,
      afterStep: (n) => n === 3 && ac.abort(),
    });
    const o = await runAgent({ mode: 'everything' }, { ...d, chat: null });
    expect(o.end).toBe('stopped');
    expect(o.trail).toHaveLength(3);
    expect(o.trail.map((s) => s.tool)).toEqual([undefined, 'used_car_check', 'boost']);
    expect(o.report.source).toBe('local');
  });

  it('an adapter drop during the sweep ends disconnected', async () => {
    const reg = buildAgentRegistry([
      CORE_AGENT_CONTRIBUTION,
      {
        tools: TOOLS,
        skills: [skill('maintenance', { tools: ['drop'], procedure: 'maintenance' })],
        procedures: [{ id: 'maintenance', costMs: 1000, run: (ctx) => ctx.callTool('drop') }],
      },
    ]);
    const o = await runAgent(
      { mode: 'everything' },
      { ...deps([], { registry: reg }), chat: null },
    );
    expect(o.end).toBe('disconnected');
    expect(o.trail).toHaveLength(1);
  });

  it('a skill that no longer fits the adapter time ends the sweep (adapter)', async () => {
    const reg = buildAgentRegistry([
      CORE_AGENT_CONTRIBUTION,
      {
        tools: TOOLS,
        skills: [
          skill('used_car_check', { procedure: 'used_car_check' }),
          skill('maintenance', { procedure: 'maintenance' }),
        ],
        procedures: [
          {
            id: 'used_car_check',
            costMs: 100_000,
            run: async (ctx) => {
              await ctx.sleep(100_000);
              return ok('uc ok');
            },
          },
          { id: 'maintenance', costMs: 40_000, run: async () => ok('m ok') },
        ],
      },
    ]);
    const o = await runAgent(
      { mode: 'everything' },
      { ...deps([], { registry: reg }), chat: null },
    );
    expect(o.end).toBe('adapter');
    expect(o.trail.map((s) => s.tool)).toEqual([undefined, 'used_car_check']);
  });
});
