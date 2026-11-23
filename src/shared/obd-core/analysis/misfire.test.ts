import type { Mode06Result } from '../obd/mode06';
import {
  assessMisfire,
  MISFIRE_MIDS,
  MISFIRE_MIN_COUNT,
  MISFIRE_TID_CYCLE,
  MISFIRE_TID_EWMA,
} from './misfire';

/** A Mode 06 misfire-count result for `mid`/`tid` with the count as its test value. */
function m(mid: number, tid: number, value: number): Mode06Result {
  return { mid, tid, value, min: 0, max: 0xffff, pass: true, unit: 'count' };
}

describe('assessMisfire', () => {
  it('one cylinder far above the rest', () =>
    expect(
      assessMisfire([m(0xa2, 0x0c, 1), m(0xa3, 0x0c, 14), m(0xa4, 0x0c, 2), m(0xa5, 0x0c, 0)]),
    ).toMatchObject({ id: 'cylinder', cylinder: 2, severity: 'warn' }));

  it('spread across cylinders is random', () =>
    expect(
      assessMisfire([m(0xa2, 0x0c, 4), m(0xa3, 0x0c, 3), m(0xa4, 0x0c, 4), m(0xa5, 0x0c, 3)]).id,
    ).toBe('random'));

  it('falls back to the EWMA test', () =>
    expect(assessMisfire([m(0xa2, 0x0b, 9), m(0xa3, 0x0b, 0)]).id).toBe('cylinder'));

  it('no misfire monitors', () =>
    expect(assessMisfire([m(0x01, 0x8e, 1)])).toMatchObject({ id: 'no_data', severity: 'info' }));

  it('exposes the monitor constants', () => {
    expect(MISFIRE_MIDS).toEqual(['A2', 'A3', 'A4', 'A5']);
    expect([MISFIRE_TID_CYCLE, MISFIRE_TID_EWMA, MISFIRE_MIN_COUNT]).toEqual([0x0c, 0x0b, 5]);
  });

  it('counts per cylinder from the cycle test, preferring it over EWMA', () => {
    const r = assessMisfire([
      m(0xa2, 0x0b, 30),
      m(0xa2, 0x0c, 1),
      m(0xa3, 0x0b, 2),
      m(0xa4, 0x0c, 0),
      m(0x01, 0x0c, 99),
    ]);
    expect(r.counts).toEqual({ 1: 1, 2: 2, 3: 0 });
    expect(r).toMatchObject({ id: 'none', severity: 'ok' });
    expect(r.cylinder).toBeUndefined();
  });

  it('a cylinder below the minimum count is not singled out', () =>
    expect(assessMisfire([m(0xa2, 0x0c, 4), m(0xa3, 0x0c, 0)])).toMatchObject({
      id: 'none',
      severity: 'ok',
    }));

  it('two cylinders close together are random, not one cylinder', () =>
    expect(assessMisfire([m(0xa2, 0x0c, 8), m(0xa3, 0x0c, 5), m(0xa4, 0x0c, 0)])).toMatchObject({
      id: 'random',
      severity: 'warn',
    }));

  it('exactly twice the next highest is one cylinder', () =>
    expect(assessMisfire([m(0xa4, 0x0c, 10), m(0xa5, 0x0c, 5)])).toMatchObject({
      id: 'cylinder',
      cylinder: 3,
    }));

  it('a small total spread over cylinders is none', () =>
    expect(
      assessMisfire([m(0xa2, 0x0c, 3), m(0xa3, 0x0c, 3), m(0xa4, 0x0c, 3), m(0xa5, 0x0c, 0)]).id,
    ).toBe('none'));

  it('misfire MIDs without a count test are no data', () =>
    expect(assessMisfire([m(0xa2, 0x01, 7)])).toMatchObject({ id: 'no_data', counts: {} }));

  it('an empty result list is no data', () =>
    expect(assessMisfire([])).toMatchObject({ id: 'no_data', severity: 'info', counts: {} }));
});
