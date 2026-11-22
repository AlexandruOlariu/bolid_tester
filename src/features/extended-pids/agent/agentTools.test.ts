import { DiagnosticSession } from '@/shared/obd-core/session/DiagnosticSession';
import { MockTransport } from '@/shared/obd-core/transport/MockTransport';
import { buildScenario } from '@/shared/obd-core/transport/scenarios';
import { buildAgentRegistry, createReadOnlySession, parseSkillFile } from '@/shared/obd-core';
import type {
  AgentContribution,
  AgentTool,
  AvailabilityContext,
  ProtocolId,
  ReadOnlySession,
  ToolContext,
} from '@/shared/obd-core';
import { getVehicleProfile } from '@/shared/vehicles';
import type { ExtendedPid, VehicleProfile } from '@/shared/vehicles';
import { golfPlus2009 } from '@/shared/vehicles/golf-plus-2009-20tdi';
import en from '@/shared/i18n/locales/en/extendedPids.json';
import ro from '@/shared/i18n/locales/ro/extendedPids.json';
import { agentTools as extTools } from './agentTools';
import extendedSkill from './extended_data.skill.json';

interface Ctx extends ToolContext {
  /** Every DID list the tool asked the facade to read. */
  polled: string[][];
}

async function ctxFor(profile: VehicleProfile = golfPlus2009): Promise<Ctx> {
  const session = new DiagnosticSession(new MockTransport(buildScenario(golfPlus2009.id)), {
    commandTimeoutMs: 1000,
    firstCommandTimeoutMs: 1000,
  });
  await session.connect();
  const ro = createReadOnlySession(session);
  const polled: string[][] = [];
  const wrapped: ReadOnlySession = {
    ...ro,
    pollExtendedOnce: async (dids) => {
      polled.push([...dids]);
      return ro.pollExtendedOnce(dids);
    },
  };
  return {
    session: wrapped,
    profile,
    guideProfileId: profile.id,
    vehicle: { label: profile.name, make: profile.make },
    vin: null,
    now: () => 0,
    sleep: async () => undefined,
    signal: new AbortController().signal,
    askDriver: async () => ({ kind: 'done' }),
    polled,
  };
}

const golfCtx = () => ctxFor();

/** The Golf with `n` extra declared DIDs after its own eight (NO DATA in the simulator). */
function golfWithExtraDids(n: number): VehicleProfile {
  const extra: ExtendedPid[] = Array.from({ length: n }, (_, i) => ({
    did: `18${String(i).padStart(2, '0')}`,
    name: `Extra ${i}`,
    unit: 'V',
    experimental: true,
    sampleResponse: [],
    decode: (d) => d[0],
  }));
  return { ...golfPlus2009, extendedPids: [...(golfPlus2009.extendedPids ?? []), ...extra] };
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

const didLines = (digest: string) => digest.split('\n').filter((l) => /^[0-9A-F]{4} /.test(l));

describe('extended-pids agent tools', () => {
  it('read_extended reads the first 8 declared DIDs by default', async () => {
    const r = await toolOf(extTools, 'read_extended').run({}, await golfCtx());
    expect(r.digest.split('\n').filter((l) => /^[0-9A-F]{4} /.test(l)).length).toBeLessThanOrEqual(
      8,
    );
  });

  it('only the first 8 of a longer list are read', async () => {
    const ctx = await ctxFor(golfWithExtraDids(4));
    const r = await toolOf(extTools, 'read_extended').run({}, ctx);
    expect(didLines(r.digest)).toHaveLength(8);
    expect(ctx.polled.flat()).toEqual([
      '1701',
      '1702',
      '1703',
      '1704',
      '1705',
      '1706',
      '1707',
      '1708',
    ]);
  });

  it('digests "<did> <name>: <value> <unit>" with unverified values marked', async () => {
    const r = await toolOf(extTools, 'read_extended').run({}, await golfCtx());
    expect(didLines(r.digest)).toEqual([
      '1701 DPF soot mass (calc.): 12 g (unconfirmed)',
      '1702 DPF soot load: 55 % (unconfirmed)',
      '1703 DPF ash load: 18 g (unconfirmed)',
      '1704 Distance since regen: 300 km (unconfirmed)',
      '1705 Successful regenerations: 312 (unconfirmed)',
      '1706 Exhaust gas temp (DPF): 250 °C (unconfirmed)',
      '1707 Oil temperature: 90 °C (unconfirmed)',
      '1708 EGR valve position: 25 % (unconfirmed)',
    ]);
    expect(r.unconfirmed).toBe(true);
    expect(r.status ?? 'ok').toBe('ok');
  });

  it('reads only the requested DIDs; an undeclared one is named, never sent', async () => {
    const ctx = await golfCtx();
    const r = await toolOf(extTools, 'read_extended').run({ dids: ['1702', 'F190'] }, ctx);
    expect(didLines(r.digest)).toEqual(['1702 DPF soot load: 55 % (unconfirmed)']);
    expect(r.digest).toContain('F190: not declared for this car');
    expect(ctx.polled.flat()).toEqual(['1702']);
  });

  it('a DID with no answer says so; a confirmed DID is not labelled', async () => {
    const base = golfWithExtraDids(1);
    const profile: VehicleProfile = {
      ...base,
      extendedPids: base.extendedPids!.map((p) =>
        p.did === '1707' ? { ...p, confirmed: { on: '2026-11-20', source: 'on-car' } } : p,
      ),
    };
    const r = await toolOf(extTools, 'read_extended').run(
      { dids: ['1707', '1800'] },
      await ctxFor(profile),
    );
    expect(didLines(r.digest)).toEqual(['1707 Oil temperature: 90 °C', '1800 Extra 0: no answer']);
    // Not every value read is unverified, so the result as a whole is not flagged.
    expect(r.unconfirmed).toBeUndefined();
  });

  it('is offered on CAN with declared DIDs only', () => {
    const tool = toolOf(extTools, 'read_extended');
    expect(tool.available(availability(golfPlus2009))).toBe(true);
    expect(tool.available(availability(golfPlus2009, 'ISO_14230_4_KWP_FAST'))).toBe(false);
    expect(tool.available(availability(getVehicleProfile('fiat-punto-2008-12')))).toBe(false);
    expect(tool.available(availability(getVehicleProfile('passat-b55-19tdi')))).toBe(false);
  });

  it('declares its arguments, cost and label', () => {
    const t = toolOf(extTools, 'read_extended');
    expect(t.labelKey).toBe('extendedPids:agent.tool.read_extended');
    expect(t.costMs).toBe(4000);
    expect(t.args.properties.dids).toMatchObject({
      type: 'array',
      items: { type: 'string', pattern: '^[0-9A-F]{4}$' },
      maxItems: 8,
    });
  });

  it('bundles an extended_data skill that parses and registers', () => {
    expect(parseSkillFile(extendedSkill).ok).toBe(true);
    expect(buildAgentRegistry([extTools]).skills.get('extended_data')).toMatchObject({
      kind: 'capability',
      tools: ['read_extended'],
      requires: { protocol: 'can', profile: ['extendedPids'] },
    });
  });

  it('the tool label has en and ro text', () => {
    expect(en.agent.tool.read_extended).toBeTruthy();
    expect(ro.agent.tool.read_extended).toBeTruthy();
  });
});
