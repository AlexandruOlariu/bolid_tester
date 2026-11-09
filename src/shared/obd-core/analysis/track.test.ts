import type { TrackPoint, TripSample } from './trip';
import { haversineKm, trackDistanceKm } from './trip';
import {
  GPS_OBD_CHECK_PCT,
  GPS_OBD_OK_PCT,
  SYNTHETIC_LOOP_LENGTH_M,
  SYNTHETIC_ORIGIN,
  TRACK_NO_DATA,
  TRACK_PALETTE,
  alignSamplesToTrack,
  colourSegments,
  formatBarLength,
  gpsVsObd,
  legendFor,
  nearestPoint,
  projectTrack,
  scaleBar,
  speedProfile,
  syntheticLoopAdvance,
  syntheticLoopPoint,
  trackBounds,
} from './track';

const pt = (t: number, lat: number, lon: number, speed: number | null = null): TrackPoint => ({
  t,
  lat,
  lon,
  speed,
});
const sample = (t: number, values: Record<string, number | null>): TripSample => ({ t, values });

/** A straight eastward track of `n` fixes, `stepM` metres apart, one every 5 s, at the equator. */
function eastTrack(n: number, stepM: number): TrackPoint[] {
  const degPerM = 1 / ((6371008.8 * Math.PI) / 180);
  return Array.from({ length: n }, (_, k) => pt(k * 5000, 0, k * stepM * degPerM));
}

/** Samples at 1 Hz over `seconds` at a constant `kmh`. */
function constantSpeed(seconds: number, kmh: number): TripSample[] {
  return Array.from({ length: seconds + 1 }, (_, k) => sample(k * 1000, { '010D': kmh }));
}

describe('trackBounds', () => {
  it('is null for an empty track and spans every fix otherwise', () => {
    expect(trackBounds([])).toBeNull();
    expect(trackBounds([pt(0, 1, 5), pt(1, -2, 7), pt(2, 0, 6)])).toEqual({
      minLat: -2,
      maxLat: 1,
      minLon: 5,
      maxLon: 7,
    });
  });
});

describe('projectTrack', () => {
  it('fits a 2-point track to the padded box and flips y so north is up', () => {
    // South-west → north-east diagonal at the equator: square in metres, so it fills a square box.
    const p = projectTrack([pt(0, 0, 0), pt(1, 0.01, 0.01)], 320, 320, 16);
    expect(p).toHaveLength(2);
    expect(p[0].x).toBeCloseTo(16, 3);
    expect(p[0].y).toBeCloseTo(304, 3); // southern point at the bottom
    expect(p[1].x).toBeCloseTo(304, 3);
    expect(p[1].y).toBeCloseTo(16, 3); // northern point at the top
    expect(p.map((q) => q.i)).toEqual([0, 1]);
  });

  it('preserves aspect: a wide track is width-bound and centred vertically', () => {
    const p = projectTrack([pt(0, 0, 0), pt(1, 0, 0.02)], 320, 200, 16);
    expect(p[0].x).toBeCloseTo(16, 3);
    expect(p[1].x).toBeCloseTo(304, 3);
    expect(p[0].y).toBeCloseTo(100, 3);
    expect(p[1].y).toBeCloseTo(100, 3);
  });

  it('scales longitude by cos(latitude) so a square in metres stays square', () => {
    const lat = 60; // cos 60° = 0.5: twice as many degrees of lon for the same metres
    const p = projectTrack([pt(0, lat, 0), pt(1, lat + 0.01, 0.02)], 320, 320, 16);
    expect(p[1].x - p[0].x).toBeCloseTo(p[0].y - p[1].y, 0);
  });

  it('puts a single-spot track in the centre and an empty track nowhere', () => {
    expect(projectTrack([], 320, 200)).toEqual([]);
    const [only] = projectTrack([pt(0, 44, 26), pt(1, 44, 26)], 320, 200, 16);
    expect(only).toEqual({ x: 160, y: 100, i: 0 });
  });
});

describe('scaleBar', () => {
  it('picks 500 m for a ~2 km-wide bounds at 320 px', () => {
    const km = haversineKm(0, 0, 0, 0.018); // ≈ 2.0 km
    expect(km).toBeGreaterThan(1.9);
    expect(km).toBeLessThan(2.1);
    const bar = scaleBar({ minLat: 0, maxLat: 0, minLon: 0, maxLon: 0.018 }, 320);
    expect(bar.barMetres).toBe(500);
    expect(bar.metresPerPx).toBeCloseTo((km * 1000) / 288, 1);
    expect(bar.barPx).toBeCloseTo(500 / bar.metresPerPx, 6);
    expect(formatBarLength(bar.barMetres)).toBe('500 m');
  });

  it('matches a height-bound fit when the height is passed', () => {
    const bounds = { minLat: 0, maxLat: 0.018, minLon: 0, maxLon: 0.0018 }; // tall and thin
    const widthOnly = scaleBar(bounds, 320, 16);
    const fitted = scaleBar(bounds, 320, 16, 213);
    expect(fitted.metresPerPx).toBeGreaterThan(widthOnly.metresPerPx);
    expect(formatBarLength(2000)).toBe('2 km');
  });

  it('has no scale for a single spot', () => {
    expect(scaleBar({ minLat: 1, maxLat: 1, minLon: 2, maxLon: 2 }, 320).barPx).toBe(0);
  });
});

describe('nearestPoint', () => {
  const pts = [
    { x: 10, y: 10, i: 0 },
    { x: 100, y: 100, i: 1 },
  ];
  it('returns the nearest point within 24 px, else null', () => {
    expect(nearestPoint(pts, 95, 104)?.i).toBe(1);
    expect(nearestPoint(pts, 50, 50)).toBeNull();
  });
});

describe('alignSamplesToTrack', () => {
  const samples = [
    sample(1000, { '010C': 1000, '010D': 10, '015E': 1 }),
    sample(3000, { '010C': 3000, '010D': 30, '015E': 3 }),
  ];

  it('picks the nearest sample by time; a before/after tie goes to the earlier', () => {
    const track = [pt(0, 0, 0), pt(1900, 0, 0), pt(2000, 0, 0), pt(2100, 0, 0), pt(9000, 0, 0)];
    expect(alignSamplesToTrack(track, samples, 'rpm')).toEqual([1000, 1000, 1000, 3000, 3000]);
    expect(alignSamplesToTrack(track, samples, 'fuelRate')).toEqual([1, 1, 1, 3, 3]);
  });

  it('speed prefers the GPS fix (m/s → km/h) and falls back to 010D', () => {
    const track = [pt(1000, 0, 0, 10), pt(3000, 0, 0, null)];
    const v = alignSamplesToTrack(track, samples, 'speed');
    expect(v[0]).toBeCloseTo(36, 6);
    expect(v[1]).toBe(30);
  });

  it('yields null without samples or for the none channel, and for a missing PID', () => {
    const track = [pt(0, 0, 0), pt(1, 0, 0)];
    expect(alignSamplesToTrack(track, [], 'rpm')).toEqual([null, null]);
    expect(alignSamplesToTrack(track, samples, 'none')).toEqual([null, null]);
    expect(alignSamplesToTrack(track, [sample(0, { '010D': 5 })], 'rpm')).toEqual([null, null]);
  });

  it('works on unsorted samples', () => {
    const track = [pt(2900, 0, 0)];
    expect(alignSamplesToTrack(track, [samples[1], samples[0]], 'rpm')).toEqual([3000]);
  });
});

describe('colourSegments', () => {
  const points = [0, 1, 2, 3].map((i) => ({ x: i * 10, y: 0, i }));

  it('yields n − 1 segments, coloured by fixed speed buckets, grey for null', () => {
    const segs = colourSegments(points, [10, 20, null, null], 'speed');
    expect(segs).toHaveLength(3);
    expect(segs[0]).toMatchObject({ value: 15, colour: TRACK_PALETTE[0] });
    expect(segs[1]).toMatchObject({ value: 20, colour: TRACK_PALETTE[0] }); // one end null → the other
    expect(segs[2]).toMatchObject({ value: null, colour: TRACK_NO_DATA });
  });

  it('maps the speed and rpm buckets to the palette', () => {
    const speeds = [0, 35, 65, 100, 140].map(
      (v) => colourSegments(points.slice(0, 2), [v, v], 'speed')[0].colour,
    );
    expect(speeds).toEqual([...TRACK_PALETTE]);
    const rpms = [800, 2000, 3000, 4000].map(
      (v) => colourSegments(points.slice(0, 2), [v, v], 'rpm')[0].colour,
    );
    expect(rpms).toEqual([TRACK_PALETTE[0], TRACK_PALETTE[1], TRACK_PALETTE[3], TRACK_PALETTE[4]]);
  });

  it('buckets fuel rate by the trip quartiles and draws none in the accent', () => {
    const values = [1, 2, 3, 4];
    const fuel = colourSegments(points, values, 'fuelRate').map((s) => s.colour);
    expect(fuel[0]).toBe(TRACK_PALETTE[0]); // 1.5 L/h, below q1 = 1.75
    expect(fuel[2]).toBe(TRACK_PALETTE[4]); // 3.5 L/h, above q3 = 3.25
    const none = colourSegments(points, values, 'none');
    expect(none.every((s) => s.colour === TRACK_PALETTE[0] && s.value === null)).toBe(true);
  });

  it('a steady fuel rate is one middle-colour bucket, not all "high"', () => {
    const steady = colourSegments(points, [2, 2, 2, 2], 'fuelRate').map((s) => s.colour);
    expect(steady).toEqual([TRACK_PALETTE[2], TRACK_PALETTE[2], TRACK_PALETTE[2]]);
    // A spread below the 0.1 L/h display precision is steady too.
    const flat = colourSegments(points, [2.01, 2.02, 2.03, 2.04], 'fuelRate');
    expect(flat.every((s) => s.colour === TRACK_PALETTE[2])).toBe(true);
  });
});

describe('legendFor', () => {
  it('lists the metric buckets per channel, plus No data when a value is missing', () => {
    expect(legendFor('speed', [10, 50]).map((l) => l.label)).toEqual([
      '0–30 km/h',
      '30–60 km/h',
      '60–90 km/h',
      '90–130 km/h',
      '130+ km/h',
    ]);
    expect(legendFor('rpm', [900, null]).map((l) => l.label)).toEqual([
      '0–1500 rpm',
      '1500–2500 rpm',
      '2500–3500 rpm',
      '3500+ rpm',
      'No data',
    ]);
    expect(legendFor('fuelRate', [1, 2, 3, 4]).map((l) => l.label)).toEqual([
      'under 1.8 L/h',
      '1.8–2.5 L/h',
      '2.5–3.3 L/h',
      '3.3+ L/h',
    ]);
    expect(legendFor('fuelRate', [null, null])).toEqual([
      { label: 'No data', colour: TRACK_NO_DATA },
    ]);
    expect(legendFor('none', [1])).toEqual([]);
  });

  it('never repeats a fuel-rate label: a steady or near-steady rate gets one chip', () => {
    expect(legendFor('fuelRate', [2, 2, 2, 2])).toEqual([
      { label: '2.0 L/h', colour: TRACK_PALETTE[2] },
    ]);
    expect(legendFor('fuelRate', [2.01, 2.02, 2.03, 2.04]).map((l) => l.label)).toEqual([
      '2.0 L/h',
    ]);
    expect(legendFor('fuelRate', [2.01, 2.02, 2.03, 2.04, 2.06]).map((l) => l.label)).toEqual([
      '2.0–2.1 L/h',
    ]);
    // Quartiles all at the minimum: one bucket labelled with the range the values span.
    expect(legendFor('fuelRate', [2, 2, 2, 2, 5]).map((l) => l.label)).toEqual(['2.0–5.0 L/h']);
    // Two quartiles that print the same collapse into one edge.
    const labels = legendFor('fuelRate', [1, 2, 2.01, 2.02, 4]).map((l) => l.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels).toEqual(['under 2.0 L/h', '2.0+ L/h']);
  });
});

describe('gpsVsObd', () => {
  // GPS: 10 fixes 50 m apart over 45 s = 450 m. OBD: 45 s at a speed scaled to the wanted delta.
  const track = eastTrack(10, 50);
  const gpsKm = trackDistanceKm(track);
  const kmhFor = (pct: number) => ((gpsKm * (1 + pct / 100)) / 45) * 3600;

  it.each([
    [2, 'ok'],
    [-2, 'ok'],
    [5, 'check'],
    [-5, 'check'],
    [12, 'mismatch'],
    [-12, 'mismatch'],
  ] as const)('%s %% → %s', (pct, verdict) => {
    const r = gpsVsObd(track, constantSpeed(45, kmhFor(pct)), 45_000);
    expect(r.verdict).toBe(verdict);
    expect(r.deltaPct).toBeCloseTo(pct, 6);
    expect(r.gpsKm).toBeCloseTo(0.45, 3);
    expect(r.obdKm).toBeCloseTo(gpsKm * (1 + pct / 100), 6);
    expect(r.obdAvgKmh).toBeCloseTo(kmhFor(pct), 6);
    expect(r.gpsAvgKmh).toBeCloseTo((0.45 / 45) * 3600, 1);
    expect(r.note.length).toBeGreaterThan(0);
  });

  it('uses the 3 % / 8 % thresholds', () => {
    expect([GPS_OBD_OK_PCT, GPS_OBD_CHECK_PCT]).toEqual([3, 8]);
    const verdictAt = (pct: number) =>
      gpsVsObd(track, constantSpeed(45, kmhFor(pct)), 45_000).verdict;
    expect([2.95, 3.05, 7.95, 8.05].map(verdictAt)).toEqual(['ok', 'check', 'check', 'mismatch']);
  });

  it('is unknown with one fix or without the speed PID', () => {
    const one = gpsVsObd(track.slice(0, 1), constantSpeed(45, 40), 45_000);
    expect(one.verdict).toBe('unknown');
    expect(one.deltaPct).toBeNull();
    const noSpeed = gpsVsObd(track, [sample(0, { '010C': 800 })], 45_000);
    expect(noSpeed).toMatchObject({ verdict: 'unknown', obdKm: null, obdAvgKmh: null });
  });
});

describe('speedProfile', () => {
  it('uses 010D and caps at maxPoints, keeping the first and last point', () => {
    const samples = Array.from({ length: 1000 }, (_, k) => sample(k * 100, { '010D': k }));
    const p = speedProfile(samples, [], 50);
    expect(p).toHaveLength(50);
    expect(p[0]).toEqual({ t: 0, kmh: 0 });
    expect(p[49]).toEqual({ t: 99_900, kmh: 999 });
    expect(speedProfile(samples, [])).toHaveLength(300);
  });

  it('falls back to the GPS fix speed when no sample carries 010D', () => {
    const p = speedProfile([sample(0, { '010C': 900 })], [pt(0, 0, 0, 10), pt(5000, 0, 0, null)]);
    expect(p).toHaveLength(1);
    expect(p[0].kmh).toBeCloseTo(36, 6);
  });
});

describe('syntheticLoopPoint', () => {
  const metres = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) =>
    haversineKm(a.lat, a.lon, b.lat, b.lon) * 1000;

  it('starts at the origin and closes after one loop length (within 1 m)', () => {
    const start = syntheticLoopPoint(0);
    expect(start.lat).toBeCloseTo(SYNTHETIC_ORIGIN.lat, 9);
    expect(start.lon).toBeCloseTo(SYNTHETIC_ORIGIN.lon, 9);
    expect(metres(start, syntheticLoopPoint(SYNTHETIC_LOOP_LENGTH_M))).toBeLessThan(1);
    // Approaching the end from below also lands on the origin (the last corner closes the loop).
    expect(metres(start, syntheticLoopPoint(SYNTHETIC_LOOP_LENGTH_M - 0.001))).toBeLessThan(1);
  });

  it('is a 2 km loop: 1 m steps sum to the loop length and each step is ~1 m', () => {
    let total = 0;
    let prev = syntheticLoopPoint(0);
    for (let d = 1; d <= SYNTHETIC_LOOP_LENGTH_M; d++) {
      const next = syntheticLoopPoint(d);
      const step = metres(prev, next);
      expect(step).toBeGreaterThan(0.99);
      expect(step).toBeLessThan(1.01);
      total += step;
      prev = next;
    }
    expect(total).toBeGreaterThan(1995);
    expect(total).toBeLessThan(2005);
    // Halfway round it is far from the start (a loop, not a line back and forth).
    expect(metres(syntheticLoopPoint(0), syntheticLoopPoint(1000))).toBeGreaterThan(300);
  });
});

describe('syntheticLoopAdvance', () => {
  const metres = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) =>
    haversineKm(a.lat, a.lon, b.lat, b.lon) * 1000;

  it('is plain addition on a straight and a matched chord across a corner', () => {
    expect(syntheticLoopAdvance(100, 50)).toBe(150);
    expect(syntheticLoopAdvance(100, 0)).toBe(100);
    // 480 m → 180 m on cuts the first 60 m-radius corner: it lands past 660 m along the loop.
    const to = syntheticLoopAdvance(480, 180);
    expect(to).toBeGreaterThan(660);
    expect(metres(syntheticLoopPoint(480), syntheticLoopPoint(to))).toBeCloseTo(180, 3);
  });

  it.each([40, 90, 130])(
    'fixes 5 s apart at %i km/h: the straight-line track distance equals the distance driven',
    (kmh) => {
      const stepM = (kmh / 3.6) * 5;
      const track: TrackPoint[] = [];
      let d = 0;
      for (let k = 0; k <= 400; k++) {
        if (k > 0) d = syntheticLoopAdvance(d, stepM);
        track.push(pt(k * 5000, syntheticLoopPoint(d).lat, syntheticLoopPoint(d).lon));
      }
      const drivenM = stepM * 400;
      expect(Math.abs(trackDistanceKm(track) * 1000 - drivenM) / drivenM).toBeLessThan(1e-6);
    },
  );
});
