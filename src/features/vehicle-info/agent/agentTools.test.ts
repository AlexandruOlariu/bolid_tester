import { DiagnosticSession } from '@/shared/obd-core/session/DiagnosticSession';
import { MockTransport } from '@/shared/obd-core/transport/MockTransport';
import type { SimScenario } from '@/shared/obd-core/transport/MockTransport';
import { buildScenario } from '@/shared/obd-core/transport/scenarios';
import { buildAgentRegistry, createReadOnlySession, parseSkillFile } from '@/shared/obd-core';
import type { AgentContribution, AgentTool, ToolContext } from '@/shared/obd-core';
import { bytesToString } from '@/shared/lib/bytes';
import { getVehicleProfile } from '@/shared/vehicles';
import type { VehicleProfile } from '@/shared/vehicles';
import en from '@/shared/i18n/locales/en/vehicleInfo.json';
import ro from '@/shared/i18n/locales/ro/vehicleInfo.json';
import { agentTools as infoTools } from './agentTools';
import vehicleIdentitySkill from './vehicle_identity.skill.json';

const golf = getVehicleProfile('golf-plus-2009-20tdi');
const passat = getVehicleProfile('passat-b55-19tdi');

/** A tool context over the simulated car, plus every command sent after connect. */
async function ctxFor(
  profile: VehicleProfile = golf,
  scenario: Partial<SimScenario> = {},
  vin: string | null = null,
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
      vin,
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

const readIdentity = toolOf(infoTools, 'read_identity');

describe('vehicle-info agent tools', () => {
  it('read_identity decodes the Golf VIN', async () => {
    const { ctx: golfCtx } = await ctxFor();
    const r = await toolOf(infoTools, 'read_identity').run({}, golfCtx);
    expect(r.digest).toContain('WVWZZZ1KZ9W903398');
    expect(r.digest).toMatch(/check digit valid: (yes|no)/);
  });

  it('lists VIN, decoded make / year / plant, check digit, ECU identity and protocol', async () => {
    const { ctx, sent } = await ctxFor();
    const r = await readIdentity.run({}, ctx);
    expect(r.digest.split('\n')).toEqual([
      'VIN: WVWZZZ1KZ9W903398',
      'Make: Volkswagen (Germany)',
      'Model year: 2009 (from char 10; often not encoded outside North America)',
      'Plant code: W',
      'VIN check digit valid: no (not required outside North America)',
      'Calibration ID: 03L906022LM',
      'ECU part number: 03L906022LM',
      'Protocol: ISO 15765-4 CAN (11-bit, 500 kbps)',
    ]);
    expect(r.summary).toBe('Identity: Volkswagen 2009, WVWZZZ1KZ9W903398');
    expect(r.findings).toBeUndefined();
    expect(sent).toEqual(expect.arrayContaining(['0902', '0904']));
    expect(sent.filter((c) => /^(04|14|2E|2F|31|3B|27|10)/i.test(c))).toEqual([]);
  });

  it('uses the VIN the run already knows instead of reading it again', async () => {
    const { ctx, sent } = await ctxFor(golf, {}, '1HGCM82633A004352');
    const r = await readIdentity.run({}, ctx);
    expect(sent).not.toContain('0902');
    expect(r.digest).toContain('VIN: 1HGCM82633A004352');
    expect(r.digest).toContain('Make: Honda (United States)');
    expect(r.digest).toContain('Model year: 2003\n');
    expect(r.digest).toContain('VIN check digit valid: yes\n');
  });

  it('says so when the ECU does not report a VIN', async () => {
    const { ctx } = await ctxFor(golf, { vinSupported: false });
    const r = await readIdentity.run({}, ctx);
    expect(r.digest.split('\n')[0]).toBe('VIN: not reported by the ECU (common on older cars)');
    expect(r.digest).not.toContain('Make:');
    expect(r.digest).not.toContain('check digit');
    expect(r.summary).toBe('Identity: no VIN reported');
  });

  it('flags a VIN that is not a valid 17-character VIN and does not decode it', async () => {
    const { ctx } = await ctxFor(golf, {}, 'WVWZZZ1KZ9W90339');
    const r = await readIdentity.run({}, ctx);
    expect(r.digest.split('\n')[0]).toBe('VIN: WVWZZZ1KZ9W90339 (not a valid 17-character VIN)');
    expect(r.digest).not.toContain('Make:');
  });

  it('on a K-line car it reads no ECU part number', async () => {
    const { ctx, sent } = await ctxFor(passat);
    const r = await readIdentity.run({}, ctx);
    expect(r.digest).toContain('VIN: WVWZZZ3BZ4E342958');
    expect(r.digest).toContain('Calibration ID: 038906019KC 4896');
    expect(r.digest).toContain('ECU part number: not read on this link (CAN only)');
    expect(r.digest).toContain('Protocol: ISO 9141-2 (K-line)');
    expect(sent.some((c) => c.startsWith('22'))).toBe(false);
  });

  it('is always offered and declares its label, cost and no arguments', () => {
    expect(
      readIdentity.available({
        profile: passat,
        protocol: 'ISO_14230_4_KWP_FAST',
        supportedPids: [],
        canMonitor: false,
      }),
    ).toBe(true);
    expect(readIdentity.labelKey).toBe('vehicleInfo:agent.tool.read_identity');
    expect(readIdentity.costMs).toBe(3000);
    expect(readIdentity.args).toEqual({ type: 'object', properties: {} });
  });

  it('bundles a vehicle_identity skill that parses and registers, without a procedure', () => {
    expect(parseSkillFile(vehicleIdentitySkill).ok).toBe(true);
    const skill = infoTools.skills?.find((s) => s.name === 'vehicle_identity');
    expect(skill).toMatchObject({ kind: 'capability', tools: ['read_identity'] });
    expect(skill?.procedure).toBeUndefined();
    expect(skill?.requires).toBeUndefined();
    expect(infoTools.procedures).toBeUndefined();
    expect(() => buildAgentRegistry([infoTools])).not.toThrow();
  });

  it('the tool label has en and ro text', () => {
    for (const locale of [en, ro]) expect(locale.agent.tool.read_identity).toBeTruthy();
  });
});
