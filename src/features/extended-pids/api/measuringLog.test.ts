import {
  buildMeasuringLogCsv,
  resetMeasuringLog,
  appendMeasuringRow,
  getMeasuringLog,
  measuringLogSize,
  MeasuringLogRow,
} from './measuringLog';

describe('buildMeasuringLogCsv', () => {
  it('emits a header-only CSV for no rows', () => {
    expect(buildMeasuringLogCsv([])).toBe('timestamp_iso,epoch_ms,did,name,value,unit\n');
  });

  it('writes one row per sample with the documented columns', () => {
    const rows: MeasuringLogRow[] = [
      { t: 1000, did: '1708', name: 'EGR valve position', value: 25, unit: '%' },
    ];
    const lines = buildMeasuringLogCsv(rows).trim().split('\n');
    expect(lines[0]).toBe('timestamp_iso,epoch_ms,did,name,value,unit');
    expect(lines[1]).toBe(`${new Date(1000).toISOString()},1000,1708,EGR valve position,25,%`);
  });

  it('sorts by time then DID and renders null values as empty', () => {
    const rows: MeasuringLogRow[] = [
      { t: 2000, did: '1701', name: 'Soot mass', value: 12, unit: 'g' },
      { t: 1000, did: '1708', name: 'EGR', value: null, unit: '%' },
      { t: 1000, did: '1701', name: 'Soot mass', value: 11, unit: 'g' },
    ];
    const body = buildMeasuringLogCsv(rows).trim().split('\n').slice(1);
    expect(body.map((l) => l.split(',').slice(1, 3).join(':'))).toEqual([
      '1000:1701',
      '1000:1708',
      '2000:1701',
    ]);
    // The null value leaves an empty field between did and unit.
    expect(body[1]).toContain('1708,EGR,,%');
  });

  it('quotes fields containing a comma', () => {
    const csv = buildMeasuringLogCsv([
      { t: 0, did: '1709', name: 'Injection quantity, cyl 1', value: 1.5, unit: 'mg/str' },
    ]);
    expect(csv).toContain('"Injection quantity, cyl 1"');
  });
});

describe('module-level measuring-log buffer', () => {
  beforeEach(() => resetMeasuringLog());

  it('accumulates rows and reports its size, and reset clears it', () => {
    expect(measuringLogSize()).toBe(0);
    appendMeasuringRow({ t: 1, did: '1701', name: 'x', value: 1, unit: 'g' });
    appendMeasuringRow({ t: 2, did: '1701', name: 'x', value: 2, unit: 'g' });
    expect(measuringLogSize()).toBe(2);
    expect(getMeasuringLog().map((r) => r.value)).toEqual([1, 2]);
    resetMeasuringLog();
    expect(measuringLogSize()).toBe(0);
  });
});
