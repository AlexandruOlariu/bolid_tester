/** The store's persist layer pulls in expo-file-system (ESM, untransformed in the node test env),
 *  so mock it to a no-op file system (same idiom as scanHistoryStore.test.ts). */
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: '/tmp/bolid-test/',
  cacheDirectory: '/tmp/bolid-test/',
  getInfoAsync: jest.fn(async () => ({ exists: false })),
  readAsStringAsync: jest.fn(async () => ''),
  writeAsStringAsync: jest.fn(async () => undefined),
  deleteAsync: jest.fn(async () => undefined),
}));

import { DiagnosticSession } from '@/shared/obd-core/session/DiagnosticSession';
import { MockTransport } from '@/shared/obd-core/transport/MockTransport';
import { buildScenario } from '@/shared/obd-core/transport/scenarios';
import {
  Elm327ClosedError,
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
  ReadOnlySession,
  ToolContext,
} from '@/shared/obd-core';
import { getVehicleProfile } from '@/shared/vehicles';
import type { DiagModule, VehicleProfile } from '@/shared/vehicles';
import { golfPlus2009 } from '@/shared/vehicles/golf-plus-2009-20tdi';
import { useScanHistoryStore, type SavedScan } from '../model/scanHistoryStore';
import { agentTools } from './agentTools';

/** Every command the simulated adapter received, so a test can assert what was (not) sent. */
interface GolfCtx extends ToolContext {
  sent: string[];
}

async function ctxFor(profile: VehicleProfile, scenarioProfileId = golfPlus2009.id) {
  // Only modules with simulator seeds answer; one without any stays silent (NO DATA).
  const seeded = (profile.modules ?? []).filter(
    (m) => m.transport === 'uds' && m.reqHeader && (m.sampleDtcs || m.sampleIdent),
  );
  const scenario = buildScenario(scenarioProfileId, {
    moduleDtcs: Object.fromEntries(
      seeded.map((m) => [m.reqHeader as string, [...(m.sampleDtcs ?? [])]]),
    ),
    moduleIdent: Object.fromEntries(
      seeded.map((m) => [m.reqHeader as string, { ...(m.sampleIdent ?? {}) }]),
    ),
  });
  const mock = new MockTransport(scenario);
  const sent: string[] = [];
  const write = mock.write.bind(mock);
  mock.write = async (bytes: Uint8Array) => {
    sent.push(new TextDecoder().decode(bytes).trim());
    return write(bytes);
  };
  const session = new DiagnosticSession(mock, {
    commandTimeoutMs: 1000,
    firstCommandTimeoutMs: 1000,
  });
  await session.connect();
  const ctx: GolfCtx = {
    session: createReadOnlySession(session),
    profile,
    guideProfileId: profile.id,
    vehicle: { label: profile.name, make: profile.make },
    vin: null,
    now: () => 0,
    sleep: async () => undefined,
    signal: new AbortController().signal,
    askDriver: async () => ({ kind: 'done' }),
    sent,
  };
  return ctx;
}

const golfCtx = () => ctxFor(golfPlus2009);

/** A CAN car with 20 UDS modules (never 15 / 25), each holding 5 confirmed codes. */
function ctxWith20ModulesEach5Dtcs() {
  const modules: DiagModule[] = Array.from({ length: 20 }, (_, i) => {
    const n = i + 0x30;
    return {
      address: n.toString(16).toUpperCase(),
      name: `Module ${i + 1}`,
      transport: 'uds',
      reqHeader: `6${n.toString(16).toUpperCase()}`,
      experimental: true,
      sampleIdent: { F187: `1K0907${String(i).padStart(3, '0')}`, F189: '0100' },
      sampleDtcs: Array.from({ length: 5 }, (_, j) => ({
        bytes: [0x01, 0x00 + j, 0x00] as [number, number, number],
        status: 0x09,
      })),
    };
  });
  return ctxFor({ ...golfPlus2009, modules });
}

function toolOf(c: AgentContribution, name: string): AgentTool {
  const t = c.tools?.find((x) => x.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return t;
}

function availability(
  profileId: string,
  profile = getVehicleProfile(profileId),
): AvailabilityContext {
  return {
    profile,
    protocol:
      profile.expectedProtocol === 'AUTO' ? 'ISO_15765_4_CAN_11_500' : profile.expectedProtocol,
    supportedPids: [],
    canMonitor: false,
  };
}

/** A saved scan of `vehicleId` taken at noon (local) on `day`, with two TP2.0 modules. */
function savedScanWithTp20(day: string, vehicleId = golfPlus2009.id): SavedScan {
  return {
    id: `scan-${day}-${vehicleId}`,
    ts: new Date(`${day}T12:00:00`).getTime(),
    vehicle: { id: vehicleId, label: 'Car', vin: null },
    protocol: 'ISO 15765-4 CAN (11-bit, 500 kbps)',
    modules: [],
    tp20: {
      installed: [0x19, 0x46],
      modules: [
        { address: 0x19, name: 'CAN gateway', state: 'ok', ident: '7N0909901 Gateway', dtcs: [] },
        {
          address: 0x46,
          name: 'Central conv.',
          state: 'ok',
          dtcs: [
            { vag: '00928', status: 0x22 },
            { vag: '01330', status: 0x08 },
          ],
        },
        { address: 0x15, name: 'Airbag', state: 'ok', dtcs: [{ vag: '01217', status: 0x23 }] },
      ],
    },
  };
}

beforeEach(() => useScanHistoryStore.setState({ scans: [] }));

describe('module-scan agent tools', () => {
  it('scans the Golf UDS modules and lists their codes', async () => {
    const r = await toolOf(agentTools, 'scan_modules').run({}, await golfCtx());
    // The Golf profile names its engine module "Engine (EDC17)"; the line is "<addr> <name>: …".
    expect(r.digest).toMatch(/^01 Engine \(EDC17\): part 03L906022LM sw 4023; 3 DTCs: /m);
    expect(r.digest).toMatch(/^01 .*P2183 status 0x09, P2015 status 0x0C, P0121 status 0x04$/m);
    expect(r.digest).toMatch(
      /^03 ABS\/ESP \(MK60\): part 1K0907379AC; 1 DTCs: C0130 status 0x88 \(unconfirmed\)$/m,
    );
    expect(r.digest).toMatch(/^17 Instrument cluster: part 5M0920861B; 0 DTCs \(unconfirmed\)$/m);
    expect(r.findings?.length).toBe(2);
    expect(r.findings?.every((f) => f.key === 'moduleScan:agent.finding.moduleDtcs')).toBe(true);
    expect(r.findings?.[0]).toEqual({
      key: 'moduleScan:agent.finding.moduleDtcs',
      severity: 'warn',
      values: { module: '01 Engine (EDC17)', count: 3 },
      codes: ['P2183', 'P2015', 'P0121'],
      unconfirmed: false,
    });
    expect(r.findings?.[1]).toMatchObject({ codes: ['C0130'], unconfirmed: true });
    expect(r.status ?? 'ok').toBe('ok');
    expect(r.summary).toMatch(/3 modules.*4 DTCs/);
  });

  it('Stop between modules ends the scan at once', async () => {
    const ctx = await golfCtx();
    const controller = new AbortController();
    const withModule = ctx.session.withModule;
    let blocks = 0;
    const session: ReadOnlySession = {
      ...ctx.session,
      withModule: async (addr, fn) => {
        blocks++;
        const r = await withModule(addr, fn);
        controller.abort();
        return r;
      },
    };
    const r = await toolOf(agentTools, 'scan_modules').run(
      {},
      { ...ctx, session, signal: controller.signal },
    );
    expect(blocks).toBe(1);
    expect(r.digest).toMatch(/Stopped: \d+ modules not scanned\./);
  });

  it('starts with the counts, so a clamped digest still carries them', async () => {
    const r = await toolOf(agentTools, 'scan_modules').run({}, await golfCtx());
    expect(r.digest.split('\n')[0]).toBe(
      'UDS modules: 3 scanned, 3 answered, 0 silent, 0 skipped; 4 DTCs in 2 modules.',
    );
  });

  it('scans only the requested addresses', async () => {
    const ctx = await golfCtx();
    const r = await toolOf(agentTools, 'scan_modules').run({ addresses: ['03'] }, ctx);
    expect(r.digest).toMatch(/^03 ABS\/ESP/m);
    expect(r.digest).not.toMatch(/^01 /m);
    expect(ctx.sent).toContain('ATSH760');
    expect(ctx.sent).not.toContain('ATSH7E0');
  });

  it('a module that does not answer is "no answer", not an error', async () => {
    const silent: DiagModule = {
      address: '44',
      name: 'Steering assist',
      transport: 'uds',
      reqHeader: '712',
      experimental: true,
    };
    const ctx = await ctxFor({ ...golfPlus2009, modules: [silent] });
    // No ident or DTC store on 712: every read gets NO DATA, as from a real silent module.
    const r = await toolOf(agentTools, 'scan_modules').run({}, ctx);
    expect(r.digest).toMatch(/^44 Steering assist: no answer \(unconfirmed\)$/m);
    expect(r.findings ?? []).toEqual([]);
  });

  it('a closed link ends the scan instead of reading as a failed module', async () => {
    const ctx = await golfCtx();
    ctx.session.withModule = async () => {
      throw new Elm327ClosedError();
    };
    await expect(toolOf(agentTools, 'scan_modules').run({}, ctx)).rejects.toBeInstanceOf(
      Elm327ClosedError,
    );
  });

  it('a requested address the car does not list says so', async () => {
    const r = await toolOf(agentTools, 'scan_modules').run({ addresses: ['52'] }, await golfCtx());
    expect(r.digest).toContain("52: not in this car's module list");
  });

  it('skips airbag and immobilizer and never addresses them', async () => {
    const ctx = await golfCtx();
    const r = await toolOf(agentTools, 'scan_modules').run({ addresses: ['15', '25'] }, ctx);
    expect(r.digest).toContain('15 ');
    expect(r.digest).toContain("skipped (outside the agent's scope)");
    expect(r.digest).toContain("15 Airbag: skipped (outside the agent's scope)");
    expect(r.digest).toContain("25 Immobilizer: skipped (outside the agent's scope)");
    expect(ctx.sent).not.toContain('ATSH715');
    expect(ctx.sent).not.toContain('ATSH711');
  });

  it('a profile that lists the airbag module still never addresses it', async () => {
    const airbag: DiagModule = {
      address: '15',
      name: 'Airbag',
      transport: 'uds',
      reqHeader: '715',
      rxFilter: '77F',
      experimental: true,
    };
    const ctx = await ctxFor({ ...golfPlus2009, modules: [...golfPlus2009.modules!, airbag] });
    const r = await toolOf(agentTools, 'scan_modules').run({}, ctx);
    expect(r.digest).toContain("15 Airbag: skipped (outside the agent's scope)");
    expect(ctx.sent).not.toContain('ATSH715');
  });

  it('is not offered on the K-line Passat', () =>
    expect(toolOf(agentTools, 'scan_modules').available(availability('passat-b55-19tdi'))).toBe(
      false,
    ));

  it('is offered on the CAN Golf, not on a CAN car whose modules are all TP2.0', () => {
    const tool = toolOf(agentTools, 'scan_modules');
    expect(tool.available(availability(golfPlus2009.id))).toBe(true);
    const tp20Only = {
      ...golfPlus2009,
      modules: golfPlus2009.modules!.filter((m) => m.transport === 'tp20'),
    };
    expect(tool.available(availability(golfPlus2009.id, tp20Only))).toBe(false);
  });

  it('TP2.0 rows come only from a saved scan, with its date', async () => {
    expect((await toolOf(agentTools, 'scan_modules').run({}, await golfCtx())).digest).toContain(
      'TP2.0 modules: not read by the agent; open Module scan to read them.',
    );
    useScanHistoryStore.setState({ scans: [savedScanWithTp20('2026-11-20')] });
    const r = await toolOf(agentTools, 'scan_modules').run({}, await golfCtx());
    expect(r.digest).toContain('TP2.0 modules (saved scan 2026-11-20)');
    expect(r.digest).toContain('19 CAN gateway: ok, 0 DTCs');
    expect(r.digest).toContain(
      '46 Central conv.: ok, 2 DTCs (00928 status 0x22, 01330 status 0x08)',
    );
    // Saved airbag / immobilizer rows stay outside the agent's scope too.
    expect(r.digest).not.toContain('01217');
  });

  it('TP2.0 rows ignore saved scans of another car and use the newest of this car', async () => {
    useScanHistoryStore.setState({
      scans: [
        savedScanWithTp20('2026-11-21', 'user:other-car'),
        savedScanWithTp20('2026-11-19'),
        savedScanWithTp20('2026-11-10'),
      ],
    });
    const r = await toolOf(agentTools, 'scan_modules').run({}, await golfCtx());
    expect(r.digest).toContain('TP2.0 modules (saved scan 2026-11-19)');
  });

  it('clamps a long scan and says how many lines were cut', async () => {
    const r = await toolOf(agentTools, 'scan_modules').run({}, await ctxWith20ModulesEach5Dtcs());
    expect(r.digest.length).toBeLessThanOrEqual(MAX_DIGEST_CHARS);
    expect(r.digest).toMatch(/… \(\d+ more\)$/);
    expect(r.digest.split('\n')[0]).toContain('20 scanned');
    expect(r.findings?.length).toBe(20);
  });

  it('declares its arguments, cost, label and triage', () => {
    const t = toolOf(agentTools, 'scan_modules');
    expect(t.labelKey).toBe('moduleScan:agent.tool.scan_modules');
    expect(t.triage).toEqual({ args: {} });
    expect(t.costMs).toBe(30_000);
    expect(t.args.properties.addresses).toMatchObject({
      type: 'array',
      items: { type: 'string', pattern: '^[0-9A-F]{2}$' },
      maxItems: 12,
    });
  });

  it('the module_scan procedure runs scan_modules with no arguments', async () => {
    const proc = agentTools.procedures?.find((p) => p.id === 'module_scan');
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
    expect(callTool).toHaveBeenCalledWith('scan_modules', {});
  });

  it('bundles a module_scan skill that parses and registers', () => {
    const skill = agentTools.skills?.find((s) => s.name === 'module_scan');
    expect(parseSkillFile(skill).ok).toBe(true);
    expect(skill).toMatchObject({
      kind: 'capability',
      procedure: 'module_scan',
      requires: { protocol: 'can' },
    });
    expect(skill?.tools).toContain('scan_modules');
    expect(() => buildAgentRegistry([agentTools])).not.toThrow();
  });
});
