/** The performance-tests agent tool (plan 34b): `read_performance_history` reports this app
 *  session's runs (they are not saved) for the active car only. */
// The garage / vehicle stores persist through the file storage; a no-op file system keeps them in
// memory.
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: null,
  cacheDirectory: null,
  getInfoAsync: jest.fn(async () => ({ exists: false })),
  readAsStringAsync: jest.fn(async () => ''),
  writeAsStringAsync: jest.fn(async () => undefined),
  deleteAsync: jest.fn(async () => undefined),
}));

import { buildAgentRegistry, parseSkillFile } from '@/shared/obd-core';
import type { AgentContribution, AgentTool, ReadOnlySession, ToolContext } from '@/shared/obd-core';
import { useGarageStore } from '@/shared/state/garageStore';
import { useVehicleStore } from '@/shared/state/vehicleStore';
import { getVehicleProfile } from '@/shared/vehicles';
import en from '@/shared/i18n/locales/en/performanceTests.json';
import ro from '@/shared/i18n/locales/ro/performanceTests.json';
import { usePerformanceStore, type PerfRun } from '../model/performanceStore';
import { agentTools as perfTools } from './agentTools';
import performanceHistorySkill from './performance_history.skill.json';

const GOLF = 'golf-plus-2009-20tdi';
const golf = getVehicleProfile(GOLF);

const golfCtx: ToolContext = {
  session: {} as ReadOnlySession,
  profile: golf,
  guideProfileId: golf.id,
  vehicle: { label: golf.name, make: golf.make },
  vin: null,
  now: () => 0,
  sleep: async () => undefined,
  signal: new AbortController().signal,
  askDriver: async () => ({ kind: 'done' }),
};

function toolOf(c: AgentContribution, name: string): AgentTool {
  const t = c.tools?.find((x) => x.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return t;
}

const AT = new Date(2026, 10, 20, 9, 5).getTime();

const accel: PerfRun = {
  id: 'a',
  type: 'accel',
  at: AT,
  samples: [],
  vehicleId: GOLF,
  accel: {
    targetKmh: 100,
    timeMs: 9840,
    splits: [
      { fromKmh: 0, toKmh: 50, timeMs: 3920 },
      { fromKmh: 50, toKmh: 100, timeMs: 5920 },
    ],
    maxKmh: 104,
    sampleRateHz: 9.6,
  },
};
const drag: PerfRun = {
  id: 'd',
  type: 'drag',
  at: AT,
  samples: [],
  vehicleId: GOLF,
  drag: {
    sixtyFtMs: 2310,
    eighthMile: { timeMs: 10_120, trapKmh: 112.4 },
    quarterMile: null,
  },
};
const brake: PerfRun = {
  id: 'b',
  type: 'brake',
  at: AT,
  samples: [],
  vehicleId: GOLF,
  brake: { fromKmh: 100, toKmh: 0, timeMs: 3150, distanceM: 41.26 },
};

const run = () => toolOf(perfTools, 'read_performance_history').run({}, golfCtx);

beforeEach(() => {
  usePerformanceStore.setState({ history: [] });
  useGarageStore.setState({ vehicles: [] });
  useVehicleStore.setState({ selectedProfileId: GOLF });
});

describe('read_performance_history', () => {
  it('performance history says it is session-only', async () =>
    expect((await toolOf(perfTools, 'read_performance_history').run({}, golfCtx)).digest).toMatch(
      /^Runs from this app session only/,
    ));

  it('says when this session has no runs', async () => {
    const r = await run();
    expect(r.digest).toBe(
      'Runs from this app session only (they are not saved).\nNo performance runs for this car yet.',
    );
    expect(r.summary).toBe('Performance runs: none');
  });

  it('lists 0–100 km/h, drag and braking results with dates, newest first', async () => {
    usePerformanceStore.setState({ history: [brake, drag, accel] });
    const r = await run();
    expect(r.digest.split('\n')).toEqual([
      'Runs from this app session only (they are not saved).',
      '2026-11-20 09:05 braking 100–0 km/h: 3.15 s over 41.3 m',
      '2026-11-20 09:05 drag: 60 ft 2.31 s, 1/8 mile 10.12 s at 112 km/h, 1/4 mile not reached',
      '2026-11-20 09:05 0–100 km/h: 9.84 s (0–50 3.92 s, 50–100 5.92 s), max 104 km/h, 9.6 Hz',
    ]);
    expect(r.summary).toBe('Performance runs: 3');
  });

  it('a run that did not reach its target says so', async () => {
    usePerformanceStore.setState({
      history: [
        { ...accel, accel: { ...accel.accel!, timeMs: null, splits: [], maxKmh: 87 } },
        { ...brake, brake: { fromKmh: 100, toKmh: 0, timeMs: null, distanceM: null } },
      ],
    });
    expect((await run()).digest.split('\n').slice(1)).toEqual([
      '2026-11-20 09:05 0–100 km/h: not reached, max 87 km/h, 9.6 Hz',
      '2026-11-20 09:05 braking 100–0 km/h: not measured',
    ]);
  });

  it("reports only the active car's runs", async () => {
    usePerformanceStore.setState({
      history: [{ ...brake, vehicleId: 'fiat-punto-2008-12' }, accel],
    });
    const lines = (await run()).digest.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatch(/0–100 km\/h/);
  });

  it('is always offered, uses no adapter time and has en and ro labels', () => {
    const t = toolOf(perfTools, 'read_performance_history');
    expect(
      t.available({
        profile: getVehicleProfile('passat-b55-19tdi'),
        protocol: 'ISO_14230_4_KWP_FAST',
        supportedPids: [],
        canMonitor: false,
      }),
    ).toBe(true);
    expect(t.costMs).toBe(0);
    expect(t.labelKey).toBe('performanceTests:agent.tool.read_performance_history');
    for (const locale of [en, ro]) expect(locale.agent.tool.read_performance_history).toBeTruthy();
  });

  it('bundles a performance_history skill that parses and registers', () => {
    expect(parseSkillFile(performanceHistorySkill).ok).toBe(true);
    expect(perfTools.skills?.[0]).toMatchObject({
      name: 'performance_history',
      kind: 'capability',
      tools: ['read_performance_history'],
    });
    expect(() => buildAgentRegistry([perfTools])).not.toThrow();
  });
});
