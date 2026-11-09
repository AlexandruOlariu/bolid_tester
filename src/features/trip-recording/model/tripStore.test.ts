/** Trips per car (plan 06): a finished trip records the active car; older trips without one group
 *  by their header's profileId. The persisted stores' file system is mocked to a no-op. */
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: null,
  cacheDirectory: null,
  getInfoAsync: jest.fn(async () => ({ exists: false })),
  readAsStringAsync: jest.fn(async () => ''),
  writeAsStringAsync: jest.fn(async () => undefined),
  deleteAsync: jest.fn(async () => undefined),
}));

// The trip CSV write: no document directory, so stopRecording skips the file and keeps the summary.
jest.mock('expo-file-system', () => ({ documentDirectory: null }));

import { useVehicleStore } from '@/features/vehicle-select/model/vehicleStore';
import { stopRecording } from '../hooks/useTripRecorder';
import {
  tripCarKey,
  tripCars,
  UNKNOWN_TRIP_CAR,
  useTripStore,
  type TripSummary,
} from './tripStore';

function trip(id: string, vehicleId?: string, profileId = 'generic'): TripSummary {
  return {
    header: { id, startedAt: 1, endedAt: 2, profileId, vin: null, protocol: 'AUTO' },
    stats: {} as TripSummary['stats'],
    markerCount: 0,
    ...(vehicleId ? { vehicleId } : {}),
  };
}

beforeEach(() => {
  useTripStore.setState({ trips: [], recording: false, samples: [], markers: [], startedAt: null });
});

describe('trip cars', () => {
  it('groups by vehicleId; older trips group by their header profileId', () => {
    const trips = [
      trip('a', 'user:x'),
      trip('b', undefined, 'golf-plus-2009-20tdi'),
      trip('c', 'user:x'),
      trip('d', 'golf-plus-2009-20tdi'),
      trip('e', undefined, 'generic'),
    ];
    expect(tripCarKey(trips[1])).toBe('golf-plus-2009-20tdi');
    expect(tripCars(trips)).toEqual([
      { key: 'user:x', count: 2 },
      { key: 'golf-plus-2009-20tdi', count: 2 },
      { key: 'generic', count: 1 },
    ]);
  });

  it('a summary with no car at all lists under the unknown car', () => {
    const t = trip('z', undefined, '');
    expect(tripCarKey(t)).toBe(UNKNOWN_TRIP_CAR);
  });

  it('a finished trip records the active car', async () => {
    useVehicleStore.setState({ selectedProfileId: 'user:abc' });
    useTripStore.getState().start();
    await stopRecording();
    const [saved] = useTripStore.getState().trips;
    expect(saved.vehicleId).toBe('user:abc');
    expect(saved.header.profileId).toBe('user:abc');
  });
});
