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
