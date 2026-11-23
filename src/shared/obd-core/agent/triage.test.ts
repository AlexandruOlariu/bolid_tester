import { DiagnosticSession } from '../session/DiagnosticSession';
import { MockTransport } from '../transport/MockTransport';
import { buildScenario } from '../transport/scenarios';
import type { SimScenario } from '../transport/MockTransport';
import { Elm327ClosedError } from '../elm327/Elm327Client';
import { KEY_DIAGNOSTIC_PIDS, summarizeSnapshot } from '../analysis/aiDiagnosis';
import { golfPlus2009 } from '../../vehicles/golf-plus-2009-20tdi';
import { createReadOnlySession } from './readOnlySession';
import { CORE_AGENT_CONTRIBUTION } from './coreTools';
import { buildAgentRegistry } from './registry';
import { TRIAGE_DIGEST_CHARS, TRIAGE_SNAPSHOT_CHARS, runTriage, triageDigest } from './triage';
import { MAX_DIGEST_CHARS } from './digest';
import type { AgentTool, SkillFinding, ToolContext, ToolResult } from './types';

/** A Golf simulator behind the read-only facade, with a fake clock that `sleep` advances. */
async function golfCtx(over: Partial<SimScenario> = {}): Promise<ToolContext> {
  const mock = new MockTransport(buildScenario('golf-plus-2009-20tdi', over));
  const session = new DiagnosticSession(mock, {
    commandTimeoutMs: 1000,
    firstCommandTimeoutMs: 1000,
  });
  await session.connect();
  let t = 0;
  return {
    session: createReadOnlySession(session),
    profile: golfPlus2009,
    guideProfileId: golfPlus2009.id,
    vehicle: { label: golfPlus2009.name, make: golfPlus2009.make },
    vin: 'WVWZZZ1KZ9W903398',
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
    signal: new AbortController().signal,
    askDriver: async () => ({ kind: 'done' }),
  };
}

const golfCtxWith = (stored: string[]) =>
  golfCtx({ storedDtcs: stored, pendingDtcs: [], permanentDtcs: [] });

function fakeTool(
  name: string,
  opts: {
    triage?: { args: Record<string, unknown> };
    digest?: string;
    available?: boolean;
    findings?: SkillFinding[];
    run?: AgentTool['run'];
  } = {},
): AgentTool {
  return {
    name,
    description: `Fake ${name}.`,
    labelKey: `aiDiagnose:agent.tool.${name}`,
    args: { type: 'object', properties: {} },
    costMs: 1000,
    triage: opts.triage,
    available: () => opts.available ?? true,
    run:
      opts.run ??
      (async (): Promise<ToolResult> => ({
        digest: opts.digest ?? name,
        summary: name,
        findings: opts.findings,
      })),
  };
}

let ctx: ToolContext;
beforeEach(async () => {
  ctx = await golfCtx();
});

it('triage on the Golf with P0401 is step 1 and lists the code', async () => {
  const t = await runTriage(
    await golfCtxWith(['P0401']),
    buildAgentRegistry([CORE_AGENT_CONTRIBUTION]),
    () => [],
  );
  expect(t.snapshot.dtcs.stored.map((d) => d.code)).toEqual(['P0401']);
  expect(t.step).toMatchObject({ id: 1, kind: 'triage', status: 'ok' });
  expect(t.step.digest).toContain('Stored DTCs (1): P0401');
  expect(t.step.label).toEqual({
    key: 'aiDiagnose:agent.step.triage',
    values: { count: 1, volts: '12.3' },
  });
});

it('triage runs registered triage tools and includes their digests', async () => {
  const reg = buildAgentRegistry([
    CORE_AGENT_CONTRIBUTION,
    { tools: [fakeTool('recent', { triage: { args: {} }, digest: 'R1' })] },
  ]);
  expect((await runTriage(ctx, reg, () => [])).step.digest).toContain('## recent\nR1');
});

it('builds the same snapshot as the classic read pass', async () => {
  const c = await golfCtxWith(['P0401']);
  const asked: string[][] = [];
  const t = await runTriage(c, buildAgentRegistry([CORE_AGENT_CONTRIBUTION]), (codes) => {
    asked.push(codes);
    return [{ code: 'P0401', note: 'Check the EGR valve.' }];
  });
  const s = t.snapshot;
  expect(s.protocol).toBe('ISO_15765_4_CAN_11_500');
  expect(s.vin).toBe('WVWZZZ1KZ9W903398');
  expect(s.voltage).toBe(12.3);
  expect(s.supportedPidCount).toBe(c.session.supportedPids.length);
  expect(s.readiness?.milOn).toBe(true);
  expect(s.freezeFrame?.triggerDtc).toBe('P0401');
  const supported = new Set(c.session.effectivePids());
  expect(s.live.map((v) => v.pid).sort()).toEqual(
    KEY_DIAGNOSTIC_PIDS.filter((p) => supported.has(p)).sort(),
  );
  expect(s.vehicle).toEqual(c.vehicle);
  expect(asked).toEqual([['P0401']]);
  expect(s.guides).toEqual([{ code: 'P0401', note: 'Check the EGR valve.' }]);
  expect(t.step.digest).toBe(summarizeSnapshot(s));
  expect(t.step.summary).toBe('Triage: 1 codes, battery 12.3 V');
  expect(t.step.findings).toEqual([]);
});

it('skips the freeze frame and guides when no code is stored', async () => {
  const t = await runTriage(await golfCtxWith([]), buildAgentRegistry([]), () => []);
  expect(t.snapshot.freezeFrame).toBeNull();
  expect(t.snapshot.guides).toBeUndefined();
  expect(t.step.label.values).toEqual({ count: 0, volts: '12.3' });
});

it('counts a code once across stored, pending and permanent', async () => {
  const c = await golfCtx({ storedDtcs: ['P0401'], pendingDtcs: ['P0401', 'P0101'] });
  const t = await runTriage(c, buildAgentRegistry([]), () => []);
  expect(t.step.label.values).toEqual({ count: 2, volts: '12.3' });
});

it('runs only available triage tools, with their triage args, and keeps their findings', async () => {
  const seen: Record<string, unknown>[] = [];
  const finding: SkillFinding = { key: 'k', severity: 'warn' };
  const reg = buildAgentRegistry([
    CORE_AGENT_CONTRIBUTION,
    {
      tools: [
        fakeTool('recent', {
          triage: { args: { days: 7 } },
          run: async (args) => {
            seen.push(args);
            return { digest: 'R1', summary: 'r', findings: [finding] };
          },
        }),
        fakeTool('hidden', { triage: { args: {} }, available: false, digest: 'H1' }),
        fakeTool('plain', { digest: 'P1' }),
      ],
    },
  ]);
  const t = await runTriage(ctx, reg, () => []);
  expect(seen).toEqual([{ days: 7 }]);
  expect(t.step.findings).toEqual([finding]);
  expect(t.step.digest).not.toContain('## hidden');
  expect(t.step.digest).not.toContain('## plain');
});

it('records a failing triage tool and goes on, but a closed link ends the triage', async () => {
  const failing = fakeTool('recent', {
    triage: { args: {} },
    run: async () => {
      throw new Error('bad read');
    },
  });
  const t = await runTriage(ctx, buildAgentRegistry([{ tools: [failing] }]), () => []);
  expect(t.step.digest).toContain('## recent\nRead failed: bad read');
  expect(t.step.status).toBe('ok');

  const closed = fakeTool('recent', {
    triage: { args: {} },
    run: async () => {
      throw new Elm327ClosedError();
    },
  });
  await expect(
    runTriage(ctx, buildAgentRegistry([{ tools: [closed] }]), () => []),
  ).rejects.toBeInstanceOf(Elm327ClosedError);
});

it('clamps the triage digest', async () => {
  const big = fakeTool('big', { triage: { args: {} }, digest: 'z\n'.repeat(3000) });
  const t = await runTriage(ctx, buildAgentRegistry([{ tools: [big] }]), () => []);
  expect(TRIAGE_DIGEST_CHARS).toBe(4800);
  expect(t.step.digest.length).toBeLessThanOrEqual(TRIAGE_DIGEST_CHARS);
  expect(t.step.digest).toMatch(/… \(\d+ more\)$/);
});

it('gives each part of the triage digest its own budget: the last tool section is not lost', () => {
  const snapshot = Array.from({ length: 200 }, (_, i) => `snapshot line ${i}`).join('\n');
  const sectionOf = (name: string, last: string) =>
    `## ${name}\n${Array.from({ length: 100 }, (_, i) => `${name} line ${i}`).join('\n')}\n${last}`;
  const d = triageDigest(snapshot, [
    sectionOf('first', 'first end'),
    sectionOf('second', 'second end'),
    sectionOf('third', 'third end'),
  ]);
  expect(d.length).toBeLessThanOrEqual(TRIAGE_DIGEST_CHARS);
  expect(d.indexOf('\n## first')).toBeLessThanOrEqual(TRIAGE_SNAPSHOT_CHARS + 2);
  for (const name of ['first', 'second', 'third']) expect(d).toContain(`## ${name}\n`);
  expect(d).toMatch(/second line \d+\n… \(\d+ more\)\n\n## third/);
});

it('two triage tool sections at their full 1600-character cap fit whole', () => {
  const full = (name: string) => `## ${name}\n${'x'.repeat(MAX_DIGEST_CHARS - 10)}\nEND ${name}`;
  const d = triageDigest('s'.repeat(5000), [full('scan_modules'), full('read_history')]);
  expect(d).toContain('END scan_modules');
  expect(d).toContain('END read_history');
});
