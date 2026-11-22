import { DiagnosticSession } from '@/shared/obd-core/session/DiagnosticSession';
import { MockTransport } from '@/shared/obd-core/transport/MockTransport';
import { buildScenario } from '@/shared/obd-core/transport/scenarios';
import { vagCodeForDtc } from '@/shared/obd-core/obd/dtc';
import { createReadOnlySession, parseSkillFile } from '@/shared/obd-core';
import type { AgentContribution, AgentTool, ToolContext } from '@/shared/obd-core';
import { GENERIC_GUIDE } from '@/shared/vehicles/faultGuides';
import { golfPlus2009 } from '@/shared/vehicles/golf-plus-2009-20tdi';
import { agentTools } from './agentTools';

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

  it('bundles the fault_codes capability skill over read_dtcs and read_dtcs_detail', () => {
    const skill = agentTools.skills?.find((s) => s.name === 'fault_codes');
    expect(skill).toMatchObject({ kind: 'capability', tools: ['read_dtcs', 'read_dtcs_detail'] });
    const interpret = skill?.interpret.join(' ') ?? '';
    for (const word of ['Stored', 'Pending', 'Permanent', 'Readiness', 'MIL'])
      expect(interpret).toContain(word);
  });
});
