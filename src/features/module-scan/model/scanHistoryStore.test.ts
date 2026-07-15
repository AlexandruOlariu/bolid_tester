/** The store's persist layer pulls in expo-file-system (ESM, untransformed in the node test env),
 *  so mock it to a no-op file system — hydration resolves to "nothing persisted" and the synchronous
 *  actions under test run unaffected (same idiom as historyStore.test.ts). */
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: '/tmp/bolid-test/',
  cacheDirectory: '/tmp/bolid-test/',
  getInfoAsync: jest.fn(async () => ({ exists: false })),
  readAsStringAsync: jest.fn(async () => ''),
  writeAsStringAsync: jest.fn(async () => undefined),
  deleteAsync: jest.fn(async () => undefined),
}));

import { useScanHistoryStore, buildSavedScan, MAX_SCANS } from './scanHistoryStore';
import type { ModuleScanResult } from './moduleScanStore';
import type { DiagModule } from '@/shared/vehicles';

const engineModule: DiagModule = {
  address: '01',
  name: 'Engine (EDC17)',
  transport: 'uds',
  reqHeader: '7E0',
  rxFilter: '7E8',
  experimental: false,
};

const result: ModuleScanResult = {
  module: engineModule,
  state: 'ok',
  ident: { partNumber: '03L906022LM', softwareVersion: '4023', systemName: 'R4 2,0L EDC', raw: {} },
  dtcs: [
    {
      bytes: [0x21, 0x83, 0x00],
      sae: 'P2183',
      failureType: 0,
      display: 'P2183 00',
      vagCode: '08579',
      status: 0x09,
      statusFlags: {
        testFailed: true,
        testFailedThisCycle: false,
        pending: false,
        confirmed: true,
        notCompletedSinceClear: false,
        failedSinceClear: false,
        notCompletedThisCycle: false,
        warningIndicator: false,
      },
      description: 'Engine coolant temperature sensor 2',
    },
  ],
};

describe('buildSavedScan', () => {
  it('normalizes live results into a compact serializable snapshot', () => {
    const scan = buildSavedScan({
      vehicle: { id: 'golf', label: 'Golf', vin: 'WVWZZZ1K' },
      protocol: 'CAN',
      results: [result],
    });
    expect(scan.id).toBeTruthy();
    expect(scan.modules).toHaveLength(1);
    const m = scan.modules[0];
    expect(m).toMatchObject({ address: '01', name: 'Engine (EDC17)', partNumber: '03L906022LM', softwareVersion: '4023' });
    expect(m.dtcs[0]).toEqual({
      sae: 'P2183',
      display: 'P2183 00',
      vagCode: '08579',
      description: 'Engine coolant temperature sensor 2',
      status: 0x09,
    });
    // No functions / DiagModule embedded — safe to JSON round-trip.
    expect(JSON.parse(JSON.stringify(scan))).toEqual(scan);
  });
});

describe('useScanHistoryStore', () => {
  beforeEach(() => useScanHistoryStore.setState({ scans: [] }));

  it('prepends saved scans (newest first)', () => {
    const { saveScan } = useScanHistoryStore.getState();
    saveScan(buildSavedScan({ vehicle: { id: 'a', label: 'A', vin: null }, protocol: 'CAN', results: [], ts: 1, id: 's1' }));
    saveScan(buildSavedScan({ vehicle: { id: 'a', label: 'A', vin: null }, protocol: 'CAN', results: [], ts: 2, id: 's2' }));
    expect(useScanHistoryStore.getState().scans.map((s) => s.id)).toEqual(['s2', 's1']);
  });

  it('caps at MAX_SCANS, evicting the oldest', () => {
    const { saveScan } = useScanHistoryStore.getState();
    for (let i = 0; i < MAX_SCANS + 10; i++) {
      saveScan(buildSavedScan({ vehicle: { id: 'a', label: 'A', vin: null }, protocol: 'CAN', results: [], ts: i, id: `s${i}` }));
    }
    const scans = useScanHistoryStore.getState().scans;
    expect(scans).toHaveLength(MAX_SCANS);
    expect(scans[0].id).toBe(`s${MAX_SCANS + 9}`); // newest
  });

  it('removes by id', () => {
    const { saveScan, remove } = useScanHistoryStore.getState();
    saveScan(buildSavedScan({ vehicle: { id: 'a', label: 'A', vin: null }, protocol: 'CAN', results: [], id: 'keep' }));
    saveScan(buildSavedScan({ vehicle: { id: 'a', label: 'A', vin: null }, protocol: 'CAN', results: [], id: 'drop' }));
    remove('drop');
    expect(useScanHistoryStore.getState().scans.map((s) => s.id)).toEqual(['keep']);
  });
});
