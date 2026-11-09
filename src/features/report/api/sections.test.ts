/** The report's section mappers (plan 15). historyStore's persist layer pulls in expo-file-system,
 *  mocked to a no-op file system as in historyStore.test.ts. */
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: '/tmp/bolid-test/',
  cacheDirectory: '/tmp/bolid-test/',
  getInfoAsync: jest.fn(async () => ({ exists: false })),
  readAsStringAsync: jest.fn(async () => ''),
  writeAsStringAsync: jest.fn(async () => undefined),
  deleteAsync: jest.fn(async () => undefined),
}));

import { DEFAULT_SERVICE_ITEMS, type AiReport, type InspectionReport } from '@/shared/obd-core';
import type { SessionInfo } from '@/shared/obd-core/session/DiagnosticSession';
import type { HistoryEntry } from '@/shared/state/historyStore';
import { getVehicleProfile } from '@/shared/vehicles';
import { formatAutoScanReport } from '@/features/module-scan/api/scanReport';
import type { SavedScan } from '@/features/module-scan/model/scanHistoryStore';
import {
  aiFrom,
  availableSections,
  batteryFrom,
  belongsToCar,
  collectReportSources,
  faultsFromStores,
  identityFrom,
  inspectionFrom,
  maintenanceFrom,
  scanFromSaved,
  type ReportStoreSnapshot,
} from './sections';

const T = Date.UTC(2026, 10, 9, 8, 0);
const DAY = 24 * 60 * 60 * 1000;
const GOLF = 'golf-plus-2009-20tdi';
const VIN = 'WVWZZZ1KZ9W903398';

const scanFixture: SavedScan = {
  id: 'scan-1',
  ts: T,
  vehicle: { id: GOLF, label: 'VW Golf Plus', vin: VIN },
  protocol: 'ISO 15765-4 CAN (11-bit, 500 kbps)',
  modules: [
    {
      address: '01',
      name: 'Engine (EDC17)',
      state: 'ok',
      partNumber: '03L906022LM',
      dtcs: [
        { sae: 'P2183', display: 'P2183 00', vagCode: '08579', description: 'ECT 2', status: 0x09 },
        { sae: 'P0121', display: 'P0121 00', vagCode: '00289', description: 'TPS', status: 0x04 },
      ],
    },
    {
      address: '03',
      name: 'ABS/ESP',
      state: 'ok',
      dtcs: [{ sae: 'C0130', display: 'C0130 00', vagCode: '', description: 'Pump', status: 0x88 }],
    },
    { address: '17', name: 'Instrument cluster', state: 'ok', dtcs: [] },
    { address: '15', name: 'Airbag', state: 'silent', dtcs: [] },
    { address: '09', name: 'Central electrics', state: 'error', reason: 'timeout', dtcs: [] },
  ],
  tp20: {
    installed: [0x46],
    modules: [
      {
        address: 0x46,
        name: 'Comfort',
        state: 'ok',
        ident: '1K0959433',
        dtcs: [{ vag: '00928', status: 0x22 }],
      },
    ],
  },
};

const info: SessionInfo = {
  protocol: 'ISO_15765_4_CAN_11_500',
  voltage: 14.2,
  version: 'ELM327 v1.5',
  supportedPids: ['010C', '010D', '0105'],
  vin: VIN,
  calibrationId: 'CAL123',
};

describe('scanFromSaved', () => {
  it("counts answered / with-faults / total faults exactly like formatAutoScanReport's header", () => {
    const s = scanFromSaved(scanFixture);
    const header = formatAutoScanReport(scanFixture);
    expect(header).toContain(
      `Modules: ${scanFixture.modules.length} declared, ${s.answered} answered, ` +
        `${s.withFaults} with faults, ${s.totalFaults} faults total`,
    );
    expect([s.answered, s.withFaults, s.totalFaults]).toEqual([3, 2, 3]);
  });

  it('keeps every UDS module in order with status text, and the TP2.0 modules separately', () => {
    const s = scanFromSaved(scanFixture);
    expect(s.modules.map((m) => m.address)).toEqual(['01', '03', '17', '15', '09']);
    expect(s.modules[0].faults[0]).toEqual({
      display: 'P2183 00',
      vagCode: '08579',
      description: 'ECT 2',
      statusText: 'confirmed, failing now',
    });
    expect(s.modules[3]).toMatchObject({ state: 'silent', faults: [] });
    expect(s.preUds).toHaveLength(1);
    expect(s.preUds[0]).toMatchObject({ address: '46', name: 'Comfort', state: 'answered' });
    expect(s.preUds[0].faults[0]).toMatchObject({ vagCode: '00928', statusText: 'status 0x22' });
  });
});

describe('maintenanceFrom', () => {
  it('sorts the due list worst-first (overdue → soon → ok → no record)', () => {
    const entries = [
      // oil: 400 days ago → overdue (12-month interval)
      { id: 'a', itemId: 'engine-oil', date: T - 400 * DAY, odoKm: 170000 },
      // cabin filter: 345 days ago → due within 30 days → soon
      { id: 'b', itemId: 'cabin-filter', date: T - 345 * DAY, odoKm: 179000 },
      // air filter: recent → ok
      { id: 'c', itemId: 'air-filter', date: T - 30 * DAY, odoKm: 179500 },
    ];
    const m = maintenanceFrom(DEFAULT_SERVICE_ITEMS, entries, 180000, T);
    expect(m).not.toBeNull();
    const statuses = (m?.due ?? []).map((d) => d.status);
    expect(statuses.slice(0, 3)).toEqual(['overdue', 'soon', 'ok']);
    expect(statuses.slice(3).every((s) => s === 'unknown')).toBe(true);
    expect(m?.due[0].name).toBe('Engine oil & filter');
    expect(m?.odoKm).toBe(180000);
  });

  it('is null for an empty logbook', () => {
    expect(maintenanceFrom(DEFAULT_SERVICE_ITEMS, [], 180000, T)).toBeNull();
  });
});

describe('faultsFromStores', () => {
  it('mirrors the live read: readiness counts, every frame, protocol label, adapter', () => {
    const r = faultsFromStores(
      {
        stored: [{ code: 'P0299', description: 'Underboost' }],
        pending: [],
        permanent: [],
        readiness: {
          milOn: true,
          dtcCount: 1,
          ignition: 'compression',
          monitors: [
            { id: 'misfire', name: 'Misfire', supported: true, complete: true },
            { id: 'egr', name: 'EGR', supported: true, complete: false },
            { id: 'cat', name: 'Catalyst', supported: false, complete: false },
          ],
        } as never,
        freezeFrames: [
          {
            triggerDtc: 'P0299',
            values: [{ pid: '010C', name: 'RPM', value: 2200, unit: 'rpm' }] as never,
          },
        ],
      },
      info,
      'Golf',
      { ts: T, adapter: 'Simulator' },
    );
    expect(r).toMatchObject({
      ts: T,
      vehicleLabel: 'Golf',
      vin: VIN,
      protocol: 'ISO 15765-4 CAN (11-bit, 500 kbps)',
      voltage: 14.2,
      adapter: 'Simulator',
      milOn: true,
      monitorsComplete: 1,
      monitorsTotal: 2,
      notReady: ['EGR'],
    });
    expect(r.freezeFrames).toEqual([
      { triggerDtc: 'P0299', values: [{ name: 'RPM', value: 2200, unit: 'rpm' }] },
    ]);
  });
});

describe('simple mappers', () => {
  it('inspection / battery / AI keep their verdicts and stamp the run time', () => {
    const insp: InspectionReport = {
      verdict: 'caution',
      score: 70,
      checks: [{ id: 'mil', label: 'MIL', status: 'warn', detail: 'on' }],
    };
    expect(inspectionFrom(insp, T)).toEqual({
      ts: T,
      verdict: 'caution',
      score: 70,
      checks: [{ label: 'MIL', status: 'warn', detail: 'on' }],
    });
    expect(inspectionFrom(null, T)).toBeNull();
    expect(
      batteryFrom(
        {
          restingV: 12.4,
          crankingDipV: null,
          chargingV: 14,
          socPct: 75,
          verdict: 'fair',
          notes: [],
        },
        null,
      ),
    ).toMatchObject({ ts: null, verdict: 'fair', restingV: 12.4 });
    const ai = {
      overall: 'attention',
      summary: 's',
      findings: [{ title: 't', severity: 'warn', detail: 'd', codes: ['P0299'] }],
      actions: [],
      source: 'local',
      disclaimer: 'x',
    } as AiReport;
    expect(aiFrom(ai, T)).toMatchObject({ ts: T, overall: 'attention', source: 'local' });
  });
});

describe('identityFrom', () => {
  const golf = getVehicleProfile(GOLF);

  it('connected: session info, protocol label and a decoded VIN', () => {
    const id = identityFrom(golf, info, 'Simulator · golf');
    expect(id).toMatchObject({
      vin: VIN,
      profileId: GOLF,
      protocol: 'ISO 15765-4 CAN (11-bit, 500 kbps)',
      adapter: 'Simulator · golf',
      elmVersion: 'ELM327 v1.5',
      voltage: 14.2,
      supportedPidCount: 3,
      calibrationId: 'CAL123',
      connected: true,
    });
    expect(id.vinDecoded?.manufacturer).toMatch(/Volkswagen/);
  });

  it('offline: VIN and protocol from the fallback, marked as the last connection', () => {
    const id = identityFrom(golf, null, null, { vin: VIN, protocol: 'CAN', lastSeenAt: T });
    expect(id).toMatchObject({
      vin: VIN,
      protocol: 'CAN',
      connected: false,
      lastSeenAt: T,
      voltage: null,
      supportedPidCount: null,
    });
  });
});

describe('belongsToCar', () => {
  it('matches by VIN when both sides know it, else by profile id', () => {
    expect(belongsToCar({ id: 'x', label: '', vin: VIN }, GOLF, VIN)).toBe(true);
    expect(belongsToCar({ id: GOLF, label: '', vin: 'OTHERVIN000000000' }, GOLF, VIN)).toBe(false);
    expect(belongsToCar({ id: GOLF, label: '', vin: null }, GOLF, VIN)).toBe(true);
    expect(belongsToCar({ id: 'punto', label: '', vin: null }, GOLF, null)).toBe(false);
  });
});

describe('collectReportSources', () => {
  const GOLF_CAR = { id: GOLF, label: 'Golf', vin: VIN };
  const PUNTO_CAR = { id: 'user:punto', label: 'My Punto', vin: null };
  const golfHistory: HistoryEntry[] = [
    {
      kind: 'dtc',
      id: 'golf-dtc',
      ts: T - 5,
      vehicle: GOLF_CAR,
      milOn: true,
      stored: [{ code: 'P0299', description: 'Underboost' }],
      pending: [],
      permanent: [],
      monitorsComplete: 5,
      monitorsTotal: 7,
    },
  ];
  const aiReport = {
    overall: 'attention',
    summary: 'boost leak',
    findings: [],
    actions: [],
    source: 'local',
    disclaimer: 'x',
  } as AiReport;
  const inspectionReport = {
    verdict: 'caution',
    score: 60,
    checks: [],
  } as unknown as InspectionReport;

  function snapshot(over: Partial<ReportStoreSnapshot> = {}): ReportStoreSnapshot {
    return {
      profile: getVehicleProfile(GOLF),
      learnedVin: null,
      info: null,
      deviceName: null,
      dtc: {
        stored: [],
        pending: [],
        permanent: [],
        readiness: null,
        freezeFrames: [],
        lastReadAt: null,
        readFor: null,
      },
      scans: [],
      history: [],
      inspection: { report: null, ranAt: null, ranFor: null },
      battery: { report: null, ranAt: null, ranFor: null },
      ai: { report: null, ranAt: null, ranFor: null },
      maintenance: { items: DEFAULT_SERVICE_ITEMS, entries: [], odoKm: null },
      now: T,
      ...over,
    };
  }

  it('nothing run yet: no section available, identity only', () => {
    const src = collectReportSources(snapshot());
    expect(Object.values(availableSections(src)).some(Boolean)).toBe(false);
    expect(src.identity.connected).toBe(false);
    expect(src.identity.vin).toBeNull();
  });

  it('offline: faults and AI fall back to this car’s newest history entries, scan to its newest scan', () => {
    const report = {
      overall: 'ok',
      summary: 'fine',
      findings: [],
      actions: [],
      source: 'local',
      disclaimer: 'x',
    } as AiReport;
    const history: HistoryEntry[] = [
      {
        kind: 'dtc',
        id: 'other',
        ts: T + 10,
        vehicle: { id: 'fiat-punto', label: 'Punto', vin: null },
        milOn: true,
        stored: [{ code: 'P0100', description: 'MAF' }],
        pending: [],
        permanent: [],
        monitorsComplete: null,
        monitorsTotal: null,
      },
      {
        kind: 'dtc',
        id: 'mine',
        ts: T - 5,
        vehicle: { id: GOLF, label: 'Golf', vin: VIN },
        milOn: false,
        stored: [{ code: 'P0299', description: 'Underboost' }],
        pending: [],
        permanent: [],
        monitorsComplete: 5,
        monitorsTotal: 7,
      },
      {
        kind: 'ai',
        id: 'ai',
        ts: T - 1,
        vehicle: { id: GOLF, label: 'Golf', vin: VIN },
        source: 'local',
        overall: 'ok',
        summary: 'fine',
        findingCount: 0,
        report,
      },
    ];
    const src = collectReportSources(snapshot({ history, scans: [scanFixture] }));
    expect(src.faults?.stored.map((d) => d.code)).toEqual(['P0299']);
    expect(src.ai).toMatchObject({ summary: 'fine', ts: T - 1 });
    expect(src.scan?.modules[0].address).toBe('01');
    expect(src.identity).toMatchObject({
      vin: VIN,
      connected: false,
      protocol: scanFixture.protocol,
      lastSeenAt: T,
    });
  });

  it('a live read wins over history and maintenance needs a logbook entry', () => {
    const src = collectReportSources(
      snapshot({
        info,
        deviceName: 'Simulator',
        dtc: {
          stored: [{ code: 'P0401', description: 'EGR' }],
          pending: [],
          permanent: [],
          readiness: null,
          freezeFrames: [],
          lastReadAt: T,
          readFor: GOLF_CAR,
        },
        maintenance: {
          items: DEFAULT_SERVICE_ITEMS,
          entries: [{ id: 'e', itemId: 'engine-oil', date: T - DAY, odoKm: 179000 }],
          odoKm: 180000,
        },
      }),
    );
    expect(src.faults?.stored.map((d) => d.code)).toEqual(['P0401']);
    expect(src.faults?.adapter).toBe('Simulator');
    expect(src.identity.connected).toBe(true);
    expect(availableSections(src)).toEqual({
      faults: true,
      scan: false,
      inspection: false,
      battery: false,
      ai: false,
      maintenance: true,
    });
  });

  it('an emptied live read (clearResults, no session) falls back to the car’s history entry', () => {
    // lastReadAt survives clearResults (first-run card); readFor does not.
    const src = collectReportSources(
      snapshot({
        history: golfHistory,
        dtc: {
          stored: [],
          pending: [],
          permanent: [],
          readiness: null,
          freezeFrames: [],
          lastReadAt: T - 60_000,
          readFor: null,
        },
      }),
    );
    expect(src.faults?.stored.map((d) => d.code)).toEqual(['P0299']);
    expect(src.faults?.milOn).toBe(true);
    expect(src.faults?.ts).toBe(T - 5);
  });

  it('in-memory results produced for another car are left out', () => {
    // Read the Golf, disconnect, switch the garage selection to the Punto: none of the Golf's
    // in-memory results may appear in the Punto's report.
    const punto = { ...getVehicleProfile('fiat-punto-2008-12'), id: PUNTO_CAR.id };
    const live = {
      dtc: {
        stored: [{ code: 'P0299', description: 'Underboost' }],
        pending: [],
        permanent: [],
        readiness: null,
        freezeFrames: [],
        lastReadAt: T,
        readFor: GOLF_CAR,
      },
      history: golfHistory,
      inspection: { report: inspectionReport, ranAt: T, ranFor: GOLF_CAR },
      battery: {
        report: {
          restingV: 12.6,
          crankingDipV: 10.1,
          chargingV: 14.2,
          socPct: 90,
          verdict: 'good',
          notes: [],
        } as never,
        ranAt: T,
        ranFor: GOLF_CAR,
      },
      ai: { report: aiReport, ranAt: T, ranFor: GOLF_CAR },
    };
    const other = collectReportSources(snapshot({ ...live, profile: punto }));
    expect(other.faults).toBeNull();
    expect(other.inspection).toBeNull();
    expect(other.battery).toBeNull();
    expect(other.ai).toBeNull();
    expect(other.identity.vin).toBeNull();
    expect(other.identity.lastSeenAt).toBeNull();

    // The same snapshot for the Golf keeps every live result.
    const golf = collectReportSources(snapshot(live));
    expect(golf.faults?.ts).toBe(T);
    expect(golf.inspection?.verdict).toBe('caution');
    expect(golf.battery?.restingV).toBe(12.6);
    expect(golf.ai?.summary).toBe('boost leak');
  });

  it('offline "last connection" is the newest time among the printed sections, not only history', () => {
    // Faults read at T-5 (history entry), then a battery capture at T+20, then disconnect.
    const battery = {
      report: {
        restingV: 12.5,
        crankingDipV: 10.2,
        chargingV: 14.1,
        socPct: 85,
        verdict: 'good',
        notes: [],
      } as never,
      ranAt: T + 20,
      ranFor: GOLF_CAR,
    };
    const src = collectReportSources(snapshot({ history: golfHistory, battery }));
    expect(src.battery?.ts).toBe(T + 20);
    expect(src.identity).toMatchObject({ connected: false, lastSeenAt: T + 20 });

    // Only an inspection was run (no fault read, scan or AI): its time is still printed.
    const onlyInspection = collectReportSources(
      snapshot({ inspection: { report: inspectionReport, ranAt: T + 30, ranFor: GOLF_CAR } }),
    );
    expect(onlyInspection.identity.lastSeenAt).toBe(T + 30);
  });
});
