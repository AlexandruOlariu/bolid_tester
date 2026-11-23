import { DiagnosticSession } from '@/shared/obd-core/session/DiagnosticSession';
import { MockTransport } from '@/shared/obd-core/transport/MockTransport';
import type { SimScenario } from '@/shared/obd-core/transport/MockTransport';
import { buildScenario } from '@/shared/obd-core/transport/scenarios';
import {
  MAX_DIGEST_CHARS,
  buildAgentRegistry,
  createReadOnlySession,
  parseSkillFile,
} from '@/shared/obd-core';
import type {
  AgentContribution,
  AgentTool,
  AvailabilityContext,
  ProcedureContext,
  ProtocolId,
  ToolContext,
} from '@/shared/obd-core';
import { getVehicleProfile } from '@/shared/vehicles';
import type { ExtendedPid, VehicleProfile } from '@/shared/vehicles';
import { golfPlus2009 } from '@/shared/vehicles/golf-plus-2009-20tdi';
import en from '@/shared/i18n/locales/en/dpf.json';
import ro from '@/shared/i18n/locales/ro/dpf.json';
import { agentTools as dpfTools } from './agentTools';
import dpfSkill from './dpf.skill.json';

async function ctxFor(
  profile: VehicleProfile = golfPlus2009,
  scenario: Partial<SimScenario> = {},
): Promise<ToolContext> {
  const session = new DiagnosticSession(new MockTransport(buildScenario(profile.id, scenario)), {
    commandTimeoutMs: 1000,
    firstCommandTimeoutMs: 1000,
  });
  await session.connect();
  return {
    session: createReadOnlySession(session),
    profile,
    guideProfileId: profile.id,
    vehicle: { label: profile.name, make: profile.make },
    vin: null,
    now: () => 0,
    sleep: async () => undefined,
    signal: new AbortController().signal,
    askDriver: async () => ({ kind: 'done' }),
  };
}

const golfCtx = () => ctxFor();

/** The Golf's DIDs as the simulator serves them, with `did` answering `bytes` instead (null: the
 *  DID gives no answer). */
function golfDidsWith(did: string, bytes: number[] | null): Partial<SimScenario> {
  const dids: Record<string, number[]> = Object.fromEntries(
    (golfPlus2009.extendedPids ?? []).map((e) => [e.did, e.sampleResponse]),
  );
  if (bytes) dids[did] = bytes;
  else delete dids[did];
  return { extendedDids: dids };
}

/** The Golf with the given DIDs carrying confirmation evidence. */
function golfConfirming(dids: string[]): VehicleProfile {
  const extendedPids: ExtendedPid[] = (golfPlus2009.extendedPids ?? []).map((p) =>
    dids.includes(p.did) ? { ...p, confirmed: { on: '2026-11-20', source: 'on-car' } } : p,
  );
  return { ...golfPlus2009, extendedPids };
}

function toolOf(c: AgentContribution, name: string): AgentTool {
  const t = c.tools?.find((x) => x.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return t;
}

function availability(profile: VehicleProfile, protocol?: ProtocolId): AvailabilityContext {
  return {
    profile,
    protocol:
      protocol ??
      (profile.expectedProtocol === 'AUTO' ? 'ISO_15765_4_CAN_11_500' : profile.expectedProtocol),
    supportedPids: [],
    canMonitor: false,
  };
}

const readDpfWith = async (did: string, bytes: number[] | null) =>
  toolOf(dpfTools, 'read_dpf').run({}, await ctxFor(golfPlus2009, golfDidsWith(did, bytes)));

describe('dpf agent tools', () => {
  it('read_dpf labels unverified values and flags the finding', async () => {
    const r = await toolOf(dpfTools, 'read_dpf').run({}, await golfCtx());
    expect(r.digest).toContain('(unconfirmed)');
    expect(r.findings?.[0].unconfirmed).toBe(true);
  });

  it('digests every DPF figure, numeric and unit-labelled, with the status', async () => {
    const r = await toolOf(dpfTools, 'read_dpf').run({}, await golfCtx());
    const lines = r.digest.split('\n');
    expect(lines[0]).toBe('DPF status: filling (soot 55 %)');
    expect(lines).toEqual(
      expect.arrayContaining([
        'Soot load: 55 % (unconfirmed)',
        'Soot mass: 12 g (unconfirmed)',
        'Ash: 18 g (unconfirmed)',
        'Distance since regen: 300 km (unconfirmed)',
        'Regenerations: 312 (unconfirmed)',
        'EGT: 250 °C (unconfirmed)',
        '1707 Oil temperature: 90 °C (unconfirmed)',
        '1708 EGR valve position: 25 % (unconfirmed)',
      ]),
    );
    expect(r.digest.length).toBeLessThanOrEqual(MAX_DIGEST_CHARS);
    expect(r.findings).toEqual([
      {
        key: 'dpf:agent.finding.filling',
        severity: 'info',
        values: { pct: 55 },
        unconfirmed: true,
      },
    ]);
    expect(r.unconfirmed).toBe(true);
    expect(r.summary).toMatch(/DPF: filling/);
  });

  it('an alarming unconfirmed soot load stays flagged unconfirmed', async () => {
    // 0xF5 = 96 %: "high" is a warn, but the DID is unverified, so the finding is flagged and the
    // 34a loop caps it at info.
    const r = await readDpfWith('1702', [0xf5]);
    expect(r.digest).toContain('DPF status: high (soot 96 %)');
    expect(r.digest).toContain('Soot load: 96 % (unconfirmed)');
    expect(r.findings?.[0]).toMatchObject({
      key: 'dpf:agent.finding.high',
      severity: 'warn',
      unconfirmed: true,
    });
  });

  it.each([
    [[0x26], 'ok', 'ok'], // 15 %
    [[0x8c], 'filling', 'info'], // 55 %
    [[0xc0], 'regen-due', 'warn'], // 75 %
    [[0xf5], 'high', 'warn'], // 96 %
  ])('soot byte %j gives a %s finding with severity %s', async (bytes, status, severity) => {
    const r = await readDpfWith('1702', bytes);
    expect(r.findings?.[0]).toMatchObject({ key: `dpf:agent.finding.${status}`, severity });
  });

  it('a hot exhaust reads as regenerating (info); no soot reading is unknown (info)', async () => {
    const hot = await readDpfWith('1706', [0x17, 0x70]); // 600 °C
    expect(hot.findings?.[0]).toMatchObject({
      key: 'dpf:agent.finding.regenerating',
      severity: 'info',
    });
    const noSoot = await readDpfWith('1702', null);
    expect(noSoot.digest).toContain('Soot load: no answer');
    expect(noSoot.digest.split('\n')[0]).toBe('DPF status: unknown');
    expect(noSoot.findings?.[0]).toEqual({
      key: 'dpf:agent.finding.unknown',
      severity: 'info',
      unconfirmed: true,
    });
  });

  it('confirmed DIDs are not labelled; the finding is flagged only when a value it used is not', async () => {
    const allDpf = ['1701', '1702', '1703', '1704', '1705', '1706'];
    const confirmed = await toolOf(dpfTools, 'read_dpf').run(
      {},
      await ctxFor(golfConfirming(allDpf)),
    );
    expect(confirmed.digest).toMatch(/^Soot load: 55 %$/m);
    // The diesel extras (oil, EGR) are still unverified but do not feed the assessment.
    expect(confirmed.digest).toContain('1707 Oil temperature: 90 °C (unconfirmed)');
    expect(confirmed.findings?.[0].unconfirmed).toBe(false);
    expect(confirmed.unconfirmed).toBeUndefined();
    const oneLeft = await toolOf(dpfTools, 'read_dpf').run(
      {},
      await ctxFor(golfConfirming(allDpf.slice(1))),
    );
    expect(oneLeft.digest).toContain('Soot mass: 12 g (unconfirmed)');
    expect(oneLeft.findings?.[0].unconfirmed).toBe(true);
  });

  it('a confirmed extra next to unverified soot leaves the step unconfirmed (34a caps it)', async () => {
    // Oil temperature (1707) confirmed, every assessment input still unverified.
    const r = await toolOf(dpfTools, 'read_dpf').run(
      {},
      await ctxFor(golfConfirming(['1707']), golfDidsWith('1702', [0xf5])),
    );
    expect(r.digest).toMatch(/^1707 Oil temperature: 90 °C$/m);
    expect(r.findings?.[0].unconfirmed).toBe(true);
    expect(r.unconfirmed).toBe(true);
  });

  it('is offered on the diesel CAN Golf only', () => {
    const tool = toolOf(dpfTools, 'read_dpf');
    expect(tool.available(availability(golfPlus2009))).toBe(true);
    expect(tool.available(availability(getVehicleProfile('fiat-punto-2008-12')))).toBe(false);
    expect(tool.available(availability(getVehicleProfile('passat-b55-19tdi')))).toBe(false);
    expect(tool.available(availability(golfPlus2009, 'ISO_14230_4_KWP_FAST'))).toBe(false);
    expect(tool.available(availability({ ...golfPlus2009, fuel: 'petrol' }))).toBe(false);
  });

  it('on a car where it does not apply it says so in one line', async () => {
    const r = await toolOf(dpfTools, 'read_dpf').run(
      {},
      await ctxFor(getVehicleProfile('fiat-punto-2008-12')),
    );
    expect(r.digest.split('\n')).toHaveLength(1);
    expect(r.findings ?? []).toEqual([]);
  });

  it('declares its label, cost and no arguments', () => {
    const t = toolOf(dpfTools, 'read_dpf');
    expect(t.labelKey).toBe('dpf:agent.tool.read_dpf');
    expect(t.costMs).toBe(4000);
    expect(t.args).toEqual({ type: 'object', properties: {} });
  });

  it('the dpf procedure runs read_dpf with no arguments', async () => {
    const proc = dpfTools.procedures?.find((p) => p.id === 'dpf');
    expect(proc).toBeDefined();
    const callTool = jest.fn().mockResolvedValue({ digest: 'd', summary: 's' });
    const ctx = {
      ...(await golfCtx()),
      callTool,
      runProcedure: jest.fn(),
      hasTool: () => false,
      hasSkill: () => false,
    } as ProcedureContext;
    await expect(proc!.run(ctx)).resolves.toEqual({ digest: 'd', summary: 's' });
    expect(callTool).toHaveBeenCalledWith('read_dpf', {});
  });

  it('bundles a dpf skill that parses and registers', () => {
    expect(parseSkillFile(dpfSkill).ok).toBe(true);
    const skill = dpfTools.skills?.find((s) => s.name === 'dpf');
    expect(skill).toMatchObject({
      kind: 'capability',
      tools: ['read_dpf'],
      procedure: 'dpf',
      requires: { fuel: ['diesel'], protocol: 'can', profile: ['extendedPids'] },
    });
    expect(skill?.interpret.join(' ')).toMatch(/15–20 min above 60 km\/h/);
    expect(() => buildAgentRegistry([dpfTools])).not.toThrow();
  });

  it('the tool label and every finding have en and ro text', () => {
    const statuses = ['ok', 'filling', 'regenerating', 'regen-due', 'high', 'unknown'] as const;
    for (const locale of [en, ro]) {
      expect(locale.agent.tool.read_dpf).toBeTruthy();
      for (const status of statuses) {
        expect(locale.agent.finding[status].title).toBeTruthy();
        expect(locale.agent.finding[status].detail).toBeTruthy();
      }
    }
  });
});
