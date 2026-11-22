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
import type { CodingModule, VehicleProfile } from '@/shared/vehicles';
import en from '@/shared/i18n/locales/en/coding.json';
import ro from '@/shared/i18n/locales/ro/coding.json';
import { MAX_CODING_FIELDS, agentTools as codingTools } from './agentTools';
import codingReadSkill from './coding_read.skill.json';

const golf = getVehicleProfile('golf-plus-2009-20tdi');
const bcm = golf.codingModules![0];

/** A tool context over the simulated car, plus every command sent after connect. */
async function ctxFor(
  profile: VehicleProfile,
  scenario: Partial<SimScenario> = {},
): Promise<{ ctx: ToolContext; sent: string[] }> {
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
  return {
    sent,
    ctx: {
      session: createReadOnlySession(session),
      profile,
      guideProfileId: profile.id,
      vehicle: { label: profile.name, make: profile.make },
      vin: null,
      now: () => 0,
      sleep: async () => undefined,
      signal: new AbortController().signal,
      askDriver: async () => ({ kind: 'done' }),
    },
  };
}

function toolOf(c: AgentContribution, name: string): AgentTool {
  const t = c.tools?.find((x) => x.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return t;
}

const readCoding = toolOf(codingTools, 'read_coding');

function availability(profile: VehicleProfile, protocol: ProtocolId): AvailabilityContext {
  return { profile, protocol, supportedPids: [], canMonitor: false };
}

describe('coding agent tools', () => {
  it('reads the Golf BCM coding: hex and decoded fields, labelled unconfirmed, nothing written', async () => {
    const { ctx, sent } = await ctxFor(golf);
    const r = await readCoding.run({}, ctx);
    expect(r.digest.split('\n')).toEqual([
      'Coding modules read: 1, answered: 1.',
      'Central electrics (BCM): coding 01 00 10 00',
      '- Daytime running lights: on (unconfirmed)',
      '- Coming-home lights: off (unconfirmed)',
      '- Needle sweep on start: off (unconfirmed)',
      '- One-touch turn signal blinks: 0 (unconfirmed)',
      '- Leaving-home lights: off (unconfirmed)',
      '- Coming/leaving-home via light switch: off (unconfirmed)',
      '- Gong with key-in-ignition: off (unconfirmed)',
      '- Footwell lighting: off (unconfirmed)',
    ]);
    expect(r.unconfirmed).toBe(true);
    expect(r.summary).toBe('Coding: 1/1 modules answered');
    expect(sent.filter((c) => /^(10|2E|27|31|3B|2B)/i.test(c))).toEqual([]);
  });

  it('lists at most 12 fields per module and counts the rest', async () => {
    const wide: CodingModule = {
      ...bcm,
      partNumber: undefined,
      schema: Array.from({ length: 16 }, (_, i) => ({
        byte: Math.floor(i / 8),
        bit: i % 8,
        name: `Bit ${i}`,
      })),
    };
    const r = await readCoding.run({}, (await ctxFor({ ...golf, codingModules: [wide] })).ctx);
    const fieldLines = r.digest.split('\n').filter((l) => /^- Bit /.test(l));
    expect(fieldLines).toHaveLength(MAX_CODING_FIELDS);
    expect(r.digest.split('\n').pop()).toBe('- … (4 more fields)');
    expect(r.digest.length).toBeLessThanOrEqual(MAX_DIGEST_CHARS);
  });

  it('a confirmed module is not labelled and does not mark the step', async () => {
    const confirmed: CodingModule = { ...bcm, confirmed: { on: '2026-11-20', source: 'on-car' } };
    const r = await readCoding.run({}, (await ctxFor({ ...golf, codingModules: [confirmed] })).ctx);
    expect(r.digest).toContain('- Daytime running lights: on');
    expect(r.digest).not.toContain('unconfirmed');
    expect(r.unconfirmed).toBeUndefined();
  });

  it('a module that does not answer says so', async () => {
    const r = await readCoding.run({}, (await ctxFor(golf, { coding: {} })).ctx);
    expect(r.digest.split('\n')).toEqual([
      'Coding modules read: 1, answered: 0.',
      'Central electrics (BCM): no answer',
    ]);
    expect(r.unconfirmed).toBeUndefined();
  });

  it('on a car or link without codeable modules it says so in one line', async () => {
    const r = await readCoding.run({}, (await ctxFor(getVehicleProfile('passat-b55-19tdi'))).ctx);
    expect(r.digest).toBe('No codeable modules are declared for this car on this link.');
  });

  it('is offered on a CAN car with codeable modules only', () => {
    expect(readCoding.available(availability(golf, 'ISO_15765_4_CAN_11_500'))).toBe(true);
    expect(readCoding.available(availability(golf, 'ISO_14230_4_KWP_FAST'))).toBe(false);
    expect(
      readCoding.available(
        availability(getVehicleProfile('passat-b55-19tdi'), 'ISO_15765_4_CAN_11_500'),
      ),
    ).toBe(false);
  });

  it('declares its label, cost and no arguments', () => {
    expect(readCoding.labelKey).toBe('coding:agent.tool.read_coding');
    expect(readCoding.costMs).toBe(4000);
    expect(readCoding.args).toEqual({ type: 'object', properties: {} });
  });

  it('bundles a coding_read skill that parses, registers and says it reads only', () => {
    expect(parseSkillFile(codingReadSkill).ok).toBe(true);
    const skill = codingTools.skills?.find((s) => s.name === 'coding_read');
    expect(skill).toMatchObject({
      kind: 'capability',
      tools: ['read_coding'],
      requires: { protocol: 'can', profile: ['codingModules'] },
    });
    expect(skill?.instructions.join(' ')).toContain(
      'This phase reads only; to change a value the owner uses the Adaptations / Coding screens.',
    );
    expect(() => buildAgentRegistry([codingTools])).not.toThrow();
  });

  it('the tool label has en and ro text', () => {
    for (const locale of [en, ro]) expect(locale.agent.tool.read_coding).toBeTruthy();
  });
});
