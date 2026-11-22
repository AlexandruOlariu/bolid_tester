import { socFromResting } from '../analysis/battery';
import { golfPlus2009 } from '../../vehicles/golf-plus-2009-20tdi';
import { CORE_AGENT_CONTRIBUTION } from './coreTools';
import {
  BATTERY_MAX_MS,
  BATTERY_POST_MS,
  BATTERY_PRE_MS,
  BATTERY_SAMPLE_MS,
} from './procedures/batteryCapture';
import type { ReadOnlySession } from './readOnlySession';
import type { DriverInstructionId, DriverReply, ProcedureContext, SkillProcedure } from './types';

function proc(id: string): SkillProcedure {
  const p = CORE_AGENT_CONTRIBUTION.procedures?.find((x) => x.id === id);
  if (!p) throw new Error(`no procedure ${id}`);
  return p;
}

interface Fake {
  ctx: ProcedureContext;
  clock(): number;
  /** Clock times at which the voltage was read. */
  reads: number[];
  asked: DriverInstructionId[];
}

/** A procedure context with a fake clock (advanced by `sleep`), a session whose `voltage()` is
 *  `volts(t)`, and a driver whose reply comes from `driver` (called once per `askDriver`). */
function fake(
  volts: (t: number) => number | null,
  driver: (clock: () => number) => Promise<DriverReply>,
  onSleep: (t: number) => void = () => undefined,
): Fake {
  let t = 0;
  const reads: number[] = [];
  const asked: DriverInstructionId[] = [];
  const clock = () => t;
  const session = {
    voltage: async () => {
      reads.push(t);
      return volts(t);
    },
  } as unknown as ReadOnlySession;
  const ctx: ProcedureContext = {
    session,
    profile: golfPlus2009,
    guideProfileId: golfPlus2009.id,
    vehicle: { label: golfPlus2009.name },
    vin: null,
    now: clock,
    sleep: async (ms) => {
      t += ms;
      onSleep(t);
    },
    signal: new AbortController().signal,
    askDriver: (id) => {
      asked.push(id);
      return driver(clock);
    },
    callTool: async () => {
      throw new Error('not used');
    },
    runProcedure: async () => {
      throw new Error('not used');
    },
  };
  return { ctx, clock, reads, asked };
}

it('declares the procedure constants', () => {
  expect(proc('battery_capture').costMs).toBe(30_000);
  expect([BATTERY_SAMPLE_MS, BATTERY_PRE_MS, BATTERY_POST_MS, BATTERY_MAX_MS]).toEqual([
    200, 2000, 4000, 30_000,
  ]);
});

it('battery_capture reports a weak battery when the driver cannot restart', async () => {
  // fake session voltages: 11.9 V flat; askDriver resolves { kind: 'cant' }
  const { ctx: procCtx, asked } = fake(
    () => 11.9,
    async () => ({ kind: 'cant' }),
  );
  const r = await proc('battery_capture').run(procCtx);
  expect(r.findings?.[0]).toMatchObject({
    key: 'aiDiagnose:agent.finding.battery.weak',
    severity: 'warn',
  });
  expect(r.findings?.[0].values).toEqual({ resting: '11.9', dip: '—', charging: '—' });
  expect(r.digest).toContain('Driver could not restart: cranking dip not measured.');
  expect(r.digest).toContain('Resting 11.9 V, cranking dip —, charging —.');
  expect(r.digest).toContain(`State of charge: ${socFromResting(11.9)} %.`);
  expect(asked).toEqual(['restart_engine']);
});

it('samples before, during and after the restart and finds a good battery', async () => {
  // The driver restarts the engine at 3 s: a 10.2 V crank, then the alternator charges at 14.1 V.
  let restart: (r: DriverReply) => void = () => undefined;
  const f = fake(
    (t) => (t < 3000 ? 12.5 : t < 3400 ? 10.2 : 14.1),
    () =>
      new Promise((resolve) => {
        restart = resolve;
      }),
    (t) => {
      if (t >= 3000) restart({ kind: 'done' });
    },
  );
  const r = await proc('battery_capture').run(f.ctx);
  expect(r.findings).toEqual([
    {
      key: 'aiDiagnose:agent.finding.battery.good',
      severity: 'ok',
      values: { resting: '12.5', dip: '10.2', charging: '14.1' },
    },
  ]);
  expect(r.digest).toContain('Resting 12.5 V, cranking dip 10.2 V, charging 14.1 V.');
  expect(r.digest).toContain('Cranking voltage held at 10.2 V — healthy.');
  expect(r.digest).not.toContain('Driver could not restart');
  // Sampling kept going while the driver prompt was open (2 s → 3 s) …
  expect(f.reads.some((t) => t > BATTERY_PRE_MS && t < 3000)).toBe(true);
  // … and stopped 4 s after the reply.
  expect(f.clock()).toBe(3000 + BATTERY_POST_MS);
  expect(f.reads.every((t, i) => i === 0 || t - f.reads[i - 1] === BATTERY_SAMPLE_MS)).toBe(true);
});

it('stops sampling at 30 s when the driver has not replied, then states the timeout', async () => {
  const f = fake(
    () => 12.4,
    () => new Promise((resolve) => setTimeout(() => resolve({ kind: 'timeout' }), 0)),
  );
  const r = await proc('battery_capture').run(f.ctx);
  expect(f.clock()).toBe(BATTERY_MAX_MS);
  expect(r.digest).toContain('Driver could not restart: cranking dip not measured.');
  expect(r.findings?.[0].key).toBe('aiDiagnose:agent.finding.battery.good');
});

it('reports unknown when the adapter gives no voltage', async () => {
  const f = fake(
    () => null,
    async () => ({ kind: 'done' }),
  );
  const r = await proc('battery_capture').run(f.ctx);
  expect(r.findings?.[0]).toMatchObject({
    key: 'aiDiagnose:agent.finding.battery.unknown',
    severity: 'info',
    values: { resting: '—', dip: '—', charging: '—' },
  });
  expect(r.digest).toContain('State of charge: —.');
  expect(r.digest).toContain('No voltage samples.');
});

it('states a refused driver step', async () => {
  const f = fake(
    () => 12.6,
    async () => ({ kind: 'refused', reason: 'speed_unknown' }),
  );
  const r = await proc('battery_capture').run(f.ctx);
  expect(r.digest).toContain('Driver step refused (speed unknown): cranking dip not measured.');
});

it('fails when the driver gate fails, after sampling stops', async () => {
  const f = fake(
    () => 12.6,
    async () => {
      throw new Error('link closed');
    },
  );
  await expect(proc('battery_capture').run(f.ctx)).rejects.toThrow('link closed');
});

it('ends at once on Stop and never opens the driver prompt', async () => {
  const ac = new AbortController();
  const f = fake(
    () => 12.6,
    async () => ({ kind: 'done' }),
    (t) => {
      if (t >= 1000) ac.abort();
    },
  );
  const r = await proc('battery_capture').run({ ...f.ctx, signal: ac.signal });
  expect(f.asked).toEqual([]);
  expect(f.clock()).toBe(1000);
  expect(r.digest).toContain('Stopped before the driver replied: cranking dip not measured.');
});
