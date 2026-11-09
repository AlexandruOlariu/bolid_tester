/** `loadTrip` reads a trip's CSV once and returns both its samples and its GPS track (plan 17). In
 *  the core project ts-jest compiles the variable-specifier `import()` to `require`, so the
 *  in-memory `expo-file-system/legacy` double below is what the hook really reads. */
const mockFiles = new Map<string, string>();
const mockFs = {
  documentDirectory: 'file:///docs/',
  getInfoAsync: jest.fn(async (uri: string) => ({ exists: mockFiles.has(uri) })),
  readAsStringAsync: jest.fn(async (uri: string) => {
    const v = mockFiles.get(uri);
    if (v === undefined) throw new Error(`ENOENT ${uri}`);
    return v;
  }),
  writeAsStringAsync: jest.fn(async (uri: string, v: string) => {
    mockFiles.set(uri, v);
  }),
  deleteAsync: jest.fn(async (uri: string) => {
    mockFiles.delete(uri);
  }),
};
// The root entry point as it is on this SDK: no `documentDirectory` (its legacy functions are
// throwing stubs). The hook must use the legacy entry point, or the CSV is never written.
jest.mock('expo-file-system', () => ({}));
jest.mock('expo-file-system/legacy', () => mockFs);

import { toCsv, trackFromCsv, type Trip } from '@/shared/obd-core';
import { useSettingsStore } from '@/shared/state/settingsStore';
import { useTripStore } from '../model/tripStore';
import { startTrackCapture } from '../api/trackRecorder';
import { loadTrip, loadTripSamples, stopRecording } from './useTripRecorder';

const header: Trip['header'] = {
  id: '42',
  startedAt: 0,
  endedAt: 10_000,
  profileId: 'generic',
  vin: null,
  protocol: 'CAN',
};
const samples = [
  { t: 0, values: { '010D': 10 } },
  { t: 1000, values: { '010D': 20 } },
];
const track = [
  { t: 0, lat: 44.4268, lon: 26.1025, speed: 3 },
  { t: 5000, lat: 44.4269, lon: 26.1026, speed: null },
];

beforeEach(() => mockFiles.clear());

describe('loadTrip', () => {
  it('reads the samples and the GPS track from one CSV read', async () => {
    mockFiles.set('file:///docs/trip-42.csv', toCsv({ header, samples, markers: [], track }));
    await expect(loadTrip(header)).resolves.toEqual({ samples, track });
    expect(mockFs.readAsStringAsync).toHaveBeenCalledTimes(1);
    await expect(loadTripSamples(header)).resolves.toEqual(samples);
  });

  it('loads an old (pre-GPS) CSV with an empty track', async () => {
    mockFiles.set('file:///docs/trip-42.csv', toCsv({ header, samples, markers: [] }));
    await expect(loadTrip(header)).resolves.toEqual({ samples, track: [] });
  });

  it('returns empty arrays for a missing file', async () => {
    await expect(loadTrip(header)).resolves.toEqual({ samples: [], track: [] });
  });
});

describe('stopRecording with the simulator', () => {
  afterEach(() => {
    jest.useRealTimers();
    useSettingsStore.setState({ adapterSource: 'ble' });
  });

  it('saves the synthetic track in the CSV and flags the summary as simulated GPS', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(1_000_000);
    useSettingsStore.setState({ adapterSource: 'mock' });
    useTripStore.getState().start();
    await startTrackCapture();
    for (let s = 0; s < 20; s++) {
      useTripStore.getState().pushSample({ t: Date.now(), values: { '010D': 40 } });
      jest.advanceTimersByTime(1000);
    }
    const trip = await stopRecording();
    expect(trip.track?.length).toBe(5); // 0, 5, 10, 15, 20 s
    const summary = useTripStore.getState().trips[0];
    expect(summary.syntheticTrack).toBe(true);
    expect(summary.stats.gps?.points).toBe(5);
    const csv = mockFiles.get(`file:///docs/trip-${trip.header.id}.csv`);
    expect(csv && trackFromCsv(csv)).toEqual(trip.track);
  });

  it('a track-less real recording carries no simulated flag', async () => {
    useTripStore.getState().start();
    await startTrackCapture(); // BLE source, no expo-location in the core project → no track
    const trip = await stopRecording();
    expect(trip.track).toBeUndefined();
    expect(useTripStore.getState().trips[0].syntheticTrack).toBeUndefined();
  });
});
