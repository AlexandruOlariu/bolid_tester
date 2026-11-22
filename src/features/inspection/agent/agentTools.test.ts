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
  ProcedureContext,
  ToolContext,
} from '@/shared/obd-core';
import { bytesToString } from '@/shared/lib/bytes';
import { getVehicleProfile } from '@/shared/vehicles';
import type { VehicleProfile } from '@/shared/vehicles';
import en from '@/shared/i18n/locales/en/inspection.json';
import ro from '@/shared/i18n/locales/ro/inspection.json';
import { agentTools as inspectionTools } from './agentTools';
import usedCarCheckSkill from './used_car_check.skill.json';

const golf = getVehicleProfile('golf-plus-2009-20tdi');

/** A tool context over the simulated car, plus every command sent after connect. */
async function ctxFor(
  scenario: Partial<SimScenario> = {},
  vin: string | null = null,
  profile: VehicleProfile = golf,
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

const readInspection = toolOf(inspectionTools, 'read_inspection');
const NO_CODES: Partial<SimScenario> = { storedDtcs: [], pendingDtcs: [], permanentDtcs: [] };

describe('inspection agent tools', () => {
  it('reports the verdict, the score and every check as "status: label — detail"', async () => {
    const { ctx, sent } = await ctxFor();
    const r = await readInspection.run({}, ctx);
    expect(r.digest.split('\n')).toEqual([
      'Verdict: fail (score 40/100)',
      'fail: Check-engine light — MIL is ON — an emissions fault is currently stored.',
      'fail: Stored fault codes — 3 stored: P2183, P2015, P0121',
      'pass: Emissions readiness — All supported monitors complete.',
      'info: Freeze frame — A freeze frame is present — a fault was recorded at some point.',
      'pass: In-use counters (IUPR) — 1500 monitoring cycles / 1800 ignition cycles — consistent with a driven car.',
    ]);
    expect(r.summary).toBe('Used-car check: fail, score 40/100');
    expect(r.findings).toEqual([
      { key: 'inspection:agent.finding.fail', severity: 'warn', values: { score: 40 } },
    ]);
    expect(r.digest.length).toBeLessThanOrEqual(MAX_DIGEST_CHARS);
    expect(sent.filter((c) => /^(04|14|2E|2F|31|3B|27)/i.test(c))).toEqual([]);
  });

  it('maps a pass verdict to an ok finding and a caution verdict to info', async () => {
    const pass = await readInspection.run({}, (await ctxFor(NO_CODES)).ctx);
    expect(pass.digest.split('\n')[0]).toMatch(/^Verdict: pass /);
    expect(pass.findings?.[0]).toMatchObject({
      key: 'inspection:agent.finding.pass',
      severity: 'ok',
    });

    const caution = await readInspection.run(
      {},
      (await ctxFor({ ...NO_CODES, pendingDtcs: ['P0401'] })).ctx,
    );
    expect(caution.digest).toContain('warn: Pending codes — 1 pending (intermittent): P0401');
    expect(caution.findings?.[0]).toMatchObject({
      key: 'inspection:agent.finding.caution',
      severity: 'info',
    });
  });

  it('clamps a digest with many codes and counts the lines left out', async () => {
    const many = Array.from({ length: 150 }, (_, i) => `P${String(1000 + i)}`);
    const r = await readInspection.run(
      {},
      (await ctxFor({ storedDtcs: many, pendingDtcs: many, permanentDtcs: many })).ctx,
    );
    expect(r.digest.length).toBeLessThanOrEqual(MAX_DIGEST_CHARS);
    expect(r.digest.split('\n')[0]).toMatch(/^Verdict: fail /);
    expect(r.digest).toMatch(/\n… \(\d+ more\)$/);
  });

  it('uses the VIN the run already knows', async () => {
    const { ctx, sent } = await ctxFor({}, 'WVWZZZ1KZ9W903398');
    await readInspection.run({}, ctx);
    expect(sent).not.toContain('0902');
  });

  it('is always offered and declares its label, cost and no arguments', () => {
    expect(
      readInspection.available({
        profile: getVehicleProfile('passat-b55-19tdi'),
        protocol: 'ISO_14230_4_KWP_FAST',
        supportedPids: [],
        canMonitor: false,
      }),
    ).toBe(true);
    expect(readInspection.labelKey).toBe('inspection:agent.tool.read_inspection');
    expect(readInspection.costMs).toBe(6000);
    expect(readInspection.args).toEqual({ type: 'object', properties: {} });
  });

  it('the used_car_check procedure runs read_inspection with no arguments', async () => {
    const proc = inspectionTools.procedures?.find((p) => p.id === 'used_car_check');
    expect(proc?.costMs).toBe(6000);
    const callTool = jest.fn().mockResolvedValue({ digest: 'd', summary: 's' });
    const ctx = { ...(await ctxFor()).ctx, callTool, runProcedure: jest.fn() } as ProcedureContext;
    await expect(proc!.run(ctx)).resolves.toEqual({ digest: 'd', summary: 's' });
    expect(callTool).toHaveBeenCalledWith('read_inspection', {});
  });

  it('bundles a used_car_check skill that parses and registers', () => {
    expect(parseSkillFile(usedCarCheckSkill).ok).toBe(true);
    const skill = inspectionTools.skills?.find((s) => s.name === 'used_car_check');
    expect(skill).toMatchObject({
      kind: 'capability',
      tools: ['read_inspection'],
      procedure: 'used_car_check',
    });
    expect(skill?.requires).toBeUndefined();
    expect(() => buildAgentRegistry([inspectionTools])).not.toThrow();
  });

  it('the tool label and every verdict finding have en and ro text', () => {
    for (const locale of [en, ro]) {
      expect(locale.agent.tool.read_inspection).toBeTruthy();
      for (const verdict of ['pass', 'caution', 'fail'] as const) {
        expect(locale.agent.finding[verdict].title).toBeTruthy();
        expect(locale.agent.finding[verdict].detail).toBeTruthy();
      }
    }
  });
});
