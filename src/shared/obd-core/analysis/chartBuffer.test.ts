import { ChartBuffer, decimate, seriesStats, Point } from './chartBuffer';

describe('ChartBuffer', () => {
  it('drops the oldest beyond capacity', () => {
    const b = new ChartBuffer(3);
    for (let i = 0; i < 5; i++) b.push({ t: i, v: i });
    expect(b.size).toBe(3);
    expect(b.all()[0].t).toBe(2);
  });

  it('filters to a time window', () => {
    const b = new ChartBuffer();
    for (let i = 0; i < 10; i++) b.push({ t: i * 1000, v: i });
    expect(b.window(3000, 9000).every((p) => p.t >= 6000)).toBe(true);
  });

  it('excludes points after `now` (upper bound)', () => {
    const b = new ChartBuffer();
    b.push({ t: 1000, v: 1 });
    b.push({ t: 5000, v: 5 }); // "future" relative to now=3000
    expect(b.window(10000, 3000).map((p) => p.t)).toEqual([1000]);
  });

  it('supports panning by ending the window before the latest point (end offset)', () => {
    const b = new ChartBuffer();
    for (let i = 0; i < 10; i++) b.push({ t: i * 1000, v: i });
    // Latest is t=9000; pan back 4000 ms → window [2000, 5000].
    const last = b.bounds()!.last;
    const panned = b.window(3000, last - 4000);
    expect(panned.map((p) => p.t)).toEqual([2000, 3000, 4000, 5000]);
  });

  it('reports bounds, or null when empty', () => {
    expect(new ChartBuffer().bounds()).toBeNull();
    const b = new ChartBuffer();
    b.push({ t: 100, v: 1 });
    b.push({ t: 400, v: 4 });
    expect(b.bounds()).toEqual({ first: 100, last: 400 });
  });
});

describe('decimate', () => {
  it('reduces to at most maxPoints buckets (×2 for min/max) and preserves extremes', () => {
    const pts: Point[] = [];
    for (let i = 0; i < 1000; i++) pts.push({ t: i, v: Math.sin(i / 10) });
    const d = decimate(pts, 50);
    expect(d.length).toBeLessThanOrEqual(100);
    const max = Math.max(...d.map((p) => p.v));
    expect(max).toBeCloseTo(1, 1);
  });

  it('returns input when already small', () => {
    const pts: Point[] = [{ t: 0, v: 1 }];
    expect(decimate(pts, 50)).toHaveLength(1);
  });
});

describe('seriesStats', () => {
  it('reports min/max/current', () => {
    const s = seriesStats([
      { t: 0, v: 5 },
      { t: 1, v: 9 },
      { t: 2, v: 3 },
    ]);
    expect(s).toEqual({ min: 3, max: 9, current: 3 });
    expect(seriesStats([])).toBeNull();
  });
});
