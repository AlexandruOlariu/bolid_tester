import {
  SpeedSample,
  timeToSpeed,
  cumulativeDistance,
  computeAccelRun,
  computeDragRun,
  computeBrakeRun,
} from './performance';

/** Build a constant-acceleration ramp from 0 to `topKmh` over `seconds`, sampled at `hz`. */
function ramp(topKmh: number, seconds: number, hz: number, t0 = 1000): SpeedSample[] {
  const out: SpeedSample[] = [];
  const n = Math.round(seconds * hz);
  for (let i = 0; i <= n; i++) {
    const t = t0 + (i / hz) * 1000;
    out.push({ t, speed: (topKmh * i) / n });
  }
  return out;
}

describe('performance math', () => {
  it('interpolates time-to-speed (relative to launch)', () => {
    const s = ramp(100, 10, 20); // 0→100 in 10 s
    expect(timeToSpeed(s, 100)).toBeCloseTo(10000, -2);
    expect(timeToSpeed(s, 50)).toBeCloseTo(5000, -2);
    expect(timeToSpeed(s, 200)).toBeNull();
  });

  it('integrates distance (constant accel: ½·a·t²)', () => {
    const s = ramp(100, 10, 50); // a = (100/3.6)/10 ≈ 2.778 m/s²; d = ½·a·100 ≈ 138.9 m
    const dist = cumulativeDistance(s);
    expect(dist[dist.length - 1]).toBeCloseTo(138.9, 0);
  });

  it('computes a 0–100 accel run with splits', () => {
    const r = computeAccelRun(ramp(100, 9, 20), 100);
    expect(r.timeMs).toBeCloseTo(9000, -2);
    expect(r.maxKmh).toBeCloseTo(100, 0);
    expect(r.splits[0].toKmh).toBe(50);
    expect(r.sampleRateHz).toBeCloseTo(20, 0);
  });

  it('computes a ¼-mile time + trap speed', () => {
    const drag = computeDragRun(ramp(200, 18, 50));
    expect(drag.quarterMile).not.toBeNull();
    expect(drag.quarterMile!.trapKmh).toBeGreaterThan(0);
    expect(drag.sixtyFtMs).not.toBeNull();
  });

  it('measures a braking event 100→0', () => {
    // accelerate to 100, then decelerate to 0
    const up = ramp(100, 8, 50);
    const lastT = up[up.length - 1].t;
    const down: SpeedSample[] = [];
    for (let i = 1; i <= 200; i++) down.push({ t: lastT + i * 20, speed: Math.max(0, 100 - (100 * i) / 200) });
    const r = computeBrakeRun([...up, ...down], 100, 0);
    expect(r.timeMs).not.toBeNull();
    expect(r.distanceM).toBeGreaterThan(0);
  });
});
