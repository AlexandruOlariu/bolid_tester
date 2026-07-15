import {
  Trip,
  TrackPoint,
  downsample,
  tripPids,
  tripStats,
  toCsv,
  fromCsv,
  toJson,
  trackFromCsv,
  haversineKm,
  trackDistanceKm,
  trackAverageSpeedKmh,
} from './trip';

function makeTrip(): Trip {
  const samples = [];
  for (let i = 0; i < 10; i++) {
    samples.push({ t: 1000 + i * 1000, values: { '010C': 800 + i, '010D': i * 10 } });
  }
  return {
    header: { id: 't1', startedAt: 1000, endedAt: 10000, profileId: 'generic', vin: null, protocol: 'CAN' },
    samples,
    markers: [{ t: 3000, kind: 'dtc', label: 'P0299' }],
  };
}

describe('trip helpers', () => {
  it('downsamples to one sample per bucket', () => {
    const t = makeTrip();
    expect(downsample(t.samples, 3000).length).toBeLessThan(t.samples.length);
    expect(downsample(t.samples, 0).length).toBe(t.samples.length);
  });

  it('lists the union of PIDs', () => {
    expect(tripPids(makeTrip())).toEqual(['010C', '010D']);
  });

  it('computes duration, max, and distance from speed', () => {
    const s = tripStats(makeTrip());
    expect(s.durationMs).toBe(9000);
    expect(s.max['010C']).toBe(809);
    expect(s.distanceKm).not.toBeNull();
    expect(s.distanceKm!).toBeGreaterThan(0);
  });

  it('exports CSV with header + a column per PID', () => {
    const csv = toCsv(makeTrip());
    const [header, first] = csv.split('\n');
    expect(header).toBe('t_ms,iso,010C,010D');
    expect(first.split(',')).toHaveLength(4);
  });

  it('round-trips JSON', () => {
    const t = makeTrip();
    expect(JSON.parse(toJson(t)).samples).toHaveLength(10);
  });

  it('round-trips samples through CSV (toCsv -> fromCsv)', () => {
    const t = makeTrip();
    expect(fromCsv(toCsv(t))).toEqual(t.samples);
  });

  it('decodes empty cells to null and a header-only document to no samples', () => {
    const trip: Trip = {
      header: { id: 'n', startedAt: 0, endedAt: 1, profileId: 'generic', vin: null, protocol: 'CAN' },
      samples: [
        { t: 1000, values: { '010C': 10, '010D': null } },
        { t: 2000, values: { '010C': null, '010D': 20 } },
      ],
      markers: [],
    };
    expect(fromCsv(toCsv(trip))).toEqual(trip.samples);
    expect(fromCsv('t_ms,iso')).toEqual([]);
    expect(fromCsv('')).toEqual([]);
  });
});

describe('GPS track', () => {
  const track: TrackPoint[] = [
    { t: 0, lat: 48.2082, lon: 16.3738, speed: 0 },
    { t: 60_000, lat: 48.2182, lon: 16.3738, speed: 20 },
    { t: 120_000, lat: 48.2282, lon: 16.3738, speed: null },
  ];

  function tripWithTrack(): Trip {
    return { ...makeTrip(), track };
  }

  it('haversine matches a known ~1.11 km per 0.01° latitude step', () => {
    expect(haversineKm(48.2082, 16.3738, 48.2182, 16.3738)).toBeCloseTo(1.112, 2);
  });

  it('sums hops for total track distance', () => {
    expect(trackDistanceKm(track)).toBeCloseTo(2.224, 2);
    expect(trackDistanceKm([track[0]])).toBe(0);
  });

  it('averages speed from position over elapsed time', () => {
    // ~2.224 km over 120 s = ~66.7 km/h
    expect(trackAverageSpeedKmh(track)).toBeCloseTo(66.7, 0);
    expect(trackAverageSpeedKmh([track[0]])).toBeNull();
  });

  it('round-trips the track through CSV (toCsv -> trackFromCsv), samples unaffected', () => {
    const csv = toCsv(tripWithTrack());
    expect(trackFromCsv(csv)).toEqual(track);
    // the sample grid still round-trips and ignores the track section
    expect(fromCsv(csv)).toEqual(makeTrip().samples);
  });

  it('emits no track section (and recovers []) for a trip without GPS', () => {
    const csv = toCsv(makeTrip());
    expect(csv).not.toContain('#TRACK');
    expect(trackFromCsv(csv)).toEqual([]);
  });

  it('adds gps stats (distance, avg speed, obd-vs-gps delta) to tripStats', () => {
    const s = tripStats(tripWithTrack());
    expect(s.gps).toBeDefined();
    expect(s.gps!.points).toBe(3);
    expect(s.gps!.distanceKm).toBeCloseTo(2.224, 2);
    expect(s.gps!.obdAvgSpeedKmh).not.toBeNull();
    expect(s.gps!.speedDeltaKmh).not.toBeNull();
    // no gps field when there's no track
    expect(tripStats(makeTrip()).gps).toBeUndefined();
  });
});

describe('fuel stats in tripStats', () => {
  function fuelTrip(): Trip {
    const samples = [
      { t: 0, values: { '015E': 6, '010D': 60 } },
      { t: 3_600_000, values: { '015E': 6, '010D': 60 } },
    ];
    return {
      header: { id: 'f', startedAt: 0, endedAt: 3_600_000, profileId: 'generic', vin: null, protocol: 'CAN' },
      samples,
      markers: [],
    };
  }

  it('is omitted unless a fuel type is supplied', () => {
    expect(tripStats(fuelTrip()).fuel).toBeUndefined();
  });

  it('computes trip L/100km when a fuel type and fuel PID are present', () => {
    const s = tripStats(fuelTrip(), 'diesel');
    expect(s.fuel).toBeDefined();
    expect(s.fuel!.litresPer100km).toBeCloseTo(10, 5);
  });

  it('is omitted when the samples carry no fuel PID even with a fuel type', () => {
    expect(tripStats(makeTrip(), 'petrol').fuel).toBeUndefined();
  });
});
