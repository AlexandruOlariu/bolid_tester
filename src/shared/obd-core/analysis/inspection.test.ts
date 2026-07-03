import { assessInspection } from './inspection';
import type { MonitorStatus, Monitor } from '../obd/readiness';
import type { Dtc } from '../obd/dtc';

function dtc(code: string): Dtc {
  return { code, description: code };
}

function readiness(milOn: boolean, completeFlags: boolean[]): MonitorStatus {
  const monitors: Monitor[] = completeFlags.map((complete, i) => ({
    id: `m${i}`,
    name: `Monitor ${i}`,
    supported: true,
    complete,
  }));
  return { milOn, dtcCount: 0, ignition: 'compression', monitors };
}

describe('used-car inspection', () => {
  it('passes a clean car', () => {
    const r = assessInspection({
      vinValid: true,
      readiness: readiness(false, [true, true, true, true, true]),
      stored: [],
      pending: [],
      permanent: [],
    });
    expect(r.verdict).toBe('pass');
    expect(r.score).toBe(100);
  });

  it('fails when the MIL is on with stored codes', () => {
    const r = assessInspection({
      vinValid: true,
      readiness: readiness(true, [true, true, true, true, true]),
      stored: [dtc('P0299')],
      pending: [],
      permanent: [],
    });
    expect(r.verdict).toBe('fail');
    expect(r.checks.find((c) => c.id === 'mil')?.status).toBe('fail');
  });

  it('fails on a permanent (uncleared) code', () => {
    const r = assessInspection({
      vinValid: true,
      readiness: readiness(false, [true, true, true, true, true]),
      stored: [],
      pending: [],
      permanent: [dtc('P0401')],
    });
    expect(r.verdict).toBe('fail');
  });

  it('cautions on the recently-cleared tell (many not-ready + short distance)', () => {
    const r = assessInspection({
      vinValid: true,
      readiness: readiness(false, [false, false, false, false, true]),
      stored: [],
      pending: [],
      permanent: [],
      distanceSinceClearKm: 12,
    });
    expect(r.verdict).toBe('caution');
    expect(r.checks.find((c) => c.id === 'recently-cleared')).toBeTruthy();
  });

  it('treats pending codes as a caution', () => {
    const r = assessInspection({
      vinValid: true,
      readiness: readiness(false, [true, true, true, true, true]),
      stored: [],
      pending: [dtc('P0133')],
      permanent: [],
    });
    expect(r.verdict).toBe('caution');
  });

  it('does NOT imply tampering when distance-since-clear is unknown (PID 31 unsupported)', () => {
    const r = assessInspection({
      vinValid: true,
      readiness: readiness(false, [false, false, false, false, true]),
      stored: [],
      pending: [],
      permanent: [],
      // distanceSinceClearKm omitted — no positive evidence of a recent clear
    });
    expect(r.checks.find((c) => c.id === 'recently-cleared')).toBeUndefined();
    expect(r.checks.find((c) => c.id === 'readiness')?.status).toBe('info');
    expect(r.verdict).toBe('pass'); // not-ready monitors alone carry no penalty
  });

  it('does NOT warn when many monitors are not ready but distance is long', () => {
    const r = assessInspection({
      vinValid: true,
      readiness: readiness(false, [false, false, false, false, true]),
      stored: [],
      pending: [],
      permanent: [],
      distanceSinceClearKm: 4200,
    });
    expect(r.checks.find((c) => c.id === 'recently-cleared')).toBeUndefined();
    expect(r.verdict).toBe('pass');
  });
});


describe('IUPR checks', () => {
  const baseInput = {
    vinValid: true,
    readiness: null,
    stored: [],
    pending: [],
    permanent: [],
  };
  const monitors = (ratio: number | null, conditions = 400) => [
    { name: 'PM filter', completions: ratio === null ? 0 : Math.round(ratio * conditions), conditions, ratio },
  ];

  it('warns on near-zero counters (recently cleared memory)', () => {
    const r = assessInspection({
      ...baseInput,
      iupr: { variant: 'compression', obdConditions: 8, ignitionCycles: 12, monitors: monitors(0.5) },
    });
    const c = r.checks.find((c) => c.id === 'iupr');
    expect(c?.status).toBe('warn');
    expect(c?.detail).toMatch(/recently cleared/i);
  });

  it('passes with healthy counters and flags low ratios as info', () => {
    const pass = assessInspection({
      ...baseInput,
      iupr: { variant: 'compression', obdConditions: 1500, ignitionCycles: 1800, monitors: monitors(0.75) },
    });
    expect(pass.checks.find((c) => c.id === 'iupr')?.status).toBe('pass');

    const info = assessInspection({
      ...baseInput,
      iupr: { variant: 'spark', obdConditions: 800, ignitionCycles: 900, monitors: monitors(0.02) },
    });
    expect(info.checks.find((c) => c.id === 'iupr')?.status).toBe('info');
  });

  it('adds no IUPR check when the ECU does not answer', () => {
    const r = assessInspection({ ...baseInput, iupr: null });
    expect(r.checks.find((c) => c.id === 'iupr')).toBeUndefined();
  });
});
