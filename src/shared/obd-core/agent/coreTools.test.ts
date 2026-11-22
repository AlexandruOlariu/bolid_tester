import { DiagnosticSession } from '../session/DiagnosticSession';
import { MockTransport } from '../transport/MockTransport';
import { buildScenario } from '../transport/scenarios';
import type { SimScenario } from '../transport/MockTransport';
import { describeDtc, type Dtc } from '../obd/dtc';
import { golfPlus2009 } from '../../vehicles/golf-plus-2009-20tdi';
import { createReadOnlySession } from './readOnlySession';
import { CORE_AGENT_CONTRIBUTION, LIVE_SAMPLE_MS, readLiveCostMs } from './coreTools';
import { DRIVER_INSTRUCTIONS } from './driver';
import { MAX_DIGEST_CHARS, clampDigest, statsLine } from './digest';
import type { AgentTool, AvailabilityContext, DriverInstructionId, ToolContext } from './types';

/** A Golf simulator behind the read-only facade, with a fake clock that `sleep` advances. */
async function golfCtx(
  over: Partial<SimScenario> = {},
): Promise<ToolContext & { clock(): number }> {
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
    vin: null,
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
    signal: new AbortController().signal,
    askDriver: async () => ({ kind: 'done' }),
    clock: () => t,
  };
}

function tool(name: string): AgentTool {
  const t = CORE_AGENT_CONTRIBUTION.tools?.find((x) => x.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return t;
}

let ctx: ToolContext & { clock(): number };
beforeEach(async () => {
  ctx = await golfCtx();
});

describe('read_live', () => {
  it('read_live one-shot names the PID, value and unit', async () => {
    const r = await tool('read_live').run({ pids: ['010C', '0105'] }, ctx);
    expect(r.digest).toMatch(/010C Engine RPM: \d+ rpm/);
    expect(r.digest).toMatch(/0105 .*°C/);
  });

  it('read_live over seconds gives min / avg / max and sample count', async () => {
    const r = await tool('read_live').run({ pids: ['010B'], seconds: 2 }, ctx);
    expect(r.digest).toMatch(/min [\d.]+ \/ avg [\d.]+ \/ max [\d.]+ kPa \(n=4, 2 s\)/);
    // Polls at 0, 500, 1000 and 1500 ms: the last tick starts inside the 2 s window.
    expect(ctx.clock()).toBe(3 * LIVE_SAMPLE_MS);
  });

  it('read_live lists unsupported PIDs', async () =>
    expect((await tool('read_live').run({ pids: ['0106'] }, ctx)).digest).toContain(
      'Not supported on this car: 0106.',
    ));

  it('lists every unsupported PID and still reads the supported ones', async () => {
    const r = await tool('read_live').run({ pids: ['0106', '010C', '0107'] }, ctx);
    expect(r.digest).toContain('Not supported on this car: 0106, 0107.');
    expect(r.digest).toContain('010C Engine RPM: 820 rpm');
    expect(Object.keys(r.data as object)).toEqual(['010C']);
  });

  it('one-shot data has min = avg = max and n = 1, and does not wait', async () => {
    const r = await tool('read_live').run({ pids: ['010C'], seconds: 0 }, ctx);
    expect(r.data).toEqual({ '010C': { min: 820, avg: 820, max: 820, n: 1 } });
    expect(r.status ?? 'ok').toBe('ok');
    expect(ctx.clock()).toBe(0);
  });

  it('sampled data carries the stats per PID', async () => {
    const r = await tool('read_live').run({ pids: ['010B', '010C'], seconds: 1 }, ctx);
    expect(r.data).toEqual({
      '010B': { min: 100, avg: 100, max: 100, n: 2 },
      '010C': { min: 820, avg: 820, max: 820, n: 2 },
    });
    expect(r.summary).toContain('010B avg 100 kPa');
  });

  it('stops sampling when the run is stopped', async () => {
    const ac = new AbortController();
    let polls = 0;
    const session = {
      ...ctx.session,
      pollOnce: async (pids: string[]) => {
        polls += 1;
        if (polls === 2) ac.abort();
        return ctx.session.pollOnce(pids);
      },
    };
    const r = await tool('read_live').run(
      { pids: ['010C'], seconds: 15 },
      { ...ctx, session, signal: ac.signal },
    );
    expect(polls).toBe(2);
    expect((r.data as Record<string, { n: number }>)['010C'].n).toBe(2);
  });

  it('declares its arguments, cost and label and is always available', () => {
    const t = tool('read_live');
    expect(t.labelKey).toBe('aiDiagnose:agent.tool.read_live');
    expect(t.args.properties.pids).toMatchObject({
      type: 'array',
      maxItems: 8,
      items: { type: 'string', pattern: '^01[0-9A-F]{2}$' },
    });
    expect(t.args.properties.seconds).toMatchObject({ type: 'integer', minimum: 0, maximum: 15 });
    expect(t.args.required).toEqual(['pids']);
    expect(readLiveCostMs(0)).toBe(1000);
    expect(readLiveCostMs(10)).toBe(11_000);
    expect(t.costMs).toBe(readLiveCostMs(15));
    expect(t.available({} as AvailabilityContext)).toBe(true);
  });
});

describe('read_dtcs', () => {
  it('lists the stored, pending and permanent codes with MIL and monitors', async () => {
    const c = await golfCtx({ storedDtcs: ['P0401'], pendingDtcs: ['P0101'], permanentDtcs: [] });
    const r = await tool('read_dtcs').run({}, c);
    const data = r.data as { stored: Dtc[]; pending: Dtc[]; permanent: Dtc[] };
    expect(data.stored.map((d) => d.code)).toEqual(['P0401']);
    expect(data.pending.map((d) => d.code)).toEqual(['P0101']);
    expect(data.permanent).toEqual([]);
    expect(r.digest).toContain(`Stored DTCs (1): P0401 — ${describeDtc('P0401')}.`);
    expect(r.digest).toContain('Pending DTCs (1): P0101');
    expect(r.digest).toContain('Permanent DTCs: none.');
    expect(r.digest).toContain('MIL (check-engine light): ON');
    expect(r.digest).toMatch(/Readiness monitors: \d+\/\d+ complete\./);
    expect(r.summary).toBe('DTCs: 1 stored, 1 pending, 0 permanent; MIL on');
  });

  it('keeps a long code list within the digest limit', async () => {
    const many = Array.from({ length: 60 }, (_, i) => `P0${(100 + i).toString(16).toUpperCase()}`);
    const c = await golfCtx({ storedDtcs: many, pendingDtcs: [], permanentDtcs: [] });
    const r = await tool('read_dtcs').run({}, c);
    expect((r.data as { stored: Dtc[] }).stored).toHaveLength(60);
    expect(r.digest.length).toBeLessThanOrEqual(MAX_DIGEST_CHARS);
  });

  it('describes manufacturer codes with the car make', async () => {
    const c = await golfCtx({ storedDtcs: ['P1403'], pendingDtcs: [], permanentDtcs: [] });
    const data = (await tool('read_dtcs').run({}, c)).data as { stored: Dtc[] };
    expect(data.stored[0].description).toBe(describeDtc('P1403', 'vag'));
  });

  it('reads only the modes the profile lists', async () => {
    const c = await golfCtx({ storedDtcs: [], pendingDtcs: ['P0101'], permanentDtcs: [] });
    const r = await tool('read_dtcs').run(
      {},
      { ...c, profile: { ...golfPlus2009, dtcModes: ['03'] } },
    );
    expect((r.data as { pending: Dtc[] }).pending).toEqual([]);
    expect(r.digest).toContain('Pending DTCs: not read on this car.');
    expect(tool('read_dtcs').costMs).toBe(3000);
    expect(tool('read_dtcs').labelKey).toBe('aiDiagnose:agent.tool.read_dtcs');
  });
});

describe('digest helpers', () => {
  it('clampDigest keeps the limit', () =>
    expect(clampDigest('x\n'.repeat(2000)).length).toBeLessThanOrEqual(1600));

  it('clampDigest cuts at a line break and marks the cut, and leaves short text alone', () => {
    expect(MAX_DIGEST_CHARS).toBe(1600);
    expect(clampDigest('short\ntext')).toBe('short\ntext');
    expect(clampDigest('line one\nline two\nline three', 26)).toBe('line one\n… (truncated)');
    expect(clampDigest('a'.repeat(12) + '\n' + 'b'.repeat(20), 26)).toBe(
      'a'.repeat(12) + '\n… (truncated)',
    );
    expect(clampDigest('y'.repeat(50), 20)).toBe('y'.repeat(6) + '\n… (truncated)');
  });

  it('clampDigest with countMore ends a cut digest with how many lines were left out', () => {
    const text = ['head', 'aaaa', 'bbbb', 'cccc', 'dddd'].join('\n');
    expect(clampDigest(text, 100, { countMore: true })).toBe(text);
    expect(clampDigest(text, 23, { countMore: true })).toBe('head\naaaa\n… (3 more)');
    const long = clampDigest('x\n'.repeat(2000), MAX_DIGEST_CHARS, { countMore: true });
    expect(long.length).toBeLessThanOrEqual(MAX_DIGEST_CHARS);
    expect(long).toMatch(/\n… \(\d+ more\)$/);
    // A first line longer than the room falls back to the mid-line cut.
    expect(clampDigest('y'.repeat(50), 20, { countMore: true })).toBe(
      'y'.repeat(6) + '\n… (truncated)',
    );
  });

  it('statsLine prints min / avg / max with one decimal, the unit and the window', () => {
    expect(statsLine('010B Intake MAP', 'kPa', [98, 100, 102], 10)).toBe(
      '010B Intake MAP: min 98 / avg 100 / max 102 kPa (n=3, 10 s)',
    );
    expect(statsLine('x', 'V', [12.34, 12.46], 1)).toBe(
      'x: min 12.3 / avg 12.4 / max 12.5 V (n=2, 1 s)',
    );
    expect(statsLine('x', '', [1, 2], 1)).toBe('x: min 1 / avg 1.5 / max 2 (n=2, 1 s)');
    expect(statsLine('x', 'kPa', [], 2)).toBe('x: no answer (n=0, 2 s)');
  });
});

describe('DRIVER_INSTRUCTIONS', () => {
  it('has the fixed English texts and translation keys', () => {
    const ids: DriverInstructionId[] = [
      'start_engine_idle',
      'engine_off_ignition_on',
      'restart_engine',
      'hold_2500_rpm',
      'electrical_load_on',
      'electrical_load_off',
    ];
    expect(Object.keys(DRIVER_INSTRUCTIONS)).toEqual(ids);
    for (const id of ids)
      expect(DRIVER_INSTRUCTIONS[id].labelKey).toBe(`aiDiagnose:agent.driver.${id}`);
    expect(DRIVER_INSTRUCTIONS.restart_engine.en).toBe(
      'Switch the engine off, then start it again.',
    );
    expect(DRIVER_INSTRUCTIONS.hold_2500_rpm.en).toBe(
      'In Park or Neutral, hold the engine at 2500 rpm for 10 seconds.',
    );
  });
});
