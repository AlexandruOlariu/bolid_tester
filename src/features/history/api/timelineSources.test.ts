/** Timeline adapters (plan 16): one fixture per store shape, the tone rules, the scan compare link
 *  and the trip / maintenance titles. The persisted stores' file layer is mocked (the adapters only
 *  import their types and key helpers). */
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: null,
  cacheDirectory: null,
  getInfoAsync: jest.fn(async () => ({ exists: false })),
  readAsStringAsync: jest.fn(async () => ''),
  writeAsStringAsync: jest.fn(async () => undefined),
  deleteAsync: jest.fn(async () => undefined),
}));

import { DEFAULT_SERVICE_ITEMS, type AiReport } from '@/shared/obd-core';
import type {
  AiHistoryEntry,
  DtcHistoryEntry,
  HistoryVehicle,
  ReportHistoryEntry,
} from '@/shared/state/historyStore';
import type { SavedScan, SavedScanModule } from '@/features/module-scan/model/scanHistoryStore';
import type { TripSummary } from '@/features/trip-recording/model/tripStore';
import type { CarBackup } from '@/features/coding/api/carBackup';
import {
  formatDuration,
  fromBackups,
  fromHistory,
  fromMaintenance,
  fromScans,
  fromTrips,
  MAX_TIMELINE_TRIPS,
} from './timelineSources';

const GOLF: HistoryVehicle = {
  id: 'golf-plus-2009-20tdi',
  label: 'VW Golf Plus',
  vin: 'WVWZZZ1KZ9W903398',
};
const PUNTO: HistoryVehicle = { id: 'fiat-punto-2008-12', label: 'Fiat Punto', vin: null };
const T = Date.UTC(2026, 10, 9, 8);

const report: AiReport = {
  overall: 'urgent',
  summary: 'Boost pressure is low.\nCheck the vacuum lines.',
  findings: [],
  actions: [],
  source: 'local',
  disclaimer: 'Not a substitute for a mechanic.',
};

function ai(overall: AiReport['overall']): AiHistoryEntry {
  return {
    kind: 'ai',
    id: `ai-${overall}`,
    ts: T,
    vehicle: GOLF,
    source: 'local',
    overall,
    summary: report.summary,
    findingCount: 0,
    report: { ...report, overall },
  };
}

function dtc(milOn: boolean | null, stored: number, pending = 0): DtcHistoryEntry {
  const code = (n: number) => ({ code: `P0${100 + n}`, description: 'x' });
  return {
    kind: 'dtc',
    id: `dtc-${String(milOn)}-${stored}-${pending}`,
    ts: T,
    vehicle: PUNTO,
    milOn,
    stored: Array.from({ length: stored }, (_, i) => code(i)),
    pending: Array.from({ length: pending }, (_, i) => code(50 + i)),
    permanent: [],
    monitorsComplete: null,
    monitorsTotal: null,
  };
}

const reportEntry: ReportHistoryEntry = {
  kind: 'report',
  id: 'rep-1',
  ts: T,
  vehicle: GOLF,
  sections: ['faults', 'scan'],
  format: 'pdf',
  fileName: 'bolid-report.pdf',
};

describe('fromHistory', () => {
  it('AI runs: title by verdict, first summary line, tone by verdict', () => {
    const [urgent, attention, ok] = fromHistory([ai('urgent'), ai('attention'), ai('ok')]);
    expect(urgent).toMatchObject({
      id: 'ai:ai-urgent',
      kind: 'ai',
      sourceId: 'ai-urgent',
      title: 'AI diagnosis · urgent',
      subtitle: 'Boost pressure is low.',
      tone: 'bad',
      vehicleKey: 'vin:WVWZZZ1KZ9W903398',
      vehicleLabel: 'VW Golf Plus ·03398',
    });
    expect(urgent.link).toBeUndefined();
    expect(attention.tone).toBe('warn');
    expect(ok).toMatchObject({ title: 'AI diagnosis · healthy', tone: 'ok' });
  });

  it('fault-code checks: MIL on → bad, codes → warn, clean → ok', () => {
    const [mil, codes, clean] = fromHistory([dtc(true, 1), dtc(false, 0, 2), dtc(false, 0)]);
    expect(mil).toMatchObject({
      title: 'Fault-code check',
      subtitle: '1 stored · 0 pending · MIL on',
      tone: 'bad',
      vehicleKey: 'id:fiat-punto-2008-12',
      vehicleLabel: 'Fiat Punto',
    });
    expect(codes).toMatchObject({ subtitle: '0 stored · 2 pending · MIL off', tone: 'warn' });
    expect(clean.tone).toBe('ok');
    expect(mil.link).toBeUndefined();
  });

  it('a fault-code check without a MIL reading leaves the MIL out', () => {
    const [unknown] = fromHistory([dtc(null, 0)]);
    expect(unknown.subtitle).toBe('0 stored · 0 pending');
  });

  it('reports: format in the title, section titles joined', () => {
    const [r] = fromHistory([reportEntry]);
    expect(r).toMatchObject({
      id: 'report:rep-1',
      kind: 'report',
      title: 'Report (PDF)',
      subtitle: 'Fault codes & readiness · Module scan',
      tone: 'neutral',
    });
    expect(fromHistory([{ ...reportEntry, sections: [], format: 'md' }])[0]).toMatchObject({
      title: 'Report (Markdown)',
      subtitle: 'Identity only',
    });
  });
});

function mod(
  address: string,
  faults: number,
  state: SavedScanModule['state'] = 'ok',
): SavedScanModule {
  return {
    address,
    name: `Module ${address}`,
    state,
    dtcs: Array.from({ length: faults }, (_, i) => ({
      sae: `P0${300 + i}`,
      display: `P0${300 + i} 00`,
      vagCode: '',
      description: 'Misfire',
      status: 0x09,
    })),
  };
}

function scan(
  id: string,
  ts: number,
  vehicle: HistoryVehicle,
  modules: SavedScanModule[],
): SavedScan {
  return { id, ts, vehicle, protocol: 'ISO 15765-4 CAN (11-bit, 500 kbps)', modules, tp20: null };
}

describe('fromScans', () => {
  // Newest first, as the store keeps them: Golf (s3), Punto (s2), Golf (s1).
  const scans = [
    scan('s3', T + 3, GOLF, [mod('01', 0), mod('17', 0, 'silent')]),
    scan('s2', T + 2, PUNTO, [mod('01', 1)]),
    scan('s1', T + 1, GOLF, [mod('01', 2), mod('17', 1)]),
  ];

  it('links to the compare with the previous scan of the same car as "before"', () => {
    const [s3, s2, s1] = fromScans(scans);
    expect(s3.link).toEqual({ route: '/module-scan', params: { after: 's3', before: 's1' } });
    // The Punto's only scan and the Golf's first scan have no baseline.
    expect(s2.link).toEqual({ route: '/module-scan', params: { after: 's2' } });
    expect(s1.link).toEqual({ route: '/module-scan', params: { after: 's1' } });
  });

  it('title counts faults, subtitle counts answering modules, tone warns on faults', () => {
    const [s3, s2, s1] = fromScans(scans);
    expect(s3).toMatchObject({
      title: 'Auto-scan · 0 faults',
      subtitle: '1/2 modules answered',
      tone: 'ok',
    });
    expect(s2).toMatchObject({ title: 'Auto-scan · 1 fault', tone: 'warn' });
    expect(s1).toMatchObject({ title: 'Auto-scan · 3 faults', subtitle: '2/2 modules answered' });
  });

  it('counts the TP2.0 modules and faults of a pre-UDS car', () => {
    const [s] = fromScans([
      {
        ...scan('k', T, GOLF, []),
        tp20: {
          installed: [0x01, 0x17],
          modules: [
            { address: 0x01, name: 'Engine', state: 'ok', dtcs: [{ vag: '16486', status: 0x23 }] },
            { address: 0x17, name: 'Instruments', state: 'silent' },
          ],
        },
      },
    ]);
    expect(s).toMatchObject({ title: 'Auto-scan · 1 fault', subtitle: '1/2 modules answered' });
  });

  it('leaves the UDS-skipped copies of TP2.0 modules and unfitted modules out of the total', () => {
    const [s] = fromScans([
      {
        // A full scan of a pre-UDS car: the TP2.0 modules also come back as skipped UDS results.
        ...scan('k', T, GOLF, [mod('01', 0, 'skipped'), mod('17', 0, 'skipped'), mod('19', 0)]),
        tp20: {
          installed: [0x01, 0x17],
          modules: [
            { address: 0x01, name: 'Engine', state: 'ok' },
            { address: 0x17, name: 'Instruments', state: 'refused' },
            { address: 0x25, name: 'Immobilizer', state: 'not-installed' },
          ],
        },
      },
    ]);
    expect(s.subtitle).toBe('3/3 modules answered');
  });
});

function trip(
  id: string,
  distanceKm: number | null,
  extra: Partial<TripSummary> = {},
): TripSummary {
  return {
    header: {
      id,
      startedAt: T,
      endedAt: T + 754_000,
      profileId: 'golf-plus-2009-20tdi',
      vin: null,
      protocol: 'AUTO',
    },
    stats: { durationMs: 754_000, sampleCount: 377, distanceKm, max: {} },
    markerCount: 0,
    vehicleId: 'golf-plus-2009-20tdi',
    ...extra,
  };
}

describe('fromTrips', () => {
  const labelFor = (carId: string) => (carId === 'golf-plus-2009-20tdi' ? 'VW Golf Plus' : carId);

  it('title uses stats.distanceKm with one decimal and km; links to the trip detail', () => {
    const [t] = fromTrips([trip('t1', 23.4567)], labelFor);
    expect(t).toMatchObject({
      id: 'trip:t1',
      kind: 'trip',
      ts: T,
      title: 'Trip · 23.5 km',
      subtitle: '13 min · 377 samples',
      tone: 'neutral',
      vehicleKey: 'id:golf-plus-2009-20tdi',
      vehicleLabel: 'VW Golf Plus',
      link: { route: '/trip-detail', params: { id: 't1' } },
    });
  });

  it('falls back to the GPS distance, marks GPS trips, and reads "Trip" without any distance', () => {
    const gps = {
      distanceKm: 4.04,
      avgSpeedKmh: 30,
      obdAvgSpeedKmh: null,
      speedDeltaKmh: null,
      points: 50,
    };
    const [withGps] = fromTrips(
      [trip('g', null, { stats: { ...trip('g', null).stats, gps } })],
      labelFor,
    );
    expect(withGps.title).toBe('Trip · 4.0 km');
    expect(withGps.subtitle).toBe('13 min · 377 samples · GPS');
    expect(fromTrips([trip('n', null)], labelFor)[0].title).toBe('Trip');
  });

  it('keys a trip by its VIN when the header has one, by the car id otherwise', () => {
    const [vin] = fromTrips(
      [trip('v', 1, { header: { ...trip('v', 1).header, vin: 'WVWZZZ1KZ9W903398' } })],
      labelFor,
    );
    expect(vin.vehicleKey).toBe('vin:WVWZZZ1KZ9W903398');
    // A pre-garage trip (no vehicleId) groups by the header's profile id.
    const [old] = fromTrips([trip('o', 1, { vehicleId: undefined })], labelFor);
    expect(old.vehicleKey).toBe('id:golf-plus-2009-20tdi');
  });

  it(`reads at most the newest ${MAX_TIMELINE_TRIPS} trips`, () => {
    const many = Array.from({ length: MAX_TIMELINE_TRIPS + 5 }, (_, i) => trip(`t${i}`, 1));
    const out = fromTrips(many, labelFor);
    expect(out).toHaveLength(MAX_TIMELINE_TRIPS);
    expect(out[0].sourceId).toBe('t0');
  });
});

describe('fromMaintenance', () => {
  it('resolves itemId to the service name; unknown items read "Service"', () => {
    const out = fromMaintenance(
      [
        {
          id: 'm1',
          itemId: 'engine-oil',
          date: T,
          odoKm: 182000,
          note: 'Castrol 5W-30\nreceipt in glovebox',
        },
        { id: 'm2', itemId: 'no-such-item', date: T - 1, odoKm: 181500 },
      ],
      DEFAULT_SERVICE_ITEMS,
      GOLF,
    );
    expect(out[0]).toMatchObject({
      id: 'maintenance:m1',
      kind: 'maintenance',
      ts: T,
      title: 'Service: Engine oil & filter',
      subtitle: '182000 km · Castrol 5W-30',
      tone: 'ok',
      vehicleKey: 'vin:WVWZZZ1KZ9W903398',
      link: { route: '/maintenance' },
    });
    expect(out[1]).toMatchObject({ title: 'Service', subtitle: '181500 km' });
  });
});

describe('fromBackups', () => {
  it('lists coding backups with their module count and links to Coding', () => {
    const backup: CarBackup = {
      id: 'b1',
      ts: T,
      vehicle: GOLF,
      protocol: 'CAN',
      modules: [
        { reqHeader: '7E0', name: 'Engine', coding: null, adaptations: [] },
        { reqHeader: '714', name: 'Instruments', coding: null, adaptations: [] },
      ],
    };
    expect(fromBackups([backup])[0]).toMatchObject({
      id: 'backup:b1',
      kind: 'backup',
      title: 'Coding backup',
      subtitle: '2 modules',
      tone: 'neutral',
      link: { route: '/coding' },
    });
  });
});

describe('formatDuration', () => {
  it('reads seconds, minutes, then hours', () => {
    expect(formatDuration(45_000)).toBe('45 s');
    expect(formatDuration(12 * 60_000)).toBe('12 min');
    expect(formatDuration(65 * 60_000)).toBe('1 h 05 min');
  });
});
