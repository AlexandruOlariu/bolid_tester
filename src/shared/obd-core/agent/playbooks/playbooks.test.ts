import type { TripSample } from '../../analysis/trip';
import type { Mode06Result } from '../../obd/mode06';
import { DiagnosticSession, type LiveValue } from '../../session/DiagnosticSession';
import { MockTransport } from '../../transport/MockTransport';
import { buildScenario } from '../../transport/scenarios';
import { getVehicleProfile, type VehicleProfile } from '../../../vehicles';
import en from '../../../i18n/locales/en/aiDiagnose.json';
import ro from '../../../i18n/locales/ro/aiDiagnose.json';
import { CORE_AGENT_CONTRIBUTION } from '../coreTools';
import { DRIVER_INSTRUCTIONS } from '../driver';
import { runAgent, type AgentDeps } from '../loop';
import { createReadOnlySession, type ReadOnlySession } from '../readOnlySession';
import { BUILTIN_TOOLS, availableSkills, buildAgentRegistry } from '../registry';
import { parseSkillFile } from '../skillFile';
import type { TriageResult } from '../triage';
import type {
  AgentContribution,
  AgentRunRequest,
  AgentTool,
  AvailabilityContext,
  DriverInstructionId,
  DriverReply,
  ProcedureContext,
  SkillProcedure,
  ToolResult,
} from '../types';
import { PLAYBOOK_CONTRIBUTION, PLAYBOOK_NAMES } from './index';

const GOLF = 'golf-plus-2009-20tdi';
const PUNTO = 'fiat-punto-2008-12';
const PASSAT = 'passat-b55-19tdi';

const REG = buildAgentRegistry([CORE_AGENT_CONTRIBUTION, PLAYBOOK_CONTRIBUTION]);

function proc(id: string): SkillProcedure {
  const p = REG.procedures.get(id);
  if (!p) throw new Error(`no procedure ${id}`);
  return p;
}

function availability(profileId: string): AvailabilityContext {
  const profile = getVehicleProfile(profileId);
  return {
    profile,
    protocol: 'ISO_15765_4_CAN_11_500',
    supportedPids: profile.supportedPids,
    canMonitor: false,
  };
}

// ---- a simulated car with a fake clock, a fake driver and a scripted rev hold ----

type SimFault = 'lean_trims';

/** Test-local stand-in for the simulator's scripted fault (Task 7 builds the real one). */
const FAULTS: Record<SimFault, { idle: Record<string, number>; hold: Record<string, number> }> = {
  lean_trims: {
    idle: { '0106': 12.5, '0107': 18.0 },
    hold: { '0106': 3.1, '0107': 9.4 },
  },
};

/** What the car answers while the driver holds the revs (after `done` on `hold_2500_rpm`). */
const DEFAULT_HOLD: Record<string, number> = { '010C': 2500, '010B': 125 };

interface CtxOpts {
  /** The reply to every driver step, or one per instruction. */
  driver?: DriverReply | Partial<Record<DriverInstructionId, DriverReply>>;
  simFault?: SimFault;
  /** PIDs that never answer (`NO DATA`). */
  noData?: string[];
  /** PIDs that stop answering once the rev hold starts. */
  noDataAtHold?: string[];
  idle?: Record<string, number>;
  hold?: Record<string, number>;
  /** Extra tools / procedures / skills registered next to core + playbooks. */
  extra?: AgentContribution;
  /** Tools and skills offered for the car; default: everything registered. */
  offered?: { tools?: string[]; skills?: string[] };
  session?: (base: ReadOnlySession) => Partial<ReadOnlySession>;
}

interface TestCtx extends ProcedureContext {
  asked: DriverInstructionId[];
  called: { name: string; args: Record<string, unknown> }[];
}

const isReply = (d: CtxOpts['driver']): d is DriverReply =>
  d !== undefined && typeof (d as DriverReply).kind === 'string';

async function simProcCtx(profileId: string, opts: CtxOpts = {}): Promise<TestCtx> {
  const profile: VehicleProfile = getVehicleProfile(profileId);
  const real = new DiagnosticSession(new MockTransport(buildScenario(profileId)), {
    commandTimeoutMs: 1000,
    firstCommandTimeoutMs: 1000,
  });
  await real.connect();
  const ro = createReadOnlySession(real);

  let holding = false;
  const fault = opts.simFault ? FAULTS[opts.simFault] : undefined;
  const idle = { ...fault?.idle, ...opts.idle };
  const hold = { ...DEFAULT_HOLD, ...fault?.hold, ...opts.hold };
  const supported = new Set(ro.effectivePids());

  const pollOnce = async (pids: string[]): Promise<Record<string, LiveValue>> => {
    const out = await ro.pollOnce(pids);
    const values = holding ? { ...idle, ...hold } : idle;
    for (const pid of pids) {
      if (!supported.has(pid)) continue;
      const v = values[pid];
      if (v !== undefined)
        out[pid] = { ...(out[pid] ?? { pid, name: pid, unit: '', ts: 0 }), value: v };
      if (opts.noData?.includes(pid) || (holding && opts.noDataAtHold?.includes(pid)))
        delete out[pid];
    }
    return out;
  };
  const base: ReadOnlySession = { ...ro, pollOnce };
  const session: ReadOnlySession = { ...base, ...opts.session?.(base) };

  const reg = opts.extra
    ? buildAgentRegistry([CORE_AGENT_CONTRIBUTION, PLAYBOOK_CONTRIBUTION, opts.extra])
    : REG;
  const toolOffered = (name: string) =>
    reg.tools.has(name) && (opts.offered?.tools?.includes(name) ?? true);
  const skillOffered = (name: string) =>
    opts.offered?.skills ? opts.offered.skills.includes(name) : reg.skills.has(name);

  let clock = 0;
  const asked: DriverInstructionId[] = [];
  const called: TestCtx['called'] = [];
  const ctx: TestCtx = {
    session,
    profile,
    guideProfileId: profile.id,
    vehicle: { label: profile.name, make: profile.make },
    vin: null,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    signal: new AbortController().signal,
    askDriver: async (id) => {
      asked.push(id);
      const d = opts.driver;
      const reply: DriverReply = isReply(d) ? d : (d?.[id] ?? { kind: 'done' });
      if (id === 'hold_2500_rpm' && reply.kind === 'done') holding = true;
      return reply;
    },
    callTool: async (name, args = {}) => {
      const tool = reg.tools.get(name);
      if (!tool || !toolOffered(name)) throw new Error(`Unknown tool "${name}"`);
      called.push({ name, args });
      return tool.run(args, ctx);
    },
    runProcedure: async (id) => {
      const p = reg.procedures.get(id);
      if (!p) throw new Error(`Unknown procedure "${id}"`);
      return p.run(ctx);
    },
    hasTool: toolOffered,
    hasSkill: skillOffered,
    asked,
    called,
  };
  return ctx;
}

const golfProcCtx = (opts: CtxOpts) => simProcCtx(GOLF, opts);
const puntoProcCtx = (opts: CtxOpts) => simProcCtx(PUNTO, opts);
const keys = (r: ToolResult) => (r.findings ?? []).map((f) => f.key);
const F = 'aiDiagnose:agent.finding.';

function fakeTool(name: string, run: AgentTool['run']): AgentTool {
  return {
    name,
    description: `Fake ${name}.`,
    labelKey: `x:${name}`,
    args: { type: 'object', properties: {} },
    costMs: 0,
    available: () => true,
    run,
  };
}

// ---- a scripted agent run (for the document-only smoke playbook) ----

const OPEN_SMOKE = '{"tool":"open_skill","args":{"name":"smoke"},"why":"w"}';
const ASK_SMOKE = '{"tool":"ask_driver","args":{"id":"smoke_colour"},"why":"w"}';
const FINAL = '{"final":{"summary":"done","findings":[]}}';

const TRIAGE: TriageResult = {
  snapshot: {
    protocol: 'ISO_15765_4_CAN_11_500',
    vin: null,
    voltage: 12.6,
    supportedPidCount: 20,
    readiness: null,
    dtcs: { stored: [], pending: [], permanent: [] },
    freezeFrame: null,
    live: [],
  },
  step: {
    id: 1,
    kind: 'triage',
    why: '',
    digest: 'Triage digest',
    summary: 'Triage',
    label: { key: 'aiDiagnose:agent.step.triage', values: { count: 0, volts: '12.6' } },
    status: 'ok',
    durationMs: 0,
  },
};

function deps(script: string[], opts: { driver: DriverReply }): AgentDeps {
  const profile = getVehicleProfile(GOLF);
  let clock = 0;
  let calls = 0;
  const session = {
    currentProtocol: 'ISO_15765_4_CAN_11_500',
    supportedPids: profile.supportedPids,
    canMonitor: false,
    readValue: async (pid: string): Promise<LiveValue | null> =>
      pid === '010D' ? { pid, name: 'Vehicle speed', unit: 'km/h', value: 0, ts: clock } : null,
  } as unknown as ReadOnlySession;
  const signal = new AbortController().signal;
  return {
    registry: REG,
    ctx: {
      session,
      profile,
      guideProfileId: profile.id,
      vehicle: { label: profile.name },
      vin: null,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
      signal,
    },
    triage: TRIAGE,
    chat: async () => script[calls++] ?? FINAL,
    askDriver: async () => opts.driver,
    onProgress: () => undefined,
    signal,
    language: 'en',
    translate: (f) => ({ title: f.key, detail: f.key }),
  };
}

const sym = (symptom: string): AgentRunRequest => ({ mode: 'symptom', symptom });

// ---- the brief's tests ----

describe('symptom playbooks', () => {
  it('every playbook file parses and the registry accepts them alone (no features)', () => {
    const reg = buildAgentRegistry([CORE_AGENT_CONTRIBUTION, PLAYBOOK_CONTRIBUTION]);
    expect([...reg.skills.values()].filter((s) => s.kind === 'playbook')).toHaveLength(17);
  });

  it('boost is offered on the Golf and Passat, not on the Punto', () => {
    const reg = buildAgentRegistry([CORE_AGENT_CONTRIBUTION, PLAYBOOK_CONTRIBUTION]);
    expect(availableSkills(reg, availability(GOLF)).map((s) => s.name)).toContain('boost');
    expect(availableSkills(reg, availability(PASSAT)).map((s) => s.name)).toContain('boost');
    expect(availableSkills(reg, availability(PUNTO)).map((s) => s.name)).not.toContain('boost');
  });

  it('boost reports idle only when the driver cannot hold 2500 rpm', async () => {
    const r = await proc('boost').run(await golfProcCtx({ driver: { kind: 'cant' } }));
    expect(r.digest).toContain('rev hold: driver could not do it');
    expect(r.findings?.map((f) => f.key)).toEqual(['aiDiagnose:agent.finding.boost.ok']);
  });

  it('fuel_trims finds the vacuum-leak pattern on a lean Punto', async () => {
    const r = await proc('fuel_trims').run(
      await puntoProcCtx({ simFault: 'lean_trims', driver: { kind: 'done' } }),
    );
    expect(r.findings?.[0].key).toBe('aiDiagnose:agent.finding.trims.vacuum_leak');
  });

  it('fuel_trims does not judge when 0107 is not answered', async () => {
    const r = await proc('fuel_trims').run(await puntoProcCtx({ noData: ['0107'] }));
    expect(r.digest).toContain('0107 not answered: trims not judged');
    expect(r.findings ?? []).toEqual([]);
  });

  it('cooling without a trip tool judges the current reading only', async () =>
    expect(
      (await proc('cooling').run(await golfProcCtx({}))).findings?.map((f) => f.key),
    ).toContain('aiDiagnose:agent.finding.cooling.no_cold_trip'));

  it('smoke asks for the colour and records the choice', async () => {
    const o = await runAgent(
      sym('smoke'),
      deps([OPEN_SMOKE, ASK_SMOKE, FINAL], { driver: { kind: 'choice', value: 'blue' } }),
    );
    expect(o.trail[2].digest).toContain('Driver answered: blue');
  });
});

// ---- the playbook catalogue ----

describe('playbook catalogue', () => {
  const playbooks = (PLAYBOOK_CONTRIBUTION.skills ?? []).filter((s) => s.kind === 'playbook');

  it('names the 17 playbooks of the spec', () => {
    expect(playbooks.map((s) => s.name).sort()).toEqual([...PLAYBOOK_NAMES].sort());
    expect(PLAYBOOK_NAMES).toHaveLength(17);
  });

  it('each procedure id equals its playbook name, and only built-in or core tools are named', () => {
    const core = new Set([...BUILTIN_TOOLS, 'read_live', 'read_dtcs']);
    for (const s of playbooks) {
      expect(parseSkillFile(s).ok).toBe(true);
      if (s.procedure) expect(s.procedure).toBe(s.name);
      for (const t of s.tools) expect(core.has(t)).toBe(true);
      for (const id of s.driverSteps ?? []) expect(Object.keys(DRIVER_INSTRUCTIONS)).toContain(id);
    }
    const withProcedure = playbooks.filter((s) => s.procedure).map((s) => s.name);
    expect(withProcedure.sort()).toEqual(
      [
        'battery_charging',
        'before_long_trip',
        'boost',
        'check_engine_light',
        'cooling',
        'dpf_regen',
        'fuel_trims',
        'keeps_disconnecting',
        'misfire',
        'used_car',
      ].sort(),
    );
  });

  it('declares the requires of the plan', () => {
    const req = (n: string) => playbooks.find((s) => s.name === n)?.requires;
    expect(req('fuel_trims')).toEqual({ pids: ['0106', '0107'] });
    expect(req('boost')).toEqual({ profile: ['boost'], pids: ['010B', '010C'] });
    expect(req('battery_charging')).toBeUndefined();
    expect(req('cooling')).toEqual({ pids: ['0105'] });
    expect(req('misfire')).toEqual({ protocol: 'can', fuel: ['petrol', 'lpg'] });
    expect(req('dpf_regen')).toEqual({ skills: ['dpf'] });
    expect(req('used_car')).toEqual({ skills: ['used_car_check'] });
    expect(req('keeps_disconnecting')).toEqual({ skills: ['adapter_health'] });
    expect(req('glow_plugs')).toEqual({ fuel: ['diesel'] });
    expect(playbooks.find((s) => s.name === 'smoke')?.driverSteps).toEqual(['smoke_colour']);
  });

  it('without features, the Punto gets trims and misfire, the Golf boost and glow plugs', () => {
    const golf = availableSkills(REG, availability(GOLF)).map((s) => s.name);
    const punto = availableSkills(REG, availability(PUNTO)).map((s) => s.name);
    expect(golf).toEqual(expect.arrayContaining(['boost', 'glow_plugs', 'cooling', 'smoke']));
    expect(golf).not.toEqual(expect.arrayContaining(['fuel_trims']));
    expect(golf).not.toContain('misfire');
    expect(golf).not.toContain('dpf_regen'); // its capability skill is not registered
    expect(punto).toEqual(expect.arrayContaining(['fuel_trims', 'misfire', 'cooling']));
    expect(punto).not.toContain('glow_plugs');
  });

  it('the smoke_colour instruction asks for one of five colours', () => {
    expect(DRIVER_INSTRUCTIONS.smoke_colour).toEqual({
      en: 'With the engine running, look at the exhaust: what colour is the smoke?',
      labelKey: 'aiDiagnose:agent.driver.smoke_colour',
      choices: ['white', 'blue', 'black', 'grey', 'none'],
    });
  });

  it('every driver text, choice and finding key has en and ro text', () => {
    const findings = [
      'trims.ok',
      'trims.lean',
      'trims.rich',
      'trims.vacuum_leak',
      'trims.lean_all_speeds',
      'boost.ok',
      'boost.idle_high',
      'boost.stuck_vnt',
      'boost.map_below_baro',
      'boost.no_boost_hold',
      'boost.overboost_hold',
      'boost.stuck_sensor',
      'boost.hold_not_reached',
      'charging.ok',
      'charging.weakUnderLoad',
      'cooling.ok',
      'cooling.hot_now',
      'cooling.overheat_now',
      'cooling.thermostat_open',
      'cooling.slow_warmup',
      'cooling.trip_overheat',
      'cooling.no_cold_trip',
      'misfire.none',
      'misfire.cylinder',
      'misfire.random',
    ];
    for (const locale of [en, ro]) {
      const agent = locale.agent as unknown as {
        driver: Record<string, string>;
        driverChoice: Record<string, string>;
        finding: Record<string, Record<string, { title: string; detail: string }>>;
      };
      expect(agent.driver.smoke_colour).toBeTruthy();
      for (const c of DRIVER_INSTRUCTIONS.smoke_colour.choices ?? [])
        expect(agent.driverChoice[c]).toBeTruthy();
      for (const k of findings) {
        const [group, id] = k.split('.');
        expect(agent.finding[group]?.[id]?.title).toBeTruthy();
        expect(agent.finding[group]?.[id]?.detail).toBeTruthy();
      }
    }
  });
});

// ---- procedures ----

describe('boost procedure', () => {
  it('judges the rev hold when the driver holds 2500 rpm', async () => {
    const ctx = await golfProcCtx({ driver: { kind: 'done' } });
    const r = await proc('boost').run(ctx);
    expect(ctx.asked).toEqual(['hold_2500_rpm']);
    expect(keys(r)).toEqual([`${F}boost.ok`]);
    expect(r.digest).toContain('MAP 125 kPa at the rev hold (max 2500 rpm)');
    expect(r.findings?.[0].values).toMatchObject({ idle: 0, hold: 25 });
  });

  it('flags no boost at the hold', async () => {
    const r = await proc('boost').run(await golfProcCtx({ hold: { '010B': 102 } }));
    expect(keys(r)).toEqual([`${F}boost.no_boost_hold`]);
    expect(r.findings?.[0].severity).toBe('warn');
  });

  it('says the hold was not reached and does not judge it', async () => {
    const r = await proc('boost').run(await golfProcCtx({ hold: { '010C': 1800 } }));
    expect(r.digest).toContain('rev hold not reached (max 1800 rpm)');
    expect(keys(r)).toEqual([`${F}boost.hold_not_reached`]);
  });

  it('a timeout on the hold still reports the idle part', async () => {
    const r = await proc('boost').run(await golfProcCtx({ driver: { kind: 'timeout' } }));
    expect(r.digest).toContain('rev hold: driver could not do it');
    expect(keys(r)).toEqual([`${F}boost.ok`]);
  });

  it('assumes the baro on the Passat (no 0133) and says so', async () => {
    const r = await proc('boost').run(await simProcCtx(PASSAT, { driver: { kind: 'cant' } }));
    expect(r.digest).toContain('baro assumed 101.3 kPa');
  });

  it('MAP going NO DATA at the hold leaves the hold out of the judgement', async () => {
    const r = await proc('boost').run(await golfProcCtx({ noDataAtHold: ['010B'] }));
    expect(r.digest).toContain('010B not answered at the rev hold');
    expect(keys(r)).toEqual([`${F}boost.ok`]);
  });

  it('no MAP at idle: not judged, no finding, no driver step', async () => {
    const ctx = await golfProcCtx({ noData: ['010B'] });
    const r = await proc('boost').run(ctx);
    expect(r.digest).toContain('010B not answered: boost not judged');
    expect(r.findings ?? []).toEqual([]);
    expect(ctx.asked).toEqual([]);
  });
});

describe('fuel_trims procedure', () => {
  it('judges trims within limits as ok on the stock Punto', async () => {
    const r = await proc('fuel_trims').run(await puntoProcCtx({}));
    expect(keys(r)).toEqual([`${F}trims.ok`]);
  });

  it('reports the idle part when the driver cannot hold the revs', async () => {
    const r = await proc('fuel_trims').run(
      await puntoProcCtx({ simFault: 'lean_trims', driver: { kind: 'cant' } }),
    );
    expect(r.digest).toContain('rev hold: driver could not do it');
    expect(keys(r)).toEqual([`${F}trims.lean`]);
  });

  it('a hold below 2200 rpm is not used', async () => {
    const r = await proc('fuel_trims').run(
      await puntoProcCtx({ simFault: 'lean_trims', hold: { '010C': 1800 } }),
    );
    expect(r.digest).toContain('rev hold not reached (max 1800 rpm)');
    expect(keys(r)).toEqual([`${F}trims.lean`]);
  });

  it('a trim going NO DATA at the hold still judges the idle part', async () => {
    const r = await proc('fuel_trims').run(
      await puntoProcCtx({ simFault: 'lean_trims', noDataAtHold: ['0107'] }),
    );
    expect(r.digest).toContain('0107 not answered at the rev hold');
    expect(keys(r)).toEqual([`${F}trims.lean`]);
  });
});

describe('battery_charging procedure', () => {
  it('runs the battery capture, then reads the charging voltage under load', async () => {
    const ctx = await golfProcCtx({});
    const r = await proc('battery_charging').run(ctx);
    expect(ctx.asked).toEqual(['restart_engine', 'electrical_load_on', 'electrical_load_off']);
    expect(keys(r)[0]).toMatch(/^aiDiagnose:agent\.finding\.battery\./);
    expect(keys(r)).toContain(`${F}charging.ok`);
  });

  it('flags a weak charge under load', async () => {
    const r = await proc('battery_charging').run(await golfProcCtx({ idle: { '0142': 12.9 } }));
    const f = r.findings?.find((x) => x.key === `${F}charging.weakUnderLoad`);
    expect(f).toMatchObject({ severity: 'warn', values: { volts: '12.9' } });
  });

  it('uses the adapter voltage when 0142 is not supported', async () => {
    const r = await proc('battery_charging').run(
      await golfProcCtx({
        session: (b) => ({
          effectivePids: () => b.effectivePids().filter((p) => p !== '0142'),
          voltage: async () => 13.0,
        }),
      }),
    );
    expect(keys(r)).toContain(`${F}charging.weakUnderLoad`);
  });

  it('does not judge charging when the engine is not running', async () => {
    const r = await proc('battery_charging').run(await golfProcCtx({ idle: { '010C': 0 } }));
    expect(keys(r).some((k) => k.includes('charging'))).toBe(false);
    expect(r.digest).toContain('charging under load not judged');
  });

  it('skips the load part (and its switch-off) when the driver cannot switch the loads on', async () => {
    const ctx = await golfProcCtx({ driver: { electrical_load_on: { kind: 'cant' } } });
    const r = await proc('battery_charging').run(ctx);
    expect(ctx.asked).toEqual(['restart_engine', 'electrical_load_on']);
    expect(r.digest).toContain('electrical load: driver could not do it');
    expect(keys(r).some((k) => k.includes('charging'))).toBe(false);
  });
});

describe('cooling procedure', () => {
  const minute = 60_000;
  const coldTrip = (maxC: number): TripSample[] =>
    Array.from({ length: 21 }, (_, i) => ({
      t: i * minute,
      values: { '0105': Math.min(maxC, 20 + i * 4), '010D': 50 },
    }));
  const tripTool = (samples: TripSample[] | null) =>
    fakeTool('read_trip', async () =>
      samples
        ? { digest: 'Trip t1', summary: 'Trip t1', data: { header: { id: 't1' }, samples } }
        : { digest: 'No cold-start trip', summary: 'Trip: no cold start' },
    );

  it('reads the latest cold trip and finds a thermostat stuck open', async () => {
    const ctx = await golfProcCtx({ extra: { tools: [tripTool(coldTrip(70))] } });
    const r = await proc('cooling').run(ctx);
    expect(ctx.called.find((c) => c.name === 'read_trip')?.args).toEqual({ id: 'latest_cold' });
    expect(keys(r)).toEqual([`${F}cooling.thermostat_open`]);
  });

  it('a normal cold trip is ok', async () => {
    const r = await proc('cooling').run(
      await golfProcCtx({ extra: { tools: [tripTool(coldTrip(90))] } }),
    );
    expect(keys(r)).toEqual([`${F}cooling.ok`]);
  });

  it('a trip without coolant falls back to the current reading and says why', async () => {
    const noCoolant = coldTrip(90).map((s) => ({ t: s.t, values: { '010D': 50 } }));
    const r = await proc('cooling').run(
      await golfProcCtx({ extra: { tools: [tripTool(noCoolant)] } }),
    );
    expect(r.digest).toContain('no coolant');
    expect(keys(r)).toEqual([`${F}cooling.no_cold_trip`]);
  });

  it('no cold-start trip recorded: current reading only', async () => {
    const r = await proc('cooling').run(await golfProcCtx({ extra: { tools: [tripTool(null)] } }));
    expect(keys(r)).toEqual([`${F}cooling.no_cold_trip`]);
    expect(r.digest).toContain('No recorded trip started cold');
  });

  it('flags an overheating engine now', async () => {
    const r = await proc('cooling').run(await golfProcCtx({ idle: { '0105': 112 } }));
    expect(keys(r)).toContain(`${F}cooling.hot_now`);
  });

  it('no coolant reading now is not judged', async () => {
    const r = await proc('cooling').run(await golfProcCtx({ noData: ['0105'] }));
    expect(r.digest).toContain('0105 not answered');
    expect(keys(r)).not.toContain(`${F}cooling.ok`);
  });
});

describe('misfire procedure', () => {
  const mode06 = (counts: Record<string, number>) => (b: ReadOnlySession) => ({
    readMode06: async (mid: string): Promise<Mode06Result[]> => {
      if (counts[mid] === undefined) return b.readMode06(mid);
      const r: Mode06Result = {
        mid: parseInt(mid, 16),
        tid: 0x0c,
        value: counts[mid],
        min: 0,
        max: 65535,
        pass: true,
        unit: 'count',
      };
      return [r];
    },
  });

  it('singles out one misfiring cylinder', async () => {
    const r = await proc('misfire').run(
      await puntoProcCtx({ session: mode06({ A2: 0, A3: 14, A4: 1, A5: 0 }) }),
    );
    expect(r.findings).toEqual([
      expect.objectContaining({
        key: `${F}misfire.cylinder`,
        severity: 'warn',
        values: { cylinder: 2, count: 14 },
      }),
    ]);
  });

  it('no counts reported: not judged, no finding', async () => {
    const r = await proc('misfire').run(
      await puntoProcCtx({ session: () => ({ readMode06: async () => [] }) }),
    );
    expect(r.findings ?? []).toEqual([]);
    expect(r.digest).toContain('misfires not judged');
  });
});

describe('playbooks that use feature procedures and tools', () => {
  const okProc = (id: string, digest: string): SkillProcedure => ({
    id,
    costMs: 0,
    run: async () => ({
      digest,
      summary: digest,
      findings: [{ key: `x:${id}`, severity: 'info' }],
    }),
  });

  it('dpf_regen and used_car run their capability procedure', async () => {
    const ctx = await golfProcCtx({
      extra: { procedures: [okProc('dpf', 'DPF read'), okProc('used_car_check', 'Inspection')] },
    });
    expect((await proc('dpf_regen').run(ctx)).digest).toContain('DPF read');
    expect(keys(await proc('used_car').run(ctx))).toEqual(['x:used_car_check']);
  });

  it('before_long_trip runs only the checks offered for the car', async () => {
    const ctx = await golfProcCtx({
      extra: { procedures: [okProc('maintenance', 'Maintenance'), okProc('dpf', 'DPF read')] },
      offered: { skills: ['cooling', 'maintenance'] },
    });
    const r = await proc('before_long_trip').run(ctx);
    expect(r.digest).toContain('[cooling]');
    expect(r.digest).toContain('[maintenance] Maintenance');
    expect(r.digest).toContain('Not available on this car: dpf');
    expect(keys(r)).toEqual(expect.arrayContaining([`${F}cooling.no_cold_trip`, 'x:maintenance']));
  });

  it('keeps_disconnecting adds the app errors when error-log is registered', async () => {
    const extra = {
      procedures: [okProc('adapter_health', 'Adapter good')],
      tools: [fakeTool('read_app_errors', async () => ({ digest: '2 errors', summary: 's' }))],
    };
    const ctx = await golfProcCtx({ extra });
    const r = await proc('keeps_disconnecting').run(ctx);
    expect(r.digest).toContain('Adapter good');
    expect(r.digest).toContain('2 errors');
    expect(ctx.called).toEqual([{ name: 'read_app_errors', args: { limit: 10 } }]);

    const alone = await golfProcCtx({ extra: { procedures: extra.procedures } });
    expect((await proc('keeps_disconnecting').run(alone)).digest).not.toContain('2 errors');
  });

  it('check_engine_light details at most 4 stored codes when read_dtcs_detail is registered', async () => {
    const detail = fakeTool('read_dtcs_detail', async (args) => ({
      digest: `Detail ${String(args.code)}`,
      summary: 's',
    }));
    const ctx = await golfProcCtx({ extra: { tools: [detail] } });
    const r = await proc('check_engine_light').run(ctx);
    expect(ctx.called[0].name).toBe('read_dtcs');
    const details = ctx.called.filter((c) => c.name === 'read_dtcs_detail');
    expect(details.length).toBeGreaterThan(0);
    expect(details.length).toBeLessThanOrEqual(4);
    expect(r.digest).toContain(`Detail ${String(details[0].args.code)}`);
  });

  it('check_engine_light reads the codes alone without the fault-codes feature', async () => {
    const ctx = await golfProcCtx({});
    const r = await proc('check_engine_light').run(ctx);
    expect(ctx.called.map((c) => c.name)).toEqual(['read_dtcs']);
    expect(r.digest).toContain('Stored DTCs');
  });
});
