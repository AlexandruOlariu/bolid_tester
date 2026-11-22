/** The store stamps results with the active car (`activeCarStamp`), whose garage / vehicle stores
 *  persist through expo-file-system (ESM, not transformed in the node env): mock it to a no-op. */
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: '/tmp/bolid-test/',
  cacheDirectory: '/tmp/bolid-test/',
  getInfoAsync: jest.fn(async () => ({ exists: false })),
  readAsStringAsync: jest.fn(async () => ''),
  writeAsStringAsync: jest.fn(async () => undefined),
  deleteAsync: jest.fn(async () => undefined),
}));

import { useBatteryStore } from './batteryStore';

describe('batteryStore.ranAt (plan 15)', () => {
  beforeEach(() => useBatteryStore.setState({ report: null, ranAt: null, ranFor: null }));

  it('setReport stamps when the report was produced, and clearing it clears the stamp', () => {
    const before = Date.now();
    useBatteryStore.getState().setReport({
      restingV: 12.5,
      crankingDipV: 10.4,
      chargingV: 14.1,
      socPct: 88,
      verdict: 'good',
      notes: [],
    });
    const { ranAt } = useBatteryStore.getState();
    expect(ranAt).not.toBeNull();
    expect(ranAt ?? 0).toBeGreaterThanOrEqual(before);
    expect(useBatteryStore.getState().ranFor).toMatchObject({ id: 'generic', vin: null });

    useBatteryStore.getState().setReport(null);
    expect(useBatteryStore.getState().ranAt).toBeNull();
    expect(useBatteryStore.getState().ranFor).toBeNull();
  });
});
