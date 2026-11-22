import { DiagnosticSession } from '@/shared/obd-core/session/DiagnosticSession';
import type { LiveValue } from '@/shared/obd-core/session/DiagnosticSession';
import { MockTransport } from '@/shared/obd-core/transport/MockTransport';
import type { SimScenario } from '@/shared/obd-core/transport/MockTransport';
import { buildScenario } from '@/shared/obd-core/transport/scenarios';
import { buildAgentRegistry, createReadOnlySession, parseSkillFile } from '@/shared/obd-core';
import type {
  AgentContribution,
  AgentTool,
  AvailabilityContext,
  DriverReply,
  ReadOnlySession,
  ToolContext,
} from '@/shared/obd-core';
import type { ProtocolId } from '@/shared/obd-core/obd/protocols';
import { getVehicleProfile } from '@/shared/vehicles';
import type { VehicleProfile } from '@/shared/vehicles';
import { golfPlus2009 } from '@/shared/vehicles/golf-plus-2009-20tdi';
import { agentTools as sensorTools } from './agentTools';
import sensorTestsSkill from './sensor_tests.skill.json';

interface CtxOptions {
  profile?: VehicleProfile;
  scenario?: Partial<SimScenario>;
  askDriver?: jest.Mock<Promise<DriverReply>, [string]>;
  /** Every Nth single-PID read answers NO DATA. */
  dropEvery?: number;
  /** The car's answers to single-PID reads, in order (then the last). */
  values?: number[];
}

/** A simulator car behind the read-only facade, with a fake clock `sleep` advances. */
async function golfCtx(opts: CtxOptions = {}): Promise<ToolContext & { reads: () => number }> {
  const profile = opts.profile ?? golfPlus2009;
  const mock = new MockTransport(buildScenario(profile.id, opts.scenario ?? {}));
  const session = new DiagnosticSession(mock, {
    commandTimeoutMs: 1000,
    firstCommandTimeoutMs: 1000,
  });
  await session.connect();
  const ro = createReadOnlySession(session);
  let reads = 0;
  const readValue = async (pid: string): Promise<LiveValue | null> => {
    reads++;
    if (opts.dropEvery && reads % opts.dropEvery === 0) return null;
    const real = await ro.readValue(pid);
    if (!opts.values || !real) return real;
    return { ...real, value: opts.values[Math.min(reads - 1, opts.values.length - 1)] };
  };
  const wrapped: ReadOnlySession = { ...ro, readValue };
  let t = 0;
  return {
    session: wrapped,
    profile,
    guideProfileId: profile.id,
    vehicle: { label: profile.name, make: profile.make },
    vin: null,
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
    signal: new AbortController().signal,
    askDriver: opts.askDriver ?? jest.fn().mockResolvedValue({ kind: 'done' }),
    reads: () => reads,
  };
}

function toolOf(c: AgentContribution, name: string): AgentTool {
  const t = c.tools?.find((x) => x.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return t;
}

function availability(profileId: string, protocol?: ProtocolId): AvailabilityContext {
  const profile = getVehicleProfile(profileId);
  return {
    profile,
    protocol:
      protocol ??
      (profile.expectedProtocol === 'AUTO' ? 'ISO_15765_4_CAN_11_500' : profile.expectedProtocol),
    supportedPids: [],
    canMonitor: false,
  };
}

describe('sensor-tests agent contribution', () => {
  it('registers the sensor_tests skill with its two tools', () => {
    expect(parseSkillFile(sensorTestsSkill).ok).toBe(true);
    const reg = buildAgentRegistry([sensorTools]);
    expect(reg.skills.get('sensor_tests')?.tools).toEqual(['read_mode06', 'wiggle_test']);
    expect(reg.skills.get('sensor_tests')?.driverSteps).toEqual(['wiggle_connector']);
    expect(toolOf(sensorTools, 'read_mode06').labelKey).toBe('sensorTests:agent.tool.read_mode06');
    expect(toolOf(sensorTools, 'wiggle_test').labelKey).toBe('sensorTests:agent.tool.wiggle_test');
  });

  it('offers read_mode06 when Mode 06 tests are declared or on a petrol K-line car', () => {
    const mode06 = toolOf(sensorTools, 'read_mode06');
    expect(mode06.costMs).toBe(4000);
    expect(mode06.available(availability('golf-plus-2009-20tdi'))).toBe(true);
    expect(mode06.available(availability('passat-b55-19tdi'))).toBe(false);
    expect(mode06.available(availability('fiat-punto-2008-12'))).toBe(false);
    expect(mode06.available(availability('fiat-punto-2008-12', 'ISO_9141_2'))).toBe(true);
    const wiggle = toolOf(sensorTools, 'wiggle_test');
    expect(wiggle.costMs).toBe(16_000);
    expect(wiggle.available(availability('passat-b55-19tdi'))).toBe(true);
  });
});

describe('read_mode06', () => {
  it('read_mode06 lists the Golf monitor with its limits', async () =>
    expect((await toolOf(sensorTools, 'read_mode06').run({}, await golfCtx())).digest).toMatch(
      /MID 01 TID 8E: .* \(limits .*\) (pass|fail)/,
    ));

  it('formats value, limits and pass without a finding', async () => {
    const r = await toolOf(sensorTools, 'read_mode06').run({}, await golfCtx());
    expect(r.digest).toContain('MID 01 TID 8E: 48.8 mV (limits 12.2–97.6) pass');
    expect(r.findings ?? []).toEqual([]);
  });

  it('flags a failing monitor result', async () => {
    // value 0x0400 (124.9 mV) above the 97.6 mV upper limit.
    const ctx = await golfCtx({
      scenario: { mode06: { '01': [0x46, 0x01, 0x8e, 0x0a, 0x04, 0x00, 0x00, 0x64, 0x03, 0x20] } },
    });
    const r = await toolOf(sensorTools, 'read_mode06').run({}, ctx);
    expect(r.digest).toContain('MID 01 TID 8E: 124.9 mV (limits 12.2–97.6) fail');
    expect(r.findings).toEqual([
      {
        key: 'sensorTests:agent.finding.monitorFail',
        severity: 'warn',
        values: { mid: '01', tid: '8E' },
      },
    ]);
  });

  it('says so in one line when the car gives no result', async () => {
    const r = await toolOf(sensorTools, 'read_mode06').run(
      {},
      await golfCtx({ scenario: { mode06: {} } }),
    );
    expect(r.digest).toBe('No Mode 06 results from the car.');
  });

  it('sweeps Mode 05 on a petrol K-line car', async () => {
    const punto = getVehicleProfile('fiat-punto-2008-12');
    const ctx = await golfCtx({
      profile: punto,
      scenario: {
        protocol: 'ISO_9141_2',
        mode05: { '0101': [0x45, 0x01, 0x01, 0x5a], '0501': [0x45, 0x05, 0x01, 0x20] },
      },
    });
    const r = await toolOf(sensorTools, 'read_mode06').run({}, ctx);
    expect(r.digest).toContain('Mode 05 TID 01 Rich→lean sensor threshold (sensor 01): 0.45 V');
    expect(r.digest).toContain('Mode 05 TID 05 Rich→lean switch time (sensor 01): raw 20');
  });
});

describe('wiggle_test', () => {
  it('wiggle_test asks the driver and reports dropouts', async () => {
    const ctx = await golfCtx({
      askDriver: jest.fn().mockResolvedValue({ kind: 'done' }),
      dropEvery: 7,
    });
    const r = await toolOf(sensorTools, 'wiggle_test').run({ pid: '010B', seconds: 5 }, ctx);
    expect(ctx.askDriver).toHaveBeenCalledWith('wiggle_connector');
    expect(r.findings?.[0].key).toBe('sensorTests:agent.finding.wiggleDropout');
    expect(r.findings?.[0].severity).toBe('warn');
    // 5 s every 250 ms = 20 reads; the 7th and the 14th answer NO DATA.
    expect(ctx.reads()).toBe(20);
    expect(r.digest).toContain('NO DATA dropouts 2');
    expect(r.digest).toMatch(/min \d+(\.\d)? \/ max \d+(\.\d)? kPa/);
  });

  it('flags a large step as unstable', async () => {
    // 100 / 101 alternating (steps of 1) with one 131 spike: two steps of 30.
    const values = Array.from({ length: 20 }, (_, i) => (i === 10 ? 131 : 100 + (i % 2)));
    const r = await toolOf(sensorTools, 'wiggle_test').run(
      { pid: '010B', seconds: 5 },
      await golfCtx({ values }),
    );
    expect(r.digest).toContain('largest step 30 kPa (median step 1 kPa)');
    expect(r.findings).toEqual([
      expect.objectContaining({
        key: 'sensorTests:agent.finding.wiggleUnstable',
        severity: 'info',
      }),
    ]);
  });

  it('reports no finding for a steady signal over the default 10 s', async () => {
    const ctx = await golfCtx({ values: [100] });
    const r = await toolOf(sensorTools, 'wiggle_test').run({ pid: '010B' }, ctx);
    expect(ctx.reads()).toBe(40);
    expect(r.digest).toContain('NO DATA dropouts 0');
    expect(r.findings ?? []).toEqual([]);
  });

  it('does not judge the signal when the driver step was refused', async () => {
    const ctx = await golfCtx({
      askDriver: jest.fn().mockResolvedValue({ kind: 'refused', reason: 'moving' }),
      dropEvery: 2,
    });
    const r = await toolOf(sensorTools, 'wiggle_test').run({ pid: '010B', seconds: 5 }, ctx);
    expect(r.digest).toContain('Driver step refused (car moving)');
    expect(r.findings ?? []).toEqual([]);
  });

  it('refuses a PID the car does not support without asking the driver', async () => {
    const ctx = await golfCtx();
    const r = await toolOf(sensorTools, 'wiggle_test').run({ pid: '0114' }, ctx);
    expect(r.digest).toBe('0114 is not supported on this car: choose a supported PID.');
    expect(r.status).toBe('error');
    expect(ctx.askDriver).not.toHaveBeenCalled();
  });
});
