/** The history agent tools (plan 34b): `read_history` (the active car's AI runs, fault-code checks
 *  with a code going away and recurring codes, saved module scans) and `history_compare` (one PID's
 *  max / average over this car's last trips plus one live read). The persist storage and the trip
 *  CSVs run over an in-memory file map. */
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

import {
  MAX_DIGEST_CHARS,
  buildAgentRegistry,
  parseSkillFile,
  toCsv,
  tripStats,
} from '@/shared/obd-core';
import type {
  AgentContribution,
  AgentTool,
  AiReport,
  LiveValue,
  ReadOnlySession,
  ToolContext,
  TripSample,
} from '@/shared/obd-core';
import {
  useHistoryStore,
  type AiHistoryEntry,
  type DtcHistoryEntry,
  type HistoryEntry,
  type HistoryVehicle,
} from '@/shared/state/historyStore';
import { useGarageStore } from '@/shared/state/garageStore';
import { flushPendingWrites } from '@/shared/state/persistStorage';
import { useVehicleStore } from '@/shared/state/vehicleStore';
import { getVehicleProfile } from '@/shared/vehicles';
import en from '@/shared/i18n/locales/en/history.json';
import ro from '@/shared/i18n/locales/ro/history.json';
import { useScanHistoryStore, type SavedScan } from '@/features/module-scan/model/scanHistoryStore';
import { useTripStore, type TripSummary } from '@/features/trip-recording/model/tripStore';
import { agentTools as historyTools } from './agentTools';
import historySkill from './history.skill.json';

const GOLF = 'golf-plus-2009-20tdi';
const PUNTO = 'fiat-punto-2008-12';
const golf = getVehicleProfile(GOLF);
/** The first seeded record: 2026-11-10 09:00 local; each later one is a day later. */
const T0 = new Date(2026, 10, 10, 9, 0).getTime();
const DAY_MS = 86_400_000;

/** A facade stub answering live polls with `live` (PID → value). */
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
    now: () => T0 + 30 * DAY_MS,
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

const car = (id: string, vin: string | null = null): HistoryVehicle => ({ id, label: id, vin });

let seq = 0;
const nextTs = (): number => T0 + seq++ * DAY_MS;

/** Prepend entries like the store does (newest first). */
function addEntries(entries: HistoryEntry[]): void {
  useHistoryStore.setState((s) => ({ entries: [...[...entries].reverse(), ...s.entries] }));
}

/** Fault-code checks for `carId`, oldest first, each a day after the previous record. */
function seedDtcChecks(carId: string, checks: string[][], vin: string | null = null): void {
  addEntries(
    checks.map(
      (codes): DtcHistoryEntry => ({
        kind: 'dtc',
        id: `dtc-${seq}`,
        ts: nextTs(),
        vehicle: car(carId, vin),
        milOn: codes.length > 0,
        stored: codes.map((code) => ({ code, description: '' })),
        pending: [],
        permanent: [],
        monitorsComplete: null,
        monitorsTotal: null,
      }),
    ),
  );
}

function seedAiRun(carId: string, overall: AiHistoryEntry['overall'], summary: string): void {
  addEntries([
    {
      kind: 'ai',
      id: `ai-${seq}`,
      ts: nextTs(),
      vehicle: car(carId),
      source: 'ai',
      overall,
      summary,
      findingCount: 1,
      report: {} as AiReport,
    },
  ]);
}

function seedScan(carId: string): void {
  const scan: SavedScan = {
    id: `scan-${seq}`,
    ts: nextTs(),
    vehicle: car(carId),
    protocol: 'CAN',
    modules: [],
  };
  useScanHistoryStore.setState((s) => ({ scans: [scan, ...s.scans] }));
}

/** A trip of `carId` with `coolant` samples a minute apart, plus its CSV. */
function seedTrip(id: string, carId: string, coolant: number[]): void {
  const start = nextTs();
  const samples: TripSample[] = coolant.map((c, i) => ({
    t: start + i * 60_000,
    values: { '0105': c },
  }));
  const header = {
    id,
    startedAt: start,
    endedAt: start + 60_000 * coolant.length,
    profileId: carId,
    vin: null,
    protocol: 'CAN',
  };
  const trip: TripSummary = {
    header,
    stats: tripStats({ header, samples, markers: [] }),
    markerCount: 0,
    vehicleId: carId,
  };
  files.set(`/tmp/bolid-test/trip-${id}.csv`, toCsv({ header, samples, markers: [] }));
  useTripStore.setState((s) => ({ trips: [trip, ...s.trips] }));
}

beforeEach(() => {
  files.clear();
  seq = 0;
  useHistoryStore.setState({ entries: [] });
  useScanHistoryStore.setState({ scans: [] });
  useTripStore.setState({ trips: [], recording: false, samples: [], markers: [], startedAt: null });
  useGarageStore.setState({ vehicles: [] });
  useVehicleStore.setState({ selectedProfileId: GOLF });
});

// The history and scan stores debounce their writes; flush them so no timer outlives the suite.
afterAll(() => flushPendingWrites());

describe('read_history', () => {
  it('history spots recurring codes and a clear', async () => {
    seedDtcChecks('golf-plus-2009-20tdi', [['P0401'], ['P0401'], []]);
    const d = (await toolOf(historyTools, 'read_history').run({ limit: 5 }, golfCtx)).digest;
    expect(d).toContain('Recurring: P0401 (2 checks)');
    expect(d).toMatch(/Codes went away between/);
  });

  it('history is empty-safe', async () =>
    expect((await toolOf(historyTools, 'read_history').run({}, golfCtx)).digest).toBe(
      'No history for this car yet.',
    ));

  it('lists AI runs, checks newest first, the clear with its dates and the saved scans', async () => {
    seedDtcChecks(GOLF, [['P0401', 'P2002'], ['P0401'], []]);
    seedAiRun(GOLF, 'urgent', `EGR valve stuck. ${'x'.repeat(200)}\nsecond line`);
    seedScan(GOLF);
    seedScan(GOLF);
    const r = await toolOf(historyTools, 'read_history').run({ limit: 5 }, golfCtx);
    const lines = r.digest.split('\n');
    expect(lines[0]).toBe('AI runs (1 of 1, newest first):');
    expect(lines[1]).toMatch(/^2026-11-13 09:00 urgent: EGR valve stuck\. x+…$/);
    expect(lines[1].length).toBeLessThanOrEqual('2026-11-13 09:00 urgent: '.length + 120);
    expect(lines.slice(2, 6)).toEqual([
      'Fault-code checks (3 of 3, newest first):',
      '2026-11-12 09:00: no codes',
      '2026-11-11 09:00: P0401 (MIL on)',
      '2026-11-10 09:00: P0401, P2002 (MIL on)',
    ]);
    expect(lines).toContain(
      'Codes went away between 2026-11-11 09:00 and 2026-11-12 09:00 (cleared or fixed)',
    );
    expect(lines).toContain('Recurring: P0401 (2 checks)');
    expect(lines[lines.length - 1]).toBe('Saved module scans: 2 (newest 2026-11-15 09:00)');
    expect(r.summary).toBe('History: 1 AI runs, 3 checks, 2 scans');
  });

  it('keeps the checks, patterns and scans line when 10 long AI runs fill the budget', async () => {
    for (let i = 0; i < 10; i++) seedAiRun(GOLF, 'attention', `Run ${i}: ${'y'.repeat(200)}`);
    seedDtcChecks(GOLF, [['P0401'], ['P0401'], []]);
    seedScan(GOLF);
    const d = (await toolOf(historyTools, 'read_history').run({ limit: 10 }, golfCtx)).digest;
    expect(d.length).toBeLessThanOrEqual(MAX_DIGEST_CHARS);
    expect(d).toContain('Fault-code checks (3 of 3, newest first):');
    expect(d).toContain('Recurring: P0401 (2 checks)');
    expect(d).toMatch(/Codes went away between/);
    expect(d.split('\n').pop()).toMatch(/^Saved module scans: 1 \(newest /);
    // The AI section is the one cut, and it says how many runs it left out.
    expect(d).toMatch(/\n… \(\d+ more\)\n/);
    expect(d).toContain('AI runs (10 of 10, newest first):');
  });

  it('shows only the newest `limit` checks', async () => {
    seedDtcChecks(GOLF, [['P0001'], ['P0002'], ['P0003']]);
    const d = (await toolOf(historyTools, 'read_history').run({ limit: 2 }, golfCtx)).digest;
    expect(d).toContain('Fault-code checks (2 of 3, newest first):');
    expect(d).toContain('P0003');
    expect(d).not.toContain('P0001');
  });

  it("reports only the active car's records", async () => {
    seedDtcChecks(PUNTO, [['P0300']]);
    seedAiRun(PUNTO, 'attention', 'Misfire');
    seedScan(PUNTO);
    expect((await toolOf(historyTools, 'read_history').run({}, golfCtx)).digest).toBe(
      'No history for this car yet.',
    );
  });

  it("follows the garage selection, matching the car's id or its learned VIN", async () => {
    seedDtcChecks(GOLF, [['P0401']]);
    seedDtcChecks('generic', [['P0420']], 'TMBZZZ1Z2CB000001');
    useGarageStore.setState({
      vehicles: [
        {
          id: 'user:abc',
          name: 'Skoda Octavia 2012',
          fuel: 'diesel',
          baseProfileId: 'generic',
          createdAt: 0,
          updatedAt: 0,
          learned: {
            protocol: 'ISO_15765_4_CAN_11_500',
            supportedPids: [],
            vin: 'TMBZZZ1Z2CB000001',
            calibrationId: null,
            learnedAt: 0,
          },
        },
      ],
    });
    useVehicleStore.setState({ selectedProfileId: 'user:abc' });
    const d = (await toolOf(historyTools, 'read_history').run({}, golfCtx)).digest;
    expect(d).toContain('P0420');
    expect(d).not.toContain('P0401');
  });
});

describe('history_compare', () => {
  it("gives this car's last trips oldest first with max and average, then a live read", async () => {
    seedTrip('g1', GOLF, [80, 90, 100]);
    seedTrip('p1', PUNTO, [120, 125]);
    seedTrip('g2', GOLF, [70, 80]);
    const r = await toolOf(historyTools, 'history_compare').run(
      { pid: '0105' },
      ctxWith(stubSession({ '0105': 91 })),
    );
    expect(r.digest.split('\n')).toEqual([
      "0105 Coolant temp over this car's last 2 trips (oldest → newest):",
      '2026-11-10 09:00: max 100 / avg 90 °C',
      '2026-11-12 09:00: max 80 / avg 75 °C',
      'Now: 91 °C',
    ]);
  });

  it('keeps the newest 10 trips and names a trip that did not log the PID', async () => {
    for (let i = 0; i < 12; i++) seedTrip(`g${i}`, GOLF, [80 + i]);
    const lines = (
      await toolOf(historyTools, 'history_compare').run({ pid: '010c' }, golfCtx)
    ).digest.split('\n');
    expect(lines[0]).toBe("010C Engine RPM over this car's last 10 trips (oldest → newest):");
    expect(lines).toHaveLength(12);
    expect(lines[1]).toBe('2026-11-12 09:00: not logged');
    expect(lines[11]).toBe('Now: not supported by this car');
  });

  it('says when there are no trips and still reads the value now', async () => {
    const r = await toolOf(historyTools, 'history_compare').run(
      { pid: '0105' },
      ctxWith(stubSession({ '0105': 85 })),
    );
    expect(r.digest.split('\n')).toEqual(['No trips recorded for this car.', 'Now: 85 °C']);
  });
});

describe('history contribution', () => {
  it('read_history runs at triage with limit 5; both tools are always offered', () => {
    const avail = {
      profile: getVehicleProfile('passat-b55-19tdi'),
      protocol: 'ISO_14230_4_KWP_FAST' as const,
      supportedPids: [],
      canMonitor: false,
    };
    const read = toolOf(historyTools, 'read_history');
    expect(read.triage).toEqual({ args: { limit: 5 } });
    expect(read.costMs).toBe(0);
    expect(toolOf(historyTools, 'history_compare').costMs).toBe(1000);
    expect(toolOf(historyTools, 'history_compare').args.required).toEqual(['pid']);
    for (const name of ['read_history', 'history_compare']) {
      expect(toolOf(historyTools, name).available(avail)).toBe(true);
      expect(toolOf(historyTools, name).labelKey).toBe(`history:agent.tool.${name}`);
    }
  });

  it('bundles a history skill that parses and registers', () => {
    expect(parseSkillFile(historySkill).ok).toBe(true);
    expect(historyTools.skills?.map((s) => s.name)).toEqual(['history']);
    expect(historyTools.skills?.[0].tools).toEqual(['read_history', 'history_compare']);
    expect(() => buildAgentRegistry([historyTools])).not.toThrow();
  });

  it('every tool label has en and ro text', () => {
    for (const locale of [en, ro])
      for (const name of ['read_history', 'history_compare'] as const)
        expect(locale.agent.tool[name]).toBeTruthy();
  });
});
