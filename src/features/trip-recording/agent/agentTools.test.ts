/** The trip-recording agent tools (plan 34b): `list_trips`, `read_trip` and `read_fuel_economy`
 *  read only the active car's trips. The persist storage and the trip CSVs run over an in-memory
 *  file map; trips are seeded through `useTripStore.setState` plus a `trip-<id>.csv` file. */
const files = new Map<string, string>();

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: '/tmp/bolid-test/',
  cacheDirectory: '/tmp/bolid-test/',
  getInfoAsync: jest.fn(async (uri: string) => ({ exists: files.has(uri) })),
  readAsStringAsync: jest.fn(async (uri: string) => files.get(uri) ?? ''),
  writeAsStringAsync: jest.fn(async (uri: string, value: string) => {
    files.set(uri, value);
  }),
  deleteAsync: jest.fn(async (uri: string) => {
    files.delete(uri);
  }),
}));

import { buildAgentRegistry, parseSkillFile, toCsv, tripStats } from '@/shared/obd-core';
import type {
  AgentContribution,
  AgentTool,
  LiveValue,
  ReadOnlySession,
  ToolContext,
  TripSample,
} from '@/shared/obd-core';
import { useVehicleStore } from '@/shared/state/vehicleStore';
import { useGarageStore } from '@/shared/state/garageStore';
import { getVehicleProfile } from '@/shared/vehicles';
import en from '@/shared/i18n/locales/en/tripRecording.json';
import ro from '@/shared/i18n/locales/ro/tripRecording.json';
import * as recorder from '../hooks/useTripRecorder';
import { useTripStore, type TripSummary } from '../model/tripStore';
import { agentTools as tripTools } from './agentTools';
import tripsSkill from './trips.skill.json';
import fuelEconomySkill from './fuel_economy.skill.json';

const GOLF = 'golf-plus-2009-20tdi';
const PUNTO = 'fiat-punto-2008-12';
const golf = getVehicleProfile(GOLF);
const DAY = Date.UTC(2026, 10, 20, 7, 0, 0);

/** A facade stub answering live polls with `live` (PID → value); every other call is unused. */
function stubSession(live: Record<string, number> = {}): ReadOnlySession {
  return {
    effectivePids: () => Object.keys(live),
    pollOnce: async (pids: string[]) => {
      const out: Record<string, LiveValue> = {};
      for (const pid of pids)
        if (pid in live) out[pid] = { pid, name: pid, unit: '', value: live[pid], ts: 0 };
      return out;
    },
  } as unknown as ReadOnlySession;
}

function ctxWith(session: ReadOnlySession = stubSession()): ToolContext {
  return {
    session,
    profile: golf,
    guideProfileId: golf.id,
    vehicle: { label: golf.name, make: golf.make },
    vin: null,
    now: () => 0,
    sleep: async () => undefined,
    signal: new AbortController().signal,
    askDriver: async () => ({ kind: 'done' }),
  };
}

const golfCtx = ctxWith();

function toolOf(c: AgentContribution, name: string): AgentTool {
  const t = c.tools?.find((x) => x.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return t;
}

let order = 0;

/** A trip summary for `id`; later seeds start later, so they list first. */
function summary(id: string, vehicleId: string, samples: TripSample[] = []): TripSummary {
  const startedAt = samples[0]?.t ?? DAY + order++ * 3_600_000;
  const endedAt = samples.length ? samples[samples.length - 1].t : startedAt + 600_000;
  const header = { id, startedAt, endedAt, profileId: vehicleId, vin: null, protocol: 'CAN' };
  return { header, stats: tripStats({ header, samples, markers: [] }), markerCount: 0, vehicleId };
}

function addTrips(trips: TripSummary[]): void {
  useTripStore.setState((s) => ({ trips: [...trips, ...s.trips] }));
}

function seedTrips(list: { id: string; vehicleId: string }[]): void {
  addTrips(list.map((t) => summary(t.id, t.vehicleId)));
}

/** Store summary + CSV file of a Golf trip with these samples. */
function seedTripCsv(id: string, samples: TripSample[], vehicleId = GOLF): TripSummary {
  const s = summary(id, vehicleId, samples);
  files.set(`/tmp/bolid-test/trip-${id}.csv`, toCsv({ header: s.header, samples, markers: [] }));
  addTrips([s]);
  return s;
}

let clock = DAY;

/** Coolant samples `stepMs` apart (with rpm and speed), starting after every earlier seed. */
function coldStartCoolant(coolant: number[], stepMs: number): TripSample[] {
  const start = (clock += 86_400_000);
  return coolant.map((c, i) => ({
    t: start + i * stepMs,
    values: { '0105': c, '010C': 800 + i * 100, '010D': 36 },
  }));
}

const warmStartCoolant = (coolant: number[]): TripSample[] => coldStartCoolant(coolant, 60_000);

beforeEach(() => {
  files.clear();
  order = 0;
  useTripStore.setState({ trips: [], recording: false, samples: [], markers: [], startedAt: null });
  useGarageStore.setState({ vehicles: [] });
  useVehicleStore.setState({ selectedProfileId: GOLF });
});

describe('list_trips', () => {
  it("lists only the active car's trips", async () => {
    seedTrips([
      { id: 'g1', vehicleId: GOLF },
      { id: 'p1', vehicleId: PUNTO },
    ]);
    const d = (await toolOf(tripTools, 'list_trips').run({}, golfCtx)).digest;
    expect(d).toContain('g1');
    expect(d).not.toContain('p1');
  });

  it('says when there are no trips', async () =>
    expect((await toolOf(tripTools, 'list_trips').run({}, golfCtx)).digest).toBe(
      'No trips recorded for this car.',
    ));

  it("follows the garage selection: after a switch it lists only the new car's trips", async () => {
    seedTrips([
      { id: 'g1', vehicleId: GOLF },
      { id: 'u1', vehicleId: 'user:abc' },
    ]);
    useGarageStore.setState({
      vehicles: [
        {
          id: 'user:abc',
          name: 'Skoda Octavia 2012',
          fuel: 'petrol',
          baseProfileId: 'generic',
          createdAt: 0,
          updatedAt: 0,
        },
      ],
    });
    useVehicleStore.setState({ selectedProfileId: 'user:abc' });
    const d = (await toolOf(tripTools, 'list_trips').run({}, golfCtx)).digest;
    expect(d).toContain('u1');
    expect(d).not.toContain('g1');
  });

  it('formats each trip newest first with minutes, km, max coolant, max rpm and L/100 km', async () => {
    const samples: TripSample[] = [0, 1, 2, 3].map((i) => ({
      t: DAY + i * 200_000,
      values: { '0105': 70 + i * 5, '010C': 1500 + i * 500, '010D': 54, '015E': 2.7 },
    }));
    seedTripCsv('older', warmStartCoolant([80, 85]));
    const s = seedTripCsv('t1', samples);
    s.header.startedAt = DAY + 10 * 86_400_000;
    const d = (await toolOf(tripTools, 'list_trips').run({}, golfCtx)).digest.split('\n');
    expect(d[0]).toBe('2 trips for this car, newest first:');
    expect(d[1]).toMatch(
      /^t1 \d{4}-\d{2}-\d{2} \d{2}:\d{2} 10 min, 9 km, max coolant 85 °C, max rpm 3000, 5 L\/100 km$/,
    );
    expect(d[2]).toMatch(/^older .*no fuel data$/);
  });

  it('lists the newest 10 trips and counts the older ones', async () => {
    seedTrips(Array.from({ length: 13 }, (_, i) => ({ id: `g${i}`, vehicleId: GOLF })));
    const r = await toolOf(tripTools, 'list_trips').run({}, golfCtx);
    const lines = r.digest.split('\n');
    expect(lines[0]).toBe('13 trips for this car, newest first:');
    expect(lines).toHaveLength(12);
    expect(lines[1]).toMatch(/^g12 /);
    expect(lines[11]).toBe('… (3 older trips)');
    expect(r.digest.length).toBeLessThanOrEqual(1600);
  });
});

describe('read_trip', () => {
  it('read_trip measures the warm-up from a cold start', async () => {
    seedTripCsv('g1', coldStartCoolant([20, 35, 50, 65, 80, 85], 120_000));
    expect((await toolOf(tripTools, 'read_trip').run({ id: 'g1' }, golfCtx)).digest).toContain(
      'warm-up 8 min',
    );
  });

  it('read_trip latest_cold picks the newest cold-start trip and returns its samples', async () => {
    seedTripCsv('g0', coldStartCoolant([20, 50, 85], 60_000));
    seedTripCsv('g1', warmStartCoolant([85, 88]));
    const r = await toolOf(tripTools, 'read_trip').run({ id: 'latest_cold' }, golfCtx);
    expect((r.data as { header: { id: string } }).header.id).toBe('g0');
    expect((r.data as { samples: TripSample[] }).samples).toHaveLength(3);
  });

  it("latest_cold ignores another car's cold-start trip", async () => {
    seedTripCsv('p0', coldStartCoolant([15, 85], 60_000), PUNTO);
    seedTripCsv('g1', warmStartCoolant([85, 88]));
    const r = await toolOf(tripTools, 'read_trip').run({ id: 'latest_cold' }, golfCtx);
    expect(r.digest).toBe(
      'No cold-start trip (coolant ≤ 40 °C at the start) recorded for this car.',
    );
    expect(r.data).toBeUndefined();
  });

  it("read_trip refuses another car's trip", async () => {
    seedTripCsv('p1', warmStartCoolant([85, 88]), PUNTO);
    expect((await toolOf(tripTools, 'read_trip').run({ id: 'p1' }, golfCtx)).digest).toBe(
      'Trip p1 not found for this car.',
    );
  });

  it('a missing id is not found, and latest_cold with no trips says none are recorded', async () => {
    expect((await toolOf(tripTools, 'read_trip').run({ id: 'nope' }, golfCtx)).digest).toBe(
      'Trip nope not found for this car.',
    );
    expect((await toolOf(tripTools, 'read_trip').run({ id: 'latest_cold' }, golfCtx)).digest).toBe(
      'No trips recorded for this car.',
    );
  });

  it('summarises the default PIDs the trip logged and says when it started warm', async () => {
    seedTripCsv('g1', warmStartCoolant([85, 89, 90]));
    const lines = (await toolOf(tripTools, 'read_trip').run({ id: 'g1' }, golfCtx)).digest.split(
      '\n',
    );
    expect(lines[0]).toMatch(/^Trip g1 .*: 2 min, 1\.2 km, 3 samples$/);
    expect(lines.slice(1)).toEqual([
      '0105 Coolant temp: min 85 / avg 88 / max 90 °C (n=3); started warm',
      '010C Engine RPM: min 800 / avg 900 / max 1000 rpm (n=3)',
      '010D Vehicle speed: min 36 / avg 36 / max 36 km/h (n=3)',
    ]);
  });

  it('summarises requested PIDs and names those the trip did not log', async () => {
    seedTripCsv('g1', coldStartCoolant([30, 60], 60_000));
    const d = (
      await toolOf(tripTools, 'read_trip').run({ id: 'g1', pids: ['010c', '0110'] }, golfCtx)
    ).digest;
    expect(d.split('\n').slice(1)).toEqual([
      '010C Engine RPM: min 800 / avg 850 / max 900 rpm (n=2)',
      '0110 MAF: not logged',
    ]);
  });

  it('a cold trip that never reaches 80 °C says so', async () => {
    seedTripCsv('g1', coldStartCoolant([20, 40, 60, 70], 300_000));
    expect((await toolOf(tripTools, 'read_trip').run({ id: 'g1' }, golfCtx)).digest).toContain(
      'did not reach 80 °C in 15 min',
    );
  });

  it('a trip whose CSV is gone says its samples were not saved', async () => {
    seedTrips([{ id: 'g1', vehicleId: GOLF }]);
    const r = await toolOf(tripTools, 'read_trip').run({ id: 'g1' }, golfCtx);
    expect(r.digest).toMatch(/^Trip g1 .*0 samples\. Its samples were not saved on this phone\.$/);
  });

  it('a failed sample load becomes an error digest', async () => {
    seedTrips([{ id: 'g1', vehicleId: GOLF }]);
    const spy = jest.spyOn(recorder, 'loadTripSamples').mockRejectedValue(new Error('disk error'));
    const r = await toolOf(tripTools, 'read_trip').run({ id: 'g1' }, golfCtx);
    expect(r).toMatchObject({ status: 'error', digest: 'Could not read trip g1: disk error' });
    spy.mockRestore();
  });
});

describe('read_fuel_economy', () => {
  it('gives the instant L/100 km from the fuel rate and the last 5 trips of this car', async () => {
    for (let i = 0; i < 6; i++) seedTripCsv(`g${i}`, warmStartCoolant([85, 88]));
    seedTripCsv('p1', warmStartCoolant([85, 88]), PUNTO);
    const r = await toolOf(tripTools, 'read_fuel_economy').run(
      {},
      ctxWith(stubSession({ '015E': 3, '010D': 50 })),
    );
    const lines = r.digest.split('\n');
    expect(lines[0]).toBe('Instant: 6 L/100 km at 50 km/h (fuel rate 015E).');
    expect(lines[1]).toBe('Last 5 trips:');
    expect(lines.slice(2).map((l) => l.split(' ')[0])).toEqual(['g5', 'g4', 'g3', 'g2', 'g1']);
    expect(lines[2]).toMatch(/: no fuel data over 0\.6 km$/);
    expect(r.summary).toBe('Fuel: 6 L/100 km');
  });

  it('gives L/h at standstill from the MAF estimate and says when there are no trips', async () => {
    const r = await toolOf(tripTools, 'read_fuel_economy').run(
      {},
      ctxWith(stubSession({ '0110': 4, '010D': 0 })),
    );
    expect(r.digest.split('\n')).toEqual([
      expect.stringMatching(/^Instant: \d+(\.\d)? L\/h at standstill \(MAF 0110 estimate\)\.$/),
      'No trips recorded for this car.',
    ]);
  });

  it('says when no fuel value answers', async () => {
    const r = await toolOf(tripTools, 'read_fuel_economy').run({}, golfCtx);
    expect(r.digest.split('\n')[0]).toBe(
      'Instant: not available (no answer from fuel rate 015E or MAF 0110).',
    );
  });
});

describe('trip-recording contribution', () => {
  it('declares the tools as always offered, store tools free of adapter time', () => {
    const avail = {
      profile: getVehicleProfile('passat-b55-19tdi'),
      protocol: 'ISO_14230_4_KWP_FAST' as const,
      supportedPids: [],
      canMonitor: false,
    };
    for (const name of ['list_trips', 'read_trip', 'read_fuel_economy']) {
      const t = toolOf(tripTools, name);
      expect(t.available(avail)).toBe(true);
      expect(t.labelKey).toBe(`tripRecording:agent.tool.${name}`);
    }
    expect(toolOf(tripTools, 'list_trips').costMs).toBe(0);
    expect(toolOf(tripTools, 'read_trip').args.required).toEqual(['id']);
  });

  it('bundles trips and fuel_economy skills that parse and register', () => {
    expect(parseSkillFile(tripsSkill).ok).toBe(true);
    expect(parseSkillFile(fuelEconomySkill).ok).toBe(true);
    expect(tripTools.skills?.map((s) => s.name)).toEqual(['trips', 'fuel_economy']);
    expect(tripTools.skills?.find((s) => s.name === 'trips')?.tools).toEqual([
      'list_trips',
      'read_trip',
    ]);
    expect(() => buildAgentRegistry([tripTools])).not.toThrow();
  });

  it('every tool label has en and ro text', () => {
    for (const locale of [en, ro])
      for (const name of ['list_trips', 'read_trip', 'read_fuel_economy'] as const)
        expect(locale.agent.tool[name]).toBeTruthy();
  });
});
