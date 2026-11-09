/** In the unit-test environment expo-location is not resolvable, so these assert the degrade path:
 *  capture becomes a no-op and a stopped recording simply carries no track — recording is never
 *  blocked. On-device behaviour (permission request + watchPositionAsync) can't be exercised here. */

// trackRecorder pulls in errorLogStore -> persistStorage, which statically imports expo-file-system
// (ESM, not transformed for the node test env). Mock it exactly as persistStorage.test.ts does.
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: '/tmp/bolid-test/',
  cacheDirectory: '/tmp/bolid-test/',
  getInfoAsync: jest.fn(async () => ({ exists: false })),
  readAsStringAsync: jest.fn(async () => ''),
  writeAsStringAsync: jest.fn(),
  deleteAsync: jest.fn(),
}));

import {
  gpsVsObd,
  haversineKm,
  syntheticLoopPoint,
  trackDistanceKm,
  type TripSample,
} from '@/shared/obd-core';
import { useSettingsStore } from '@/shared/state/settingsStore';
import { useLiveDataStore } from '@/shared/state/liveDataStore';
import {
  startTrackCapture,
  stopTrackCapture,
  isTrackCapturing,
  isSyntheticTrack,
} from './trackRecorder';

afterEach(() => {
  stopTrackCapture();
  jest.useRealTimers();
  useSettingsStore.setState({ adapterSource: 'ble' });
  useLiveDataStore.setState({ values: {} });
});

function setLiveSpeed(kmh: number): void {
  useLiveDataStore.setState({
    values: { '010D': { pid: '010D', name: 'Vehicle speed', unit: 'km/h', value: kmh, ts: 0 } },
  });
}

describe('trackRecorder', () => {
  it('degrades to an empty track without throwing when expo-location is unavailable', async () => {
    await expect(startTrackCapture()).resolves.toBeUndefined();
    expect(isTrackCapturing()).toBe(false);
    expect(stopTrackCapture()).toEqual([]);
  });

  it('stopTrackCapture is always safe to call, even if capture never started', () => {
    expect(stopTrackCapture()).toEqual([]);
    expect(isTrackCapturing()).toBe(false);
  });

  it('real (BLE) source: the location path is unchanged — no synthetic points, still degrades', async () => {
    jest.useFakeTimers();
    useSettingsStore.setState({ adapterSource: 'ble' });
    setLiveSpeed(50);
    await startTrackCapture();
    jest.advanceTimersByTime(30_000);
    expect(isTrackCapturing()).toBe(false);
    expect(isSyntheticTrack()).toBe(false);
    expect(stopTrackCapture()).toEqual([]);
  });
});

describe('trackRecorder in the simulator (synthetic GPS)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(1_000_000);
    useSettingsStore.setState({ adapterSource: 'mock' });
  });

  it('mock adapter source → synthetic points along the loop that advance with the live speed', async () => {
    setLiveSpeed(36); // 10 m/s
    await startTrackCapture();
    expect(isTrackCapturing()).toBe(true);
    expect(isSyntheticTrack()).toBe(true);

    jest.advanceTimersByTime(10_000); // two 5 s ticks at 10 m/s → 100 m
    setLiveSpeed(72); // 20 m/s
    jest.advanceTimersByTime(5_000); // one more tick → +100 m
    jest.advanceTimersByTime(2_000); // a 2 s tail closed on stop → +40 m

    const track = stopTrackCapture();
    expect(track.map((p) => p.t)).toEqual([1_000_000, 1_005_000, 1_010_000, 1_015_000, 1_017_000]);
    expect(track.map((p) => p.speed)).toEqual([10, 10, 10, 20, 20]);
    const origin = syntheticLoopPoint(0);
    expect(track[0]).toMatchObject({ lat: origin.lat, lon: origin.lon });
    expect(track[2]).toMatchObject(syntheticLoopPoint(100));
    expect(track[4]).toMatchObject(syntheticLoopPoint(240));
    expect(trackDistanceKm(track) * 1000).toBeCloseTo(240, 0); // first 500 m of the loop is straight
    // Stopped: the flag stays for the caller (stopRecording) and the timer is gone.
    expect(isTrackCapturing()).toBe(false);
    expect(isSyntheticTrack()).toBe(true);
    jest.advanceTimersByTime(20_000);
    expect(stopTrackCapture()).toEqual([]);
  });

  it('defaults to 40 km/h when the simulator publishes no speed yet', async () => {
    await startTrackCapture();
    jest.advanceTimersByTime(5_000);
    const track = stopTrackCapture();
    expect(track).toHaveLength(2);
    const metres = haversineKm(track[0].lat, track[0].lon, track[1].lat, track[1].lon) * 1000;
    expect(metres).toBeCloseTo((40 / 3.6) * 5, 3);
    expect(track[1].speed).toBeCloseTo(40 / 3.6, 9);
  });

  it.each([40, 90, 130])(
    'a steady %i km/h simulator drive round the corners reads ok on the GPS-vs-OBD check',
    async (kmh) => {
      setLiveSpeed(kmh);
      const t0 = Date.now();
      await startTrackCapture();
      const samples: TripSample[] = [];
      const seconds = 600; // 10 min: several laps at every speed, so every corner is cut
      for (let s = 0; s <= seconds; s++) {
        samples.push({ t: t0 + s * 1000, values: { '010D': kmh } });
        if (s < seconds) jest.advanceTimersByTime(1000);
      }
      const track = stopTrackCapture();
      const check = gpsVsObd(track, samples, seconds * 1000);
      expect(check.verdict).toBe('ok');
      expect(Math.abs(check.deltaPct ?? Infinity)).toBeLessThan(0.5);
    },
  );

  it('a new real-source capture clears the synthetic flag', async () => {
    await startTrackCapture();
    stopTrackCapture();
    expect(isSyntheticTrack()).toBe(true);
    useSettingsStore.setState({ adapterSource: 'ble' });
    await startTrackCapture();
    expect(isSyntheticTrack()).toBe(false);
  });
});
