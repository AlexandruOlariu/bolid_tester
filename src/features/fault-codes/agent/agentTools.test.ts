import { DiagnosticSession } from '@/shared/obd-core/session/DiagnosticSession';
import { MockTransport } from '@/shared/obd-core/transport/MockTransport';
import { buildScenario } from '@/shared/obd-core/transport/scenarios';
import { vagCodeForDtc } from '@/shared/obd-core/obd/dtc';
import { createReadOnlySession, parseSkillFile } from '@/shared/obd-core';
import type { AgentContribution, AgentTool, ToolContext } from '@/shared/obd-core';
import { GENERIC_GUIDE } from '@/shared/vehicles/faultGuides';
import { golfPlus2009 } from '@/shared/vehicles/golf-plus-2009-20tdi';
import { passatB55 } from '@/shared/vehicles/passat-b55-19tdi';
import { agentTools } from './agentTools';

const faultTools = agentTools;

/** The Golf simulator with no codes: `lookup_guide` needs only the profile. */
const golfCtx_ = () => golfCtx([]);

/** A Golf simulator behind the read-only facade with exactly these stored codes (no pending /
 *  permanent unless given); `freezeFrameReads` counts the Mode 02 frame reads. */
async function golfCtx(
  stored: string[],
  extra: { pending?: string[]; permanent?: string[] } = {},
): Promise<ToolContext & { freezeFrameReads: jest.SpyInstance }> {
  const mock = new MockTransport(
    buildScenario(golfPlus2009.id, {
      storedDtcs: stored,
      pendingDtcs: extra.pending ?? [],
      permanentDtcs: extra.permanent ?? [],
    }),
  );
  const session = new DiagnosticSession(mock, {
    commandTimeoutMs: 1000,
    firstCommandTimeoutMs: 1000,
  });
  await session.connect();
  const freezeFrameReads = jest.spyOn(session, 'readFreezeFrameAt');
  return {
    session: createReadOnlySession(session),
    profile: golfPlus2009,
    guideProfileId: golfPlus2009.id,
    vehicle: { label: golfPlus2009.name, make: golfPlus2009.make },
    vin: null,
    now: () => 0,
    sleep: async () => undefined,
    signal: new AbortController().signal,
    askDriver: async () => ({ kind: 'done' }),
    freezeFrameReads,
  };
}

function toolOf(c: AgentContribution, name: string): AgentTool {
  const t = c.tools?.find((x) => x.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return t;
}

describe('fault-codes agent tools', () => {
  it('read_dtcs_detail gives the description, VAG number, status and guide note', async () => {
    const r = await toolOf(agentTools, 'read_dtcs_detail').run(
      { code: 'P0401' },
      await golfCtx(['P0401']),
    );
    expect(r.digest).toContain(`VAG ${vagCodeForDtc('P0401')}`);
    expect(r.digest).toContain('Stored now: yes');
    expect(r.digest).toContain('EGR flow/position fault');
  });

  it('describes the code make-aware, with its system line, pending and permanent status', async () => {
    const r = await toolOf(agentTools, 'read_dtcs_detail').run(
      { code: 'P0401' },
      await golfCtx(['P0401']),
    );
    expect(r.digest.split('\n')[0]).toMatch(/^P0401 \(VAG \d{5}\) — \S/);
    expect(r.digest).toContain('System: Powertrain · ');
    expect(r.digest).toContain('Pending now: no');
    expect(r.digest).toContain('Permanent now: no');
    expect(r.status ?? 'ok').toBe('ok');
  });

  it('adds the freeze frame the code triggered', async () => {
    const r = await toolOf(agentTools, 'read_dtcs_detail').run(
      { code: 'P0401' },
      await golfCtx(['P0300', 'P0401']),
    );
    expect(r.digest).toMatch(/Freeze frame \(when P0401 set\): .*Engine RPM \d+ rpm/);
  });

  it('a code the car does not report now: not stored, no freeze frame read, no generic guide', async () => {
    const ctx = await golfCtx([], { pending: ['P0300'] });
    const r = await toolOf(agentTools, 'read_dtcs_detail').run({ code: 'p0300' }, ctx);
    expect(r.digest).toContain('Stored now: no');
    expect(r.digest).toContain('Pending now: yes');
    expect(r.digest).not.toContain('Freeze frame');
    expect(r.digest).not.toContain(GENERIC_GUIDE.note);
    expect(ctx.freezeFrameReads).not.toHaveBeenCalled();
    expect(r.summary).toMatch(/^P0300.*pending/);
  });

  it('declares its arguments, cost and label', () => {
    const t = toolOf(agentTools, 'read_dtcs_detail');
    expect(t.labelKey).toBe('faultCodes:agent.tool.read_dtcs_detail');
    expect(t.costMs).toBe(2000);
    expect(t.args).toEqual({
      type: 'object',
      properties: {
        code: expect.objectContaining({ type: 'string', pattern: '^[PCBU][0-3][0-9A-F]{3}$' }),
      },
      required: ['code'],
    });
  });

  it('every bundled skill file parses', () => {
    for (const s of agentTools.skills ?? []) expect(parseSkillFile(s).ok).toBe(true);
  });

  it('bundles the fault_codes capability skill over read_dtcs, read_dtcs_detail and lookup_guide', () => {
    const skill = agentTools.skills?.find((s) => s.name === 'fault_codes');
    expect(skill).toMatchObject({
      kind: 'capability',
      tools: ['read_dtcs', 'read_dtcs_detail', 'lookup_guide'],
    });
    expect(skill?.instructions.join(' ')).toContain('lookup_guide');
    const interpret = skill?.interpret.join(' ') ?? '';
    for (const word of ['Stored', 'Pending', 'Permanent', 'Readiness', 'MIL'])
      expect(interpret).toContain(word);
  });

  it('lookup_guide finds the Golf EGR guide by code and by topic', async () => {
    const golfCtx = await golfCtx_();
    expect(
      (await toolOf(faultTools, 'lookup_guide').run({ code: 'P0401' }, golfCtx)).digest,
    ).toContain('EGR flow/position fault');
    expect(
      (await toolOf(faultTools, 'lookup_guide').run({ topic: 'egr' }, golfCtx)).digest,
    ).toContain('EGR');
    expect((await toolOf(faultTools, 'lookup_guide').run({}, golfCtx)).digest).toBe(
      'Give a code or a topic.',
    );
  });

  it('lookup_guide gives the related DIDs and the routine with their names', async () => {
    const r = await toolOf(faultTools, 'lookup_guide').run({ code: 'p0401' }, await golfCtx_());
    const lines = r.digest.split('\n');
    expect(lines[0]).toMatch(/^Guide for P0401 on this car: EGR flow\/position fault\./);
    expect(r.digest).toContain('Related DIDs: 1708 EGR valve position.');
    expect(r.digest).toMatch(/Routine: 0130 EGR valve output test \(/);
    expect(r.summary).toBe('Guide for P0401: found');
  });

  it('lookup_guide leaves out the DIDs and routine a note-only guide does not have', async () => {
    const r = await toolOf(faultTools, 'lookup_guide').run({ code: 'P2183' }, await golfCtx_());
    expect(r.digest).toContain('coolant temperature sensor 2');
    expect(r.digest).not.toContain('Related DIDs');
    expect(r.digest).not.toContain('Routine');
  });

  it('lookup_guide says when there is no curated guide', async () => {
    const tool = toolOf(faultTools, 'lookup_guide');
    const golf = await golfCtx_();
    expect((await tool.run({ code: 'P0123' }, golf)).digest).toBe(
      'No curated guide for P0123 on this car.',
    );
    expect((await tool.run({ topic: 'sunroof' }, golf)).digest).toBe(
      'No curated guide for sunroof on this car.',
    );
    const passat: ToolContext = { ...golf, profile: passatB55, guideProfileId: passatB55.id };
    expect((await tool.run({ code: 'P0401' }, passat)).digest).toBe(
      'No curated guide for P0401 on this car.',
    );
    expect((await tool.run({ code: 'P0123' }, golf)).summary).toBe('Guide for P0123: none');
  });

  it('lookup_guide by topic lists every matching guide with its codes', async () => {
    const r = await toolOf(faultTools, 'lookup_guide').run(
      { topic: 'intake flap' },
      await golfCtx_(),
    );
    expect(r.digest.split('\n')[0]).toBe('Guides for "intake flap" on this car: 2');
    expect(r.digest).toContain('Codes P0299, P0234, P0238, P2263: Boost-pressure fault');
    expect(r.digest).toContain('Codes P2015, 08213: Intake manifold runner/flap');
    expect(r.summary).toBe('Guides for "intake flap": 2');
  });

  it('lookup_guide declares optional code and topic arguments, its cost and label', () => {
    const t = toolOf(faultTools, 'lookup_guide');
    expect(t.labelKey).toBe('faultCodes:agent.tool.lookup_guide');
    expect(t.costMs).toBe(0);
    expect(t.available({} as never)).toBe(true);
    expect(t.args).toEqual({
      type: 'object',
      properties: {
        code: expect.objectContaining({ type: 'string', pattern: '^[PCBU][0-3][0-9A-F]{3}$' }),
        topic: expect.objectContaining({ type: 'string' }),
      },
    });
  });
});
