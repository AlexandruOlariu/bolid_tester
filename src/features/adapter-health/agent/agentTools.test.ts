import { DiagnosticSession } from '@/shared/obd-core/session/DiagnosticSession';
import { MockTransport } from '@/shared/obd-core/transport/MockTransport';
import { buildScenario } from '@/shared/obd-core/transport/scenarios';
import { buildAgentRegistry, createReadOnlySession, parseSkillFile } from '@/shared/obd-core';
import type {
  AgentContribution,
  AgentTool,
  ProcedureContext,
  ReadOnlySession,
  ToolContext,
} from '@/shared/obd-core';
import { bytesToString } from '@/shared/lib/bytes';
import { getVehicleProfile } from '@/shared/vehicles';
import en from '@/shared/i18n/locales/en/adapterHealth.json';
import ro from '@/shared/i18n/locales/ro/adapterHealth.json';
import { agentTools as adapterTools } from './agentTools';
import adapterHealthSkill from './adapter_health.skill.json';

const golf = getVehicleProfile('golf-plus-2009-20tdi');

/** A tool context with `session`; the clock steps 3 ms per read, so each latency is 3 ms. */
function ctxWith(session: ReadOnlySession): ToolContext {
  let t = 0;
  return {
    session,
    profile: golf,
    guideProfileId: golf.id,
    vehicle: { label: golf.name, make: golf.make },
    vin: null,
    now: () => (t += 3),
    sleep: async () => undefined,
    signal: new AbortController().signal,
    askDriver: async () => ({ kind: 'done' }),
  };
}

/** A tool context over the simulated Golf, plus every command sent after connect. */
async function golfCtxFor(): Promise<{ ctx: ToolContext; sent: string[] }> {
  const mock = new MockTransport(buildScenario(golf.id, {}));
  const sent: string[] = [];
  const write = mock.write.bind(mock);
  mock.write = async (bytes: Uint8Array) => {
    sent.push(bytesToString(bytes).trim());
    return write(bytes);
  };
  const session = new DiagnosticSession(mock, {
    commandTimeoutMs: 1000,
    firstCommandTimeoutMs: 1000,
  });
  await session.connect();
  sent.splice(0);
  return { sent, ctx: ctxWith(createReadOnlySession(session)) };
}

/** A facade stub that answers only what the check uses. */
function stubSession(over: Partial<ReadOnlySession>): ReadOnlySession {
  return {
    adapterVersion: async () => 'ELM327 v1.4b',
    voltage: async () => 13.9,
    protocolNumber: async () => 'ISO_15765_4_CAN_11_500',
    request: async () => [0x41, 0x00],
    ...over,
  } as ReadOnlySession;
}

function toolOf(c: AgentContribution, name: string): AgentTool {
  const t = c.tools?.find((x) => x.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return t;
}

const checkAdapter = toolOf(adapterTools, 'check_adapter');

describe('adapter-health agent tools', () => {
  it('check_adapter grades the simulator and never sends a write', async () => {
    const { ctx: golfCtx, sent } = await golfCtxFor();
    const r = await toolOf(adapterTools, 'check_adapter').run({}, golfCtx);
    expect(r.findings?.[0].key).toMatch(/^adapterHealth:agent\.finding\.(good|ok|poor)$/);
    expect(sent.filter((c) => c === '04')).toEqual([]);
  });

  it('reports grade, firmware, voltage, protocol, latency and timeouts over a 5-command burst', async () => {
    const { ctx, sent } = await golfCtxFor();
    const r = await checkAdapter.run({}, ctx);
    expect(r.digest.split('\n')).toEqual([
      'Grade: good',
      'Firmware: ELM327 v2.2',
      'Voltage: 12.3 V',
      'Protocol: ISO 15765-4 CAN (11-bit, 500 kbps)',
      'Latency: median 3 ms, slowest 3 ms',
      'Timeouts: 0/5',
    ]);
    expect(r.summary).toBe('Adapter: good, median 3 ms');
    expect(r.findings).toEqual([{ key: 'adapterHealth:agent.finding.good', severity: 'ok' }]);
    expect(sent.filter((c) => c === '0100')).toHaveLength(5);
    expect(sent.filter((c) => /^(04|14|2E|2F|31|3B|27)/i.test(c))).toEqual([]);
  });

  it('a clone firmware string is graded ok, an info finding, and flagged in the digest', async () => {
    const r = await checkAdapter.run(
      {},
      ctxWith(stubSession({ adapterVersion: async () => 'ELM327 v1.5' })),
    );
    expect(r.digest.split('\n')[0]).toBe('Grade: ok (clone firmware suspected)');
    expect(r.findings).toEqual([{ key: 'adapterHealth:agent.finding.ok', severity: 'info' }]);
  });

  it('a silent adapter is poor, a warn finding, with every command a timeout', async () => {
    const r = await checkAdapter.run(
      {},
      ctxWith(
        stubSession({
          adapterVersion: async () => {
            throw new Error('no ATI');
          },
          voltage: async () => null,
          request: async () => {
            throw new Error('timeout');
          },
        }),
      ),
    );
    expect(r.digest.split('\n')).toEqual([
      'Grade: poor',
      'Firmware: none reported',
      'Voltage: unreadable',
      'Protocol: ISO 15765-4 CAN (11-bit, 500 kbps)',
      'Latency: no answers',
      'Timeouts: 5/5',
    ]);
    expect(r.summary).toBe('Adapter: poor, no answers');
    expect(r.findings).toEqual([{ key: 'adapterHealth:agent.finding.poor', severity: 'warn' }]);
  });

  it('is always offered and declares its label, cost and no arguments', () => {
    expect(
      checkAdapter.available({
        profile: getVehicleProfile('passat-b55-19tdi'),
        protocol: 'ISO_14230_4_KWP_FAST',
        supportedPids: [],
        canMonitor: false,
      }),
    ).toBe(true);
    expect(checkAdapter.labelKey).toBe('adapterHealth:agent.tool.check_adapter');
    expect(checkAdapter.costMs).toBe(5000);
    expect(checkAdapter.args).toEqual({ type: 'object', properties: {} });
  });

  it('the adapter_health procedure runs check_adapter with no arguments', async () => {
    const proc = adapterTools.procedures?.find((p) => p.id === 'adapter_health');
    expect(proc?.costMs).toBe(5000);
    const callTool = jest.fn().mockResolvedValue({ digest: 'd', summary: 's' });
    const ctx = {
      ...ctxWith(stubSession({})),
      callTool,
      runProcedure: jest.fn(),
    } as ProcedureContext;
    await expect(proc!.run(ctx)).resolves.toEqual({ digest: 'd', summary: 's' });
    expect(callTool).toHaveBeenCalledWith('check_adapter', {});
  });

  it('bundles an adapter_health skill that parses and registers', () => {
    expect(parseSkillFile(adapterHealthSkill).ok).toBe(true);
    const skill = adapterTools.skills?.find((s) => s.name === 'adapter_health');
    expect(skill).toMatchObject({
      kind: 'capability',
      tools: ['check_adapter'],
      procedure: 'adapter_health',
    });
    expect(skill?.requires).toBeUndefined();
    expect(() => buildAgentRegistry([adapterTools])).not.toThrow();
  });

  it('the tool label and every grade finding have en and ro text', () => {
    for (const locale of [en, ro]) {
      expect(locale.agent.tool.check_adapter).toBeTruthy();
      for (const grade of ['good', 'ok', 'poor'] as const) {
        expect(locale.agent.finding[grade].title).toBeTruthy();
        expect(locale.agent.finding[grade].detail).toBeTruthy();
      }
    }
  });
});
