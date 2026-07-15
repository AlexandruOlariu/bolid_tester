import { seriesToCsv } from './chartCsv';

describe('seriesToCsv', () => {
  it('emits a header only for empty input', () => {
    expect(seriesToCsv({})).toBe('pid,timestamp_iso,epoch_ms,value\n');
    expect(seriesToCsv({ '010C': [] })).toBe('pid,timestamp_iso,epoch_ms,value\n');
  });

  it('writes one row per sample in long format', () => {
    const csv = seriesToCsv({ '010C': [{ t: 1000, v: 850 }] });
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('pid,timestamp_iso,epoch_ms,value');
    expect(lines[1]).toBe(`010C,${new Date(1000).toISOString()},1000,850`);
  });

  it('interleaves overlaid PIDs sorted by time then pid', () => {
    const csv = seriesToCsv({
      '010C': [{ t: 2000, v: 900 }, { t: 1000, v: 800 }],
      '0105': [{ t: 1000, v: 80 }],
    });
    const pids = csv
      .trim()
      .split('\n')
      .slice(1)
      .map((l) => l.split(',')[0]);
    // t=1000 has 0105 then 010C (pid-sorted), then t=2000 010C.
    expect(pids).toEqual(['0105', '010C', '010C']);
  });
});
