/** Chart geometry (plan 21): the plot maps onto the measured width / height, not a fixed 320 × 120. */
import { chartHeight, msPerPx, toScreen, DEFAULT_CHART_WIDTH } from './chartGeometry';

describe('toScreen', () => {
  const two = [
    { t: 1_000, v: 10 },
    { t: 61_000, v: 30 },
  ];

  it.each([
    [320, 120],
    [600, 220],
    [1000, 220],
  ])('a two-point series spans x [0, %d] and y [0, %d]', (w, h) => {
    const { screen, polyline } = toScreen(two, w, h);
    expect(screen.map((p) => p.x)).toEqual([0, w]);
    // Lowest value at the bottom (y = h), highest at the top (y = 0).
    expect(screen.map((p) => p.y)).toEqual([h, 0]);
    expect(polyline).toBe(`0.0,${h}.0 ${w}.0,0.0`);
  });

  it('keeps the sample time and value for tap-inspect', () => {
    const { screen } = toScreen(two, 500, 200);
    expect(screen[1]).toMatchObject({ t: 61_000, v: 30 });
  });

  it('a flat or single-point series does not divide by zero', () => {
    expect(toScreen([{ t: 5, v: 7 }], 400, 150).screen[0]).toMatchObject({ x: 0, y: 150 });
    expect(toScreen([], 400, 150)).toEqual({ screen: [], polyline: '' });
  });
});

describe('chartHeight', () => {
  it('is 3:8 of the width, capped at 220', () => {
    expect(chartHeight(DEFAULT_CHART_WIDTH)).toBe(120);
    expect(chartHeight(400)).toBe(150);
    expect(chartHeight(586)).toBe(220);
    expect(chartHeight(1200)).toBe(220);
  });
});

describe('msPerPx', () => {
  it('is the window over the plot width', () => {
    expect(msPerPx(60_000, 320)).toBe(187.5);
    expect(msPerPx(60_000, 600)).toBe(100);
  });

  it('never divides by zero before the panel is measured', () => {
    expect(msPerPx(60_000, 0)).toBe(60_000);
  });
});
