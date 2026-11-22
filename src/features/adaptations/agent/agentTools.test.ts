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
  ProtocolId,
  ToolContext,
} from '@/shared/obd-core';
import { bytesToString } from '@/shared/lib/bytes';
import { getVehicleProfile } from '@/shared/vehicles';
import type { AdaptationChannel, VehicleProfile } from '@/shared/vehicles';
import en from '@/shared/i18n/locales/en/adaptations.json';
import ro from '@/shared/i18n/locales/ro/adaptations.json';
import { MAX_ADAPTATION_CHANNELS, agentTools as adaptationsTools } from './agentTools';
import adaptationsReadSkill from './adaptations_read.skill.json';

const golf = getVehicleProfile('golf-plus-2009-20tdi');
const passat = getVehicleProfile('passat-b55-19tdi');

/** A tool context over the simulated car, plus every command sent after connect. */
async function ctxFor(
  profile: VehicleProfile,
  scenario: Partial<SimScenario> = {},
): Promise<{ ctx: ToolContext; sent: string[]; abort: AbortController }> {
  const mock = new MockTransport(buildScenario(profile.id, scenario));
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
  const abort = new AbortController();
  return {
    sent,
    abort,
    ctx: {
      session: createReadOnlySession(session),
      profile,
      guideProfileId: profile.id,
      vehicle: { label: profile.name, make: profile.make },
      vin: null,
      now: () => 0,
      sleep: async () => undefined,
      signal: abort.signal,
      askDriver: async () => ({ kind: 'done' }),
    },
  };
}

function toolOf(c: AgentContribution, name: string): AgentTool {
  const t = c.tools?.find((x) => x.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return t;
}

const readAdaptations = toolOf(adaptationsTools, 'read_adaptations');

function availability(profile: VehicleProfile, protocol: ProtocolId): AvailabilityContext {
  return { profile, protocol, supportedPids: [], canMonitor: false };
}

const WRITE_OR_SESSION = /^(10|2B|2E|3B|27|31|2F|04|14)/i;

describe('adaptations agent tools', () => {
  it('reads the Passat KWP channel with no session change, login or write, labelled unconfirmed', async () => {
    const { ctx, sent } = await ctxFor(passat);
    const r = await readAdaptations.run({}, ctx);
    expect(r.digest.split('\n')).toEqual([
      'Adaptation channels read: 1, answered: 1.',
      'Idle speed adaptation (Engine ECU (KWP2000)): 850 rpm raw 55 (unconfirmed)',
    ]);
    expect(r.unconfirmed).toBe(true);
    expect(r.summary).toBe('Adaptations: 1/1 channels answered');
    expect(sent.filter((c) => WRITE_OR_SESSION.test(c))).toEqual([]);
  });

  it('reads the Golf UDS channels, decoded with unit and raw hex', async () => {
    const { ctx, sent } = await ctxFor(golf);
    const r = await readAdaptations.run({}, ctx);
    expect(r.digest.split('\n')).toEqual([
      'Adaptation channels read: 2, answered: 2.',
      'Idle speed offset (Engine (EDC17)): 850 rpm raw 03 52 (unconfirmed)',
      'EGR base duty (Engine (EDC17)): 50 % raw 64 (unconfirmed)',
    ]);
    expect(sent.filter((c) => WRITE_OR_SESSION.test(c))).toEqual([]);
  });

  it('a KWP channel that needs the adaptation session says to open Adaptations', async () => {
    const { ctx } = await ctxFor(passat, { kwpLocals: {} });
    const r = await readAdaptations.run({}, ctx);
    expect(r.digest).toContain(
      'Idle speed adaptation (Engine ECU (KWP2000)): not readable without the adaptation session; open Adaptations',
    );
    expect(r.unconfirmed).toBeUndefined();
  });

  it('a confirmed channel is not labelled and does not mark the step', async () => {
    const confirmed: VehicleProfile = {
      ...passat,
      adaptations: (passat.adaptations ?? []).map((c) => ({
        ...c,
        confirmed: { on: '2026-11-20', source: 'vcds-log' as const },
      })),
    };
    const r = await readAdaptations.run({}, (await ctxFor(confirmed)).ctx);
    expect(r.digest).toMatch(/^Idle speed adaptation \(Engine ECU \(KWP2000\)\): 850 rpm raw 55$/m);
    expect(r.unconfirmed).toBeUndefined();
  });

  it('skips a channel on the immobilizer (25) without any traffic to it', async () => {
    const immo: VehicleProfile = {
      ...passat,
      adaptations: (passat.adaptations ?? []).map((c) => ({ ...c, address: '25' })),
    };
    const { ctx, sent } = await ctxFor(immo);
    const r = await readAdaptations.run({}, ctx);
    expect(r.digest).toContain(
      "Idle speed adaptation (Engine ECU (KWP2000)): skipped (outside the agent's scope)",
    );
    expect(sent).toEqual([]);
  });

  it('reads at most 10 channels, says how many were left, and stays clamped', async () => {
    const base = (golf.adaptations ?? [])[0];
    const many: AdaptationChannel[] = Array.from({ length: 14 }, (_, i) => ({
      ...base,
      name: `Channel ${i + 1} with a fairly long descriptive name`,
    }));
    const r = await readAdaptations.run({}, (await ctxFor({ ...golf, adaptations: many })).ctx);
    const lines = r.digest.split('\n');
    expect(lines[0]).toBe(`Adaptation channels read: ${MAX_ADAPTATION_CHANNELS}, answered: 10.`);
    expect(lines[lines.length - 1]).toBe('Channels not read: 4.');
    expect(r.digest.length).toBeLessThanOrEqual(MAX_DIGEST_CHARS);
  });

  it('stops between channels when the run is stopped', async () => {
    const { ctx, abort } = await ctxFor(golf);
    abort.abort();
    const r = await readAdaptations.run({}, ctx);
    expect(r.digest.split('\n')[0]).toBe('Adaptation channels read: 0, answered: 0.');
  });

  it('on a car or link with no channels it says so in one line', async () => {
    const r = await readAdaptations.run(
      {},
      (await ctxFor(getVehicleProfile('fiat-punto-2008-12'))).ctx,
    );
    expect(r.digest).toBe('No adaptation channels are declared for this car on this link.');
  });

  it('is offered only where a channel is reachable on the link', () => {
    expect(readAdaptations.available(availability(golf, 'ISO_15765_4_CAN_11_500'))).toBe(true);
    expect(readAdaptations.available(availability(golf, 'ISO_9141_2'))).toBe(false);
    expect(readAdaptations.available(availability(passat, 'ISO_9141_2'))).toBe(true);
    expect(readAdaptations.available(availability(passat, 'ISO_15765_4_CAN_11_500'))).toBe(false);
    expect(
      readAdaptations.available(
        availability(getVehicleProfile('fiat-punto-2008-12'), 'ISO_15765_4_CAN_11_500'),
      ),
    ).toBe(false);
  });

  it('declares its label, cost and no arguments', () => {
    expect(readAdaptations.labelKey).toBe('adaptations:agent.tool.read_adaptations');
    expect(readAdaptations.costMs).toBe(10_000);
    expect(readAdaptations.args).toEqual({ type: 'object', properties: {} });
  });

  it('bundles an adaptations_read skill that parses, registers and says it reads only', () => {
    expect(parseSkillFile(adaptationsReadSkill).ok).toBe(true);
    const skill = adaptationsTools.skills?.find((s) => s.name === 'adaptations_read');
    expect(skill).toMatchObject({
      kind: 'capability',
      tools: ['read_adaptations'],
      requires: { profile: ['adaptations'] },
    });
    expect(skill?.instructions.join(' ')).toContain(
      'This phase reads only; to change a value the owner uses the Adaptations / Coding screens.',
    );
    expect(() => buildAgentRegistry([adaptationsTools])).not.toThrow();
  });

  it('the tool label has en and ro text', () => {
    for (const locale of [en, ro]) expect(locale.agent.tool.read_adaptations).toBeTruthy();
  });
});
