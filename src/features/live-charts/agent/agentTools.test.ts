import { DiagnosticSession } from '@/shared/obd-core/session/DiagnosticSession';
import type { LiveValue } from '@/shared/obd-core/session/DiagnosticSession';
import { MockTransport } from '@/shared/obd-core/transport/MockTransport';
import { buildScenario } from '@/shared/obd-core/transport/scenarios';
import { buildAgentRegistry, createReadOnlySession, parseSkillFile } from '@/shared/obd-core';
import type {
  AgentContribution,
  AgentTool,
  AvailabilityContext,
  ReadOnlySession,
  ToolContext,
} from '@/shared/obd-core';
import { getVehicleProfile } from '@/shared/vehicles';
import { golfPlus2009 } from '@/shared/vehicles/golf-plus-2009-20tdi';
import { agentTools as chartTools } from './agentTools';
import recordLiveSkill from './record_live.skill.json';

/** The Golf simulator behind the read-only facade, with a fake clock `sleep` advances. With
 *  `coolant`, polled 0105 answers those values in order (then the last). */
async function golfCtx(coolant?: number[]): Promise<ToolContext & { polls: () => number }> {
  const mock = new MockTransport(buildScenario(golfPlus2009.id));
  const session = new DiagnosticSession(mock, {
    commandTimeoutMs: 1000,
    firstCommandTimeoutMs: 1000,
  });
  await session.connect();
  const ro = createReadOnlySession(session);
  let polls = 0;
  const pollOnce = async (pids: string[]): Promise<Record<string, LiveValue>> => {
    const out = await ro.pollOnce(pids);
    const v = coolant?.[Math.min(polls, coolant.length - 1)];
    polls++;
    if (v !== undefined && out['0105']) out['0105'] = { ...out['0105'], value: v };
    return out;
  };
  const wrapped: ReadOnlySession = { ...ro, pollOnce };
  let t = 0;
  return {
    session: wrapped,
    profile: golfPlus2009,
    guideProfileId: golfPlus2009.id,
    vehicle: { label: golfPlus2009.name, make: golfPlus2009.make },
    vin: null,
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
    signal: new AbortController().signal,
    askDriver: async () => ({ kind: 'done' }),
    polls: () => polls,
  };
}

function toolOf(c: AgentContribution, name: string): AgentTool {
  const t = c.tools?.find((x) => x.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return t;
}

function availability(profileId: string): AvailabilityContext {
  const profile = getVehicleProfile(profileId);
  return {
    profile,
    protocol:
      profile.expectedProtocol === 'AUTO' ? 'ISO_15765_4_CAN_11_500' : profile.expectedProtocol,
    supportedPids: [],
    canMonitor: false,
  };
}

describe('live-charts agent contribution', () => {
  it('registers the record_live skill and tool, offered on every car', () => {
    expect(parseSkillFile(recordLiveSkill).ok).toBe(true);
    const reg = buildAgentRegistry([chartTools]);
    expect(reg.skills.get('record_live')?.tools).toEqual(['record_live']);
    const tool = toolOf(chartTools, 'record_live');
    expect(tool.labelKey).toBe('liveCharts:agent.tool.record_live');
    expect(tool.costMs).toBe(16_000);
    for (const id of ['golf-plus-2009-20tdi', 'passat-b55-19tdi', 'fiat-punto-2008-12'])
      expect(tool.available(availability(id))).toBe(true);
  });
});

describe('record_live', () => {
  it('record_live adds a trend', async () =>
    expect(
      (await toolOf(chartTools, 'record_live').run({ pids: ['0105'], seconds: 3 }, await golfCtx()))
        .digest,
    ).toMatch(/trend (rising|falling|steady)/));

  it('gives min / avg / max and the trend per PID, polling every 500 ms', async () => {
    const ctx = await golfCtx([70, 70, 75, 80, 85, 90]);
    const r = await toolOf(chartTools, 'record_live').run({ pids: ['0105'], seconds: 3 }, ctx);
    expect(ctx.polls()).toBe(6);
    expect(r.digest).toMatch(
      /^0105 .*: min 70 \/ avg 78\.3 \/ max 90 °C \(n=6, 3 s\), trend rising$/m,
    );
    expect(r.summary).toBe('Recorded 3 s: 0105 avg 78.3 °C rising');
  });

  it('keeps the window within 3-15 s and lists unsupported PIDs', async () => {
    const ctx = await golfCtx();
    const r = await toolOf(chartTools, 'record_live').run(
      { pids: ['0105', '0114'], seconds: 1 },
      ctx,
    );
    expect(ctx.polls()).toBe(6); // raised to 3 s
    expect(r.digest).toContain('Not supported on this car: 0114.');
  });

  it('says so when no PID is supported', async () => {
    const r = await toolOf(chartTools, 'record_live').run(
      { pids: ['0114'], seconds: 3 },
      await golfCtx(),
    );
    expect(r.digest).toBe('Not supported on this car: 0114.');
  });
});
