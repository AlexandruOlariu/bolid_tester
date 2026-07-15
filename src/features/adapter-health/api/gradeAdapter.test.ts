import { gradeAdapter, summarizeLatency } from './gradeAdapter';

describe('summarizeLatency', () => {
  it('returns null for no completed commands', () => {
    expect(summarizeLatency([])).toBeNull();
    expect(summarizeLatency([NaN, -5])).toBeNull();
  });

  it('computes min/median/max over an odd count', () => {
    expect(summarizeLatency([30, 10, 20])).toEqual({ min: 10, median: 20, max: 30, count: 3 });
  });

  it('averages the two middle values for an even count', () => {
    expect(summarizeLatency([10, 20, 30, 40])).toEqual({ min: 10, median: 25, max: 40, count: 4 });
  });

  it('drops non-finite / negative samples', () => {
    expect(summarizeLatency([40, NaN, 20, -1])).toEqual({ min: 20, median: 30, max: 40, count: 2 });
  });
});

describe('gradeAdapter', () => {
  const CAN = 'ISO 15765-4 CAN (11-bit, 500 kbps)';
  const KLINE = 'ISO 9141-2 (K-line)';

  it('grades a fast genuine-looking CAN adapter "good"', () => {
    const r = gradeAdapter({
      version: 'ELM327 v1.4b',
      voltage: 13.9,
      protocol: CAN,
      latenciesMs: [20, 25, 30, 22, 28],
    });
    expect(r.grade).toBe('good');
    expect(r.cloneSuspected).toBe(false);
    expect(r.latency).toEqual({ min: 20, median: 25, max: 30, count: 5 });
  });

  it('caps a clone version string at "ok" even when fast', () => {
    const r = gradeAdapter({
      version: 'ELM327 v1.5',
      voltage: 14.0,
      protocol: CAN,
      latenciesMs: [20, 25, 30],
    });
    expect(r.cloneSuspected).toBe(true);
    expect(r.grade).toBe('ok');
    expect(r.notes.some((n) => /clone/i.test(n))).toBe(true);
  });

  it('grades a slow CAN adapter "poor"', () => {
    const r = gradeAdapter({
      version: 'ELM327 v1.4',
      voltage: 13.8,
      protocol: CAN,
      latenciesMs: [200, 250, 300],
    });
    expect(r.grade).toBe('poor');
  });

  it('is more forgiving of K-line latency (slower budget)', () => {
    const median = [120, 130, 140];
    expect(gradeAdapter({ version: 'x', voltage: 13, protocol: CAN, latenciesMs: median }).grade).toBe('ok');
    // Same latency on K-line is still within the "good" budget.
    expect(gradeAdapter({ version: 'x', voltage: 13, protocol: KLINE, latenciesMs: median }).grade).toBe('good');
  });

  it('flags low supply voltage', () => {
    const r = gradeAdapter({ version: 'x', voltage: 11.2, protocol: CAN, latenciesMs: [20] });
    expect(r.notes.some((n) => /low/i.test(n))).toBe(true);
  });

  it('flags a missing voltage reading', () => {
    const r = gradeAdapter({ version: 'x', voltage: null, protocol: CAN, latenciesMs: [20] });
    expect(r.notes.some((n) => /voltage/i.test(n))).toBe(true);
  });

  it('grades a non-answering adapter "poor" with no latency', () => {
    const r = gradeAdapter({ version: '', voltage: 12.4, protocol: CAN, latenciesMs: [] });
    expect(r.grade).toBe('poor');
    expect(r.latency).toBeNull();
    expect(r.notes.some((n) => /ATI|firmware/i.test(n))).toBe(true);
    expect(r.notes.some((n) => /not answering/i.test(n))).toBe(true);
  });
});
