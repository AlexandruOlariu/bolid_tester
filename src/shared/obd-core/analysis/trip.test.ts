import { Trip, downsample, tripPids, tripStats, toCsv, toJson } from './trip';

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
});
