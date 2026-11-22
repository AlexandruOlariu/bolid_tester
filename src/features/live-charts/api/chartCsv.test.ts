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
      '010C': [
        { t: 2000, v: 900 },
        { t: 1000, v: 800 },
      ],
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

  it('adds a label column for a mixed Mode 01 / extended panel', () => {
    const csv = seriesToCsv(
      { '010C': [{ t: 1000, v: 820 }], '22:1701': [{ t: 2000, v: 12 }] },
      { '010C': 'Engine RPM (rpm)', '22:1701': 'DPF soot mass, calc. (g) · 1701' },
    );
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('pid,timestamp_iso,epoch_ms,value,label');
    expect(lines[1]).toBe(`010C,${new Date(1000).toISOString()},1000,820,Engine RPM (rpm)`);
    // A label with a comma is quoted.
    expect(lines[2]).toBe(
      `22:1701,${new Date(2000).toISOString()},2000,12,"DPF soot mass, calc. (g) · 1701"`,
    );
  });

  it('falls back to the key when a label is missing', () => {
    const csv = seriesToCsv({ '22:ABCD': [{ t: 1, v: 1 }] }, {});
    expect(csv.trim().split('\n')[1].endsWith(',22:ABCD')).toBe(true);
  });
});
