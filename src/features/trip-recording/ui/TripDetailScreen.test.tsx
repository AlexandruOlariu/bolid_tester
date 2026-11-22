/** Trip detail (plan 17): a simulator recording opens with a "simulated GPS" badge (a 3 min one
 *  draws the whole closed loop) and an `ok` GPS-vs-OBD verdict; the overlay switch recolours the segments and swaps the
 *  legend; a tap near the track shows that fix's time, speed and RPM; a trip recorded before GPS
 *  existed (no `#TRACK` section) opens with "No GPS track" and its stats. */
import React from 'react';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { Line } from 'react-native-svg';
import { renderWithProviders } from '@test/renderWithProviders';
import { setMockSearchParams } from '@test/mocks/router';
import { memoryFiles } from '@test/mocks/fileSystem';
import {
  haversineKm,
  projectTrack,
  syntheticLoopPoint,
  toCsv,
  TRACK_PALETTE,
  type Trip,
  type TrackPoint,
  type TripSample,
} from '@/shared/obd-core';
import { useSettingsStore } from '@/shared/state/settingsStore';
import { useLiveDataStore } from '@/shared/state/liveDataStore';
import { useTripStore, type TripSummary } from '../model/tripStore';
import { stopRecording } from '../hooks/useTripRecorder';
import { startTrackCapture } from '../api/trackRecorder';
import { TripDetailScreen } from './TripDetailScreen';

// The UI project cannot run the hooks' variable-specifier `import('expo-file-system')` (babel leaves
// it to the VM), so `loadTrip` here reads the same in-memory files the device path would; the real
// read is covered by hooks/useTripRecorder.test.ts in the core project.
jest.mock('../hooks/useTripRecorder', () => {
  const actual = jest.requireActual<object>('../hooks/useTripRecorder');
  const files =
    jest.requireActual<typeof import('@test/mocks/fileSystem')>(
      '@test/mocks/fileSystem',
    ).memoryFiles;
  const core = jest.requireActual<typeof import('@/shared/obd-core')>('@/shared/obd-core');
  return {
    ...actual,
    loadTrip: async (h: { id: string }) => {
      const csv = files.get(`file:///test/trip-${h.id}.csv`);
      return csv === undefined
        ? { samples: [], track: [] }
        : { samples: core.fromCsv(csv), track: core.trackFromCsv(csv) };
    },
  };
});

const T0 = Date.UTC(2026, 10, 9, 8, 0, 0);

function setLiveSpeed(kmh: number): void {
  useLiveDataStore.setState({
    values: { '010D': { pid: '010D', name: 'Vehicle speed', unit: 'km/h', value: kmh, ts: 0 } },
  });
}

/** Record a simulator trip (60 s by default) the way the app does: synthetic GPS from the live
 *  speed, one OBD sample a second (EngineHost's job, done by hand here). The speed swings 25–55 km/h
 *  round a 40 km/h mean. Returns the finished trip. */
async function recordSimulatorTrip(seconds = 60): Promise<Trip> {
  jest.useFakeTimers();
  jest.setSystemTime(T0);
  useSettingsStore.setState({ adapterSource: 'mock' });
  const speedAt = (s: number) => 40 + 15 * Math.sin((2 * Math.PI * s) / 60);
  setLiveSpeed(speedAt(0));
  useTripStore.getState().start();
  await startTrackCapture();
  for (let s = 0; s <= seconds; s++) {
    const kmh = speedAt(s);
    setLiveSpeed(kmh);
    useTripStore.getState().pushSample({
      t: Date.now(),
      values: { '010C': 1200 + kmh * 30, '010D': kmh, '015E': 2 + kmh / 20 },
    });
    if (s < seconds) jest.advanceTimersByTime(1000);
  }
  const trip = await stopRecording();
  jest.useRealTimers();
  // What the device's CSV write on stop puts on disk (see the loadTrip note above).
  memoryFiles.set(`file:///test/trip-${trip.header.id}.csv`, toCsv(trip));
  return trip;
}

/** Write a trip's CSV where `loadTrip` reads it and list its summary. */
function saveTrip(trip: Trip, stats: Partial<TripSummary['stats']> = {}): void {
  memoryFiles.set(`file:///test/trip-${trip.header.id}.csv`, toCsv(trip));
  useTripStore.setState({
    trips: [
      {
        header: trip.header,
        stats: {
          durationMs: trip.header.endedAt - trip.header.startedAt,
          sampleCount: trip.samples.length,
          distanceKm: null,
          max: {},
          ...stats,
        },
        markerCount: 0,
      },
    ],
  });
}

function header(id: string, seconds: number): Trip['header'] {
  return {
    id,
    startedAt: T0,
    endedAt: T0 + seconds * 1000,
    profileId: 'generic',
    vin: null,
    protocol: 'CAN',
  };
}

const segmentStrokes = () =>
  screen
    .UNSAFE_getAllByType(Line)
    .filter((l) => l.props.testID === 'track-segment')
    .map((l) => l.props.stroke as string);

describe('TripDetailScreen', () => {
  it('opens a 60 s simulator trip with a simulated-GPS badge and an ok verdict', async () => {
    const { id } = (await recordSimulatorTrip()).header;
    const summary = useTripStore.getState().trips[0];
    expect(summary.syntheticTrack).toBe(true);

    setMockSearchParams({ id });
    renderWithProviders(<TripDetailScreen />);

    expect(await screen.findByText('Distances agree')).toBeTruthy();
    expect(screen.getByText('simulated GPS')).toBeTruthy();
    expect(screen.getByTestId('gps-obd-card')).toBeTruthy();
    // 60 s → a fix at 0, every 5 s, and none extra at the stop (it lands on a tick): 13 fixes.
    expect(segmentStrokes()).toHaveLength(12);
    expect(screen.getByText('0–30 km/h')).toBeTruthy();
    expect(screen.getByTestId('speed-strip-line')).toBeTruthy();
  });

  it('a 3 min simulator recording (one lap at ~40 km/h) draws the closed loop and reads ok', async () => {
    const trip = await recordSimulatorTrip(180);
    const track = trip.track ?? [];
    expect(track).toHaveLength(37); // a fix at 0 and every 5 s
    const first = track[0];
    const last = track[track.length - 1];
    // Back near the start after ~2 km, having gone all the way round (both long sides and ends).
    expect(haversineKm(first.lat, first.lon, last.lat, last.lon) * 1000).toBeLessThan(60);
    const lats = track.map((p) => p.lat);
    const lons = track.map((p) => p.lon);
    const northM = haversineKm(Math.min(...lats), first.lon, Math.max(...lats), first.lon) * 1000;
    const eastM = haversineKm(first.lat, Math.min(...lons), first.lat, Math.max(...lons)) * 1000;
    expect(northM).toBeGreaterThan(300);
    expect(eastM).toBeGreaterThan(550);

    setMockSearchParams({ id: trip.header.id });
    renderWithProviders(<TripDetailScreen />);
    expect(await screen.findByText('Distances agree')).toBeTruthy();
    expect(screen.getByText('simulated GPS')).toBeTruthy();
    expect(segmentStrokes()).toHaveLength(36);
  });

  it('a synthetic loop driven round closes on itself', async () => {
    // ~2 km at 72 km/h (20 m/s) is 100 s; the track ends where it started.
    const track: TrackPoint[] = [];
    for (let s = 0; s <= 100; s += 5)
      track.push({ t: T0 + s * 1000, ...syntheticLoopPoint(s * 20), speed: 20 });
    const first = track[0];
    const last = track[track.length - 1];
    expect(haversineKm(first.lat, first.lon, last.lat, last.lon) * 1000).toBeLessThan(1);
    const samples: TripSample[] = [];
    for (let s = 0; s <= 100; s++) samples.push({ t: T0 + s * 1000, values: { '010D': 72 } });
    saveTrip({ header: header('loop', 100), samples, markers: [], track });
    setMockSearchParams({ id: 'loop' });
    renderWithProviders(<TripDetailScreen />);
    expect(await screen.findByText('Distances agree')).toBeTruthy();
    expect(segmentStrokes()).toHaveLength(20);
  });

  it('switches the overlay (recolour + legend) and shows a tooltip for a tap on the track', async () => {
    // A straight eastward drive: 10 fixes, 5 s apart; speed and RPM climb, fuel rate missing.
    const track: TrackPoint[] = Array.from({ length: 10 }, (_, k) => ({
      t: T0 + k * 5000,
      lat: 44.4268,
      lon: 26.1025 + k * 0.001,
      speed: null,
    }));
    const samples: TripSample[] = Array.from({ length: 46 }, (_, s) => ({
      t: T0 + s * 1000,
      values: { '010C': 800 + s * 80, '010D': s * 3 },
    }));
    saveTrip({ header: header('drive', 45), samples, markers: [], track });
    setMockSearchParams({ id: 'drive' });
    renderWithProviders(<TripDetailScreen />);

    expect(await screen.findByText('130+ km/h')).toBeTruthy();
    const bySpeed = segmentStrokes();
    expect(bySpeed).toHaveLength(9);
    expect(bySpeed[0]).toBe(TRACK_PALETTE[0]); // 0–15 km/h
    expect(bySpeed[8]).toBe(TRACK_PALETTE[3]); // 120 → 135 km/h, mean 127.5: the 90–130 bucket

    fireEvent.press(screen.getByText('RPM'));
    expect(screen.getByText('3500+ rpm')).toBeTruthy();
    expect(screen.queryByText('130+ km/h')).toBeNull();
    const byRpm = segmentStrokes();
    expect(byRpm).not.toEqual(bySpeed);

    fireEvent.press(screen.getByText('Fuel'));
    expect(screen.getByText('No data')).toBeTruthy();
    expect(segmentStrokes().every((c) => c === '#8b949e')).toBe(true);

    fireEvent.press(screen.getByText('None'));
    expect(screen.queryByTestId('track-legend')).toBeNull();

    // Tap right on the 5th fix (t = +20 s → 60 km/h, 2400 rpm).
    const p = projectTrack(track, 320, 213, 16)[4];
    fireEvent.press(screen.getByTestId('track-map'), {
      nativeEvent: { locationX: p.x + 3, locationY: p.y - 2 },
    });
    expect(screen.getByTestId('track-tooltip')).toBeTruthy();
    expect(screen.getByText(/\(\+0:20\)/)).toBeTruthy();
    expect(screen.getByText('60 km/h · 2400 rpm · — L/h')).toBeTruthy();

    // A tap far from the track clears it.
    fireEvent.press(screen.getByTestId('track-map'), {
      nativeEvent: { locationX: p.x, locationY: p.y + 80 },
    });
    expect(screen.queryByTestId('track-tooltip')).toBeNull();
  });

  it('shows the GPS-vs-OBD distances, delta and a mismatch verdict with its note', async () => {
    // GPS ≈ 0.71 km over 45 s; OBD 80 km/h for 45 s = 1.00 km → about +40 %.
    const track: TrackPoint[] = Array.from({ length: 10 }, (_, k) => ({
      t: T0 + k * 5000,
      lat: 44.4268,
      lon: 26.1025 + k * 0.001,
      speed: 20,
    }));
    const samples: TripSample[] = Array.from({ length: 46 }, (_, s) => ({
      t: T0 + s * 1000,
      values: { '010D': 80 },
    }));
    saveTrip({ header: header('mismatch', 45), samples, markers: [], track });
    setMockSearchParams({ id: 'mismatch' });
    renderWithProviders(<TripDetailScreen />);

    expect(await screen.findByText('Mismatch')).toBeTruthy();
    expect(screen.getByText(/^OBD 1\.00 km · GPS 0\.\d\d km · Δ \+\d+\.\d %$/)).toBeTruthy();
    expect(screen.getByText('Odometer or sensor issue — compare with a second trip.')).toBeTruthy();
    expect(screen.queryByText('simulated GPS')).toBeNull();
  });

  it('opens a trip recorded before GPS (no #TRACK section) with "No GPS track" and its stats', async () => {
    const samples: TripSample[] = Array.from({ length: 31 }, (_, s) => ({
      t: T0 + s * 1000,
      values: { '010D': 36 },
    }));
    const trip: Trip = { header: header('old', 30), samples, markers: [] };
    expect(toCsv(trip)).not.toContain('#TRACK');
    saveTrip(trip, { distanceKm: 0.3 });
    setMockSearchParams({ id: 'old' });
    renderWithProviders(<TripDetailScreen />);

    expect(await screen.findByText('No GPS track for this trip.')).toBeTruthy();
    expect(screen.queryByTestId('gps-obd-card')).toBeNull();
    expect(screen.queryByTestId('track-map')).toBeNull();
    expect(screen.getByLabelText('OBD distance: 0.30 km')).toBeTruthy();
    expect(screen.getByLabelText('Duration: 30 s')).toBeTruthy();
    expect(screen.getByTestId('speed-strip-line')).toBeTruthy();
  });

  it('copes with a missing CSV and with an unknown trip id', async () => {
    useTripStore.setState({
      trips: [
        {
          header: header('gone', 10),
          stats: { durationMs: 10_000, sampleCount: 5, distanceKm: null, max: {} },
          markerCount: 0,
        },
      ],
    });
    setMockSearchParams({ id: 'gone' });
    const view = renderWithProviders(<TripDetailScreen />);
    expect(await screen.findByText('No samples on file for this trip.')).toBeTruthy();
    expect(screen.getByText('No GPS track for this trip.')).toBeTruthy();
    view.unmount();

    setMockSearchParams({ id: 'nope' });
    renderWithProviders(<TripDetailScreen />);
    expect(screen.getByText('This trip was not found — it may have been deleted.')).toBeTruthy();
    await act(async () => undefined);
  });
});
