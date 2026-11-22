import { DiagnosticSession } from '@/shared/obd-core/session/DiagnosticSession';
import { MockTransport } from '@/shared/obd-core/transport/MockTransport';
import { buildScenario } from '@/shared/obd-core/transport/scenarios';
import { createReadOnlySession, parseSkillFile } from '@/shared/obd-core';
import type {
  AgentContribution,
  AgentTool,
  AvailabilityContext,
  ReadOnlySession,
  ToolContext,
} from '@/shared/obd-core';
import { golfPlus2009 } from '@/shared/vehicles/golf-plus-2009-20tdi';
import { agentTools as snifferTools } from './agentTools';

function ctxWith(session: ReadOnlySession): ToolContext {
  return {
    session,
    profile: golfPlus2009,
    guideProfileId: golfPlus2009.id,
    vehicle: { label: golfPlus2009.name, make: golfPlus2009.make },
    vin: null,
    now: () => 0,
    sleep: async () => undefined,
    signal: new AbortController().signal,
    askDriver: async () => ({ kind: 'done' }),
  };
}

/** The Golf simulator behind the read-only facade. */
async function golfContext(): Promise<ToolContext> {
  const session = new DiagnosticSession(new MockTransport(buildScenario(golfPlus2009.id)), {
    commandTimeoutMs: 1000,
    firstCommandTimeoutMs: 1000,
  });
  await session.connect();
  return ctxWith(createReadOnlySession(session));
}

/** A facade whose `listenBus` returns `lines` (or rejects with `error`) and records the window. */
function stubCtx(lines: string[], error?: Error): ToolContext & { listenBus: jest.Mock } {
  const listenBus = jest.fn(async () => {
    if (error) throw error;
    return lines;
  });
  return { ...ctxWith({ listenBus } as unknown as ReadOnlySession), listenBus };
}

function toolOf(c: AgentContribution, name: string): AgentTool {
  const t = c.tools?.find((x) => x.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return t;
}

const availability = (over: Partial<AvailabilityContext> = {}): AvailabilityContext => ({
  profile: golfPlus2009,
  protocol: 'ISO_15765_4_CAN_11_500',
  supportedPids: [],
  canMonitor: true,
  ...over,
});

describe('can-sniffer agent tools', () => {
  it('listen_bus summarises ids', async () => {
    const golfCtx = await golfContext();
    expect((await toolOf(snifferTools, 'listen_bus').run({ seconds: 2 }, golfCtx)).digest).toMatch(
      /distinct ids: \d+/,
    );
  });

  it('counts frames per id, top ids first, with frames per second', async () => {
    const lines = [
      ...Array.from({ length: 6 }, () => '7E8 04 41 0C 0C D0'),
      ...Array.from({ length: 3 }, () => '7E0 02 01 0C'),
      '200 01 C0 00 10 00 03 01',
      'BUFFER FULL',
    ];
    const ctx = stubCtx(lines);
    const r = await toolOf(snifferTools, 'listen_bus').run({ seconds: 2 }, ctx);
    expect(ctx.listenBus).toHaveBeenCalledWith(2000);
    const out = r.digest.split('\n');
    expect(out[0]).toBe('Listened 2 s (passive monitor): 10 frames, distinct ids: 3.');
    expect(out[1]).toBe('Top ids by count:');
    expect(out[2]).toBe('7E8: 6 frames, 3.0 frames/s');
    expect(out[3]).toBe('7E0: 3 frames, 1.5 frames/s');
    expect(out[4]).toBe('200: 1 frame, 0.5 frames/s');
    expect(r.digest).toContain('Unparsed lines: 1.');
    expect(r.summary).toBe('Bus 2 s: 10 frames, 3 ids');
  });

  it('lists the top 10 ids only and says how many more', async () => {
    const lines = Array.from({ length: 14 }, (_, i) =>
      Array.from({ length: 14 - i }, () => `${(0x100 + i).toString(16).toUpperCase()} 00`),
    ).flat();
    const r = await toolOf(snifferTools, 'listen_bus').run({ seconds: 5 }, stubCtx(lines));
    expect(r.digest).toContain('distinct ids: 14');
    expect(r.digest).toContain('100: 14 frames');
    expect(r.digest).toContain('109: 5 frames');
    expect(r.digest).not.toContain('10A:');
    expect(r.digest).toContain('… (4 more ids)');
  });

  it('defaults to 5 s and clamps the window to 1-10 s', async () => {
    const tool = toolOf(snifferTools, 'listen_bus');
    const ctx = stubCtx([]);
    await tool.run({}, ctx);
    await tool.run({ seconds: 60 }, ctx);
    await tool.run({ seconds: 0 }, ctx);
    expect(ctx.listenBus.mock.calls.map((c) => c[0])).toEqual([5000, 10_000, 1000]);
  });

  it('says so in one line when nothing was heard', async () => {
    const r = await toolOf(snifferTools, 'listen_bus').run({ seconds: 3 }, stubCtx([]));
    expect(r.digest).toBe('No frames heard in 3 s.');
  });

  it('reports a refused listen as an error step', async () => {
    const r = await toolOf(snifferTools, 'listen_bus').run(
      { seconds: 3 },
      stubCtx([], new Error('Bus listening needs a CAN car.')),
    );
    expect(r.status).toBe('error');
    expect(r.digest).toBe('Bus listening needs a CAN car.');
  });

  it('is offered only on a CAN car over a link that can stream the monitor', () => {
    const tool = toolOf(snifferTools, 'listen_bus');
    expect(tool.available(availability())).toBe(true);
    expect(tool.available(availability({ canMonitor: false }))).toBe(false);
    expect(tool.available(availability({ protocol: 'ISO_9141_2' }))).toBe(false);
  });

  it('declares its arguments, cost and label', () => {
    const t = toolOf(snifferTools, 'listen_bus');
    expect(t.labelKey).toBe('canSniffer:agent.tool.listen_bus');
    expect(t.costMs).toBe(11_000);
    expect(t.args).toEqual({
      type: 'object',
      properties: {
        seconds: expect.objectContaining({ type: 'integer', minimum: 1, maximum: 10 }),
      },
    });
  });

  it('bundles the bus_listen capability skill over listen_bus, CAN only', () => {
    for (const s of snifferTools.skills ?? []) expect(parseSkillFile(s).ok).toBe(true);
    expect(snifferTools.skills?.find((s) => s.name === 'bus_listen')).toMatchObject({
      kind: 'capability',
      tools: ['listen_bus'],
      requires: { protocol: 'can' },
    });
  });
});
