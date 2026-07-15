import {
  DRIVE_CYCLE_PATTERNS,
  GENERIC_DRIVE_CYCLE,
  driveCyclePattern,
} from './driveCycle';
import { SPARK_MONITOR_NAMES, COMPRESSION_MONITOR_NAMES } from './readiness';

describe('drive-cycle dictionary', () => {
  it('every pattern has a summary and at least one step', () => {
    for (const [name, p] of Object.entries(DRIVE_CYCLE_PATTERNS)) {
      expect(p.monitor).toBe(name);
      expect(p.summary.length).toBeGreaterThan(0);
      expect(p.steps.length).toBeGreaterThan(0);
      expect(p.steps.every((s) => s.length > 0)).toBe(true);
    }
  });

  it('covers every standard non-continuous monitor name (spark + compression)', () => {
    const covered = new Set(Object.keys(DRIVE_CYCLE_PATTERNS));
    for (const name of [...SPARK_MONITOR_NAMES, ...COMPRESSION_MONITOR_NAMES]) {
      if (name) expect(covered.has(name)).toBe(true);
    }
  });

  it('looks a monitor up by name', () => {
    const cat = driveCyclePattern('Catalyst');
    expect(cat.monitor).toBe('Catalyst');
    expect(cat.summary).toMatch(/cruise/i);
  });

  it('falls back to the generic cycle for an unknown monitor, tagged with its name', () => {
    const p = driveCyclePattern('Totally unknown monitor');
    expect(p.summary).toBe(GENERIC_DRIVE_CYCLE.summary);
    expect(p.steps).toEqual(GENERIC_DRIVE_CYCLE.steps);
    expect(p.monitor).toBe('Totally unknown monitor');
  });
});
