/** The maintenance agent tool (plan 34b): `read_maintenance` reports the active car's service items
 *  (status, last done, due in km / days) with an `overdue` / `soon` finding per item, and the
 *  `maintenance` procedure runs it. The persist storage runs over a no-op file system. */
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: null,
  cacheDirectory: null,
  getInfoAsync: jest.fn(async () => ({ exists: false })),
  readAsStringAsync: jest.fn(async () => ''),
  writeAsStringAsync: jest.fn(async () => undefined),
  deleteAsync: jest.fn(async () => undefined),
}));

import { buildAgentRegistry, parseSkillFile } from '@/shared/obd-core';
import type {
  AgentContribution,
  AgentTool,
  LogEntry,
  ProcedureContext,
  ReadOnlySession,
  ToolContext,
} from '@/shared/obd-core';
import { useGarageStore } from '@/shared/state/garageStore';
import { useVehicleStore } from '@/shared/state/vehicleStore';
import { getVehicleProfile } from '@/shared/vehicles';
import en from '@/shared/i18n/locales/en/maintenance.json';
import ro from '@/shared/i18n/locales/ro/maintenance.json';
import { DEFAULT_KM_PER_YEAR, useMaintenanceStore } from '../model/maintenanceStore';
import { agentTools as maintTools } from './agentTools';
import maintenanceSkill from './maintenance.skill.json';

const GOLF = 'golf-plus-2009-20tdi';
const PUNTO = 'fiat-punto-2008-12';
const golf = getVehicleProfile(GOLF);
const DAY_MS = 86_400_000;
/** "Now" for every run: 2026-11-20 12:00 local. */
const NOW = new Date(2026, 10, 20, 12, 0).getTime();

const golfCtx: ToolContext = {
  session: {} as ReadOnlySession,
  profile: golf,
  guideProfileId: golf.id,
  vehicle: { label: golf.name, make: golf.make },
  vin: null,
  now: () => NOW,
  sleep: async () => undefined,
  signal: new AbortController().signal,
  askDriver: async () => ({ kind: 'done' }),
};

function toolOf(c: AgentContribution, name: string): AgentTool {
  const t = c.tools?.find((x) => x.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return t;
}

interface Logbook {
  odoKm: number | null;
  entries: Omit<LogEntry, 'id'>[];
}

/** Engine oil done 400 days and 20 000 km ago (interval 15 000 km / 12 months): overdue. */
const overdueOilChange: Logbook = {
  odoKm: 190_000,
  entries: [{ itemId: 'engine-oil', date: NOW - 400 * DAY_MS, odoKm: 170_000 }],
};

/** Engine oil done 30 days and 1 000 km ago: ok. */
const allOk: Logbook = {
  odoKm: 101_000,
  entries: [{ itemId: 'engine-oil', date: NOW - 30 * DAY_MS, odoKm: 100_000 }],
};

/** Store the logbook under the car's maintenance bucket (`id:<profile id>` for a registry car). */
function seedMaintenance(carId: string, book: Logbook): void {
  useMaintenanceStore.setState((s) => ({
    byVehicle: {
      ...s.byVehicle,
      [`id:${carId}`]: {
        odoKm: book.odoKm,
        kmPerYear: DEFAULT_KM_PER_YEAR,
        entries: book.entries.map((e, i) => ({ id: `${carId}-${i}`, ...e })),
      },
    },
  }));
}

beforeEach(() => {
  useMaintenanceStore.setState({ byVehicle: {} });
  useGarageStore.setState({ vehicles: [] });
  useVehicleStore.setState({ selectedProfileId: GOLF });
});

describe('read_maintenance', () => {
  it('maintenance reports an overdue item for the active car only', async () => {
    seedMaintenance('golf-plus-2009-20tdi', overdueOilChange);
    seedMaintenance('fiat-punto-2008-12', allOk);
    const r = await toolOf(maintTools, 'read_maintenance').run({}, golfCtx);
    expect(r.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'maintenance:agent.finding.overdue' }),
      ]),
    );
  });

  it('formats each item with status, last done, interval and what is left', async () => {
    seedMaintenance(GOLF, overdueOilChange);
    const r = await toolOf(maintTools, 'read_maintenance').run({}, golfCtx);
    const lines = r.digest.split('\n');
    expect(lines[0]).toBe('Odometer: 190000 km (as entered in the logbook)');
    expect(lines[1]).toBe(
      'Engine oil & filter (every 15000 km / 12 months): overdue, last 2025-10-16 at 170000 km; ' +
        '5000 km overdue, 40 days overdue',
    );
    expect(lines).toContain('Air filter (every 60000 km / 48 months): unknown, never logged');
    expect(r.findings).toEqual([
      {
        key: 'maintenance:agent.finding.overdue',
        severity: 'warn',
        values: { item: 'Engine oil & filter' },
      },
    ]);
    expect(r.summary).toBe('Maintenance: 1 overdue, 0 soon');
  });

  it('flags an item due soon as info and lists the worst first', async () => {
    seedMaintenance(GOLF, {
      odoKm: 129_000,
      entries: [
        { itemId: 'engine-oil', date: NOW - 30 * DAY_MS, odoKm: 128_000 },
        { itemId: 'timing-belt', date: NOW - 2000 * DAY_MS, odoKm: 10_000 },
      ],
    });
    const r = await toolOf(maintTools, 'read_maintenance').run({}, golfCtx);
    const lines = r.digest.split('\n');
    expect(lines[1]).toBe(
      'Timing belt + water pump (every 120000 km / 120 months): soon, last 2021-05-30 at ' +
        '10000 km; 1000 km left, 1600 days left',
    );
    expect(lines[2]).toMatch(/^Engine oil & filter .*: ok, .*14000 km left, 330 days left$/);
    expect(r.findings).toEqual([
      {
        key: 'maintenance:agent.finding.soon',
        severity: 'info',
        values: { item: 'Timing belt + water pump' },
      },
    ]);
  });

  it('says the km left are unknown without an odometer reading', async () => {
    seedMaintenance(GOLF, { odoKm: null, entries: overdueOilChange.entries });
    const lines = (await toolOf(maintTools, 'read_maintenance').run({}, golfCtx)).digest.split(
      '\n',
    );
    expect(lines[0]).toBe('Odometer: not entered, so the km left are unknown');
    expect(lines[1]).toMatch(/: overdue, last .* at 170000 km; 40 days overdue$/);
  });

  it('is empty-safe: a car with no logbook says so in one line', async () => {
    seedMaintenance(PUNTO, allOk);
    const r = await toolOf(maintTools, 'read_maintenance').run({}, golfCtx);
    expect(r.digest).toBe('No maintenance recorded for this car.');
    expect(r.findings).toBeUndefined();
  });

  it("follows the garage selection: after a switch it reads only the new car's logbook", async () => {
    seedMaintenance(GOLF, overdueOilChange);
    useGarageStore.setState({
      vehicles: [
        {
          id: 'user:abc',
          name: 'Skoda Octavia 2012',
          fuel: 'diesel',
          baseProfileId: 'generic',
          createdAt: 0,
          updatedAt: 0,
        },
      ],
    });
    useVehicleStore.setState({ selectedProfileId: 'user:abc' });
    expect((await toolOf(maintTools, 'read_maintenance').run({}, golfCtx)).digest).toBe(
      'No maintenance recorded for this car.',
    );
    seedMaintenance('user:abc', allOk);
    const r = await toolOf(maintTools, 'read_maintenance').run({}, golfCtx);
    expect(r.digest).toContain('Odometer: 101000 km');
    expect(r.findings).toBeUndefined();
  });
});

describe('maintenance contribution', () => {
  it('the maintenance procedure calls read_maintenance', async () => {
    const proc = maintTools.procedures?.find((p) => p.id === 'maintenance');
    expect(proc).toBeDefined();
    const callTool = jest.fn(async () => ({ digest: 'd', summary: 's' }));
    const ctx = { ...golfCtx, callTool, runProcedure: jest.fn() } as unknown as ProcedureContext;
    await proc?.run(ctx);
    expect(callTool).toHaveBeenCalledWith('read_maintenance', {});
  });

  it('declares the tool always offered and free of adapter time', () => {
    const t = toolOf(maintTools, 'read_maintenance');
    expect(
      t.available({
        profile: getVehicleProfile('passat-b55-19tdi'),
        protocol: 'ISO_14230_4_KWP_FAST',
        supportedPids: [],
        canMonitor: false,
      }),
    ).toBe(true);
    expect(t.costMs).toBe(0);
    expect(t.labelKey).toBe('maintenance:agent.tool.read_maintenance');
  });

  it('bundles a maintenance skill that parses, names its procedure and registers', () => {
    expect(parseSkillFile(maintenanceSkill).ok).toBe(true);
    expect(maintTools.skills?.map((s) => s.name)).toEqual(['maintenance']);
    expect(maintTools.skills?.[0]).toMatchObject({
      tools: ['read_maintenance'],
      procedure: 'maintenance',
    });
    expect(() => buildAgentRegistry([maintTools])).not.toThrow();
  });

  it('the tool label and both findings have en and ro text', () => {
    for (const locale of [en, ro]) {
      expect(locale.agent.tool.read_maintenance).toBeTruthy();
      for (const id of ['overdue', 'soon'] as const) {
        expect(locale.agent.finding[id].title).toContain('{{item}}');
        expect(locale.agent.finding[id].detail).toBeTruthy();
      }
    }
  });
});
