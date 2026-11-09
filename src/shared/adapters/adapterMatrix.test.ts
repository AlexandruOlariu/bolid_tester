import {
  adapterSlug,
  buildAdapterMatrix,
  GENERATED_MARKER,
  groupAdapterReports,
  isPlaceholderDeviceName,
  PLACEHOLDER_DEVICE_NAMES,
  reportDeviceName,
  reportFileName,
  validateAdapterReport,
} from './adapterMatrix';
import { sampleReport } from './testing/sampleReport';

describe('adapterSlug', () => {
  it('normalises the device name and the firmware', () => {
    expect(adapterSlug('IOS-Vlink', 'ELM327 v2.2')).toBe('ios-vlink__elm327-v2-2');
    expect(adapterSlug('  OBDII  ', 'ELM327 v1.5')).toBe('obdii__elm327-v1-5');
  });

  it('uses "unknown" for a missing name or firmware', () => {
    expect(adapterSlug(null, 'ELM327 v2.2')).toBe('unknown__elm327-v2-2');
    expect(adapterSlug('Vgate', '')).toBe('vgate__unknown');
    expect(adapterSlug('---', '!!')).toBe('unknown__unknown');
  });

  it('names a report file <slug>__<date>.json', () => {
    expect(reportFileName(sampleReport({ ranAt: '2026-11-03T08:00:00.000Z' }))).toBe(
      'ios-vlink__elm327-v2-2__2026-11-03.json',
    );
  });
});

describe('validateAdapterReport', () => {
  it('accepts a valid report', () => {
    expect(validateAdapterReport(sampleReport())).toEqual([]);
  });

  it('refuses simulator reports unless allowed', () => {
    const r = sampleReport({ link: 'mock' });
    expect(validateAdapterReport(r).join('\n')).toMatch(/simulator/);
    expect(validateAdapterReport(r, { allowMock: true })).toEqual([]);
  });

  it('rejects a wrong schema, bad types and a bad date', () => {
    const r = { ...sampleReport(), schema: 2, ranAt: 'yesterday' } as unknown;
    const problems = validateAdapterReport(r);
    expect(problems).toContain('"schema" must be 1');
    expect(problems).toContain('"ranAt" must be an ISO date-time string');
    expect(validateAdapterReport('nope')).toEqual(['the report is not a JSON object']);
    const bad = sampleReport() as unknown as {
      grade: { grade: string };
      measurements: { attempts: number };
    };
    bad.grade.grade = 'great';
    bad.measurements.attempts = -1;
    const p2 = validateAdapterReport(bad);
    expect(p2.some((x) => x.startsWith('"grade.grade"'))).toBe(true);
    expect(p2.some((x) => x.startsWith('"measurements.attempts"'))).toBe(true);
  });

  it('rejects private extras: a VIN in vehicle, a location at the top level', () => {
    const r = sampleReport() as unknown as Record<string, unknown> & {
      vehicle: Record<string, unknown>;
    };
    r.vehicle.vin = 'WVWZZZ1KZ9W000000';
    r.location = { lat: 44.4, lon: 26.1 };
    const problems = validateAdapterReport(r);
    expect(problems.some((p) => p.includes('vehicle.vin'))).toBe(true);
    expect(problems.some((p) => p.includes('"location"'))).toBe(true);
  });

  it('rejects extras inside app, adapter, measurements, latency and grade too', () => {
    const r = sampleReport() as unknown as Record<string, Record<string, unknown>> & {
      measurements: Record<string, unknown> & { latency: Record<string, unknown> };
    };
    r.app.location = 'Bucharest';
    r.adapter.mac = 'AA:BB:CC:DD:EE:FF';
    r.adapter.vin = 'WVWZZZ1KZ9W000000';
    r.measurements.gps = { lat: 44.4, lon: 26.1 };
    r.measurements.latency.vin = 'x';
    r.grade.owner = 'someone';
    const problems = validateAdapterReport(r);
    for (const f of [
      'app.location',
      'adapter.mac',
      'adapter.vin',
      'measurements.gps',
      'measurements.latency.vin',
      'grade.owner',
    ])
      expect(problems.some((p) => p.includes(`"${f}"`))).toBe(true);
    expect(validateAdapterReport(sampleReport())).toEqual([]);
  });

  it('refuses a connect-flow stand-in name ("Wi-Fi ELM327") — an unnamed adapter is null', () => {
    for (const name of PLACEHOLDER_DEVICE_NAMES) {
      const r = sampleReport({ deviceName: name });
      expect(validateAdapterReport(r).some((p) => p.startsWith('"adapter.deviceName"'))).toBe(true);
    }
    expect(validateAdapterReport(sampleReport({ deviceName: null }))).toEqual([]);
  });
});

describe('placeholder device names', () => {
  it('maps the stand-ins and blanks to null and keeps real advertised names', () => {
    expect(isPlaceholderDeviceName('Wi-Fi ELM327')).toBe(true);
    expect(isPlaceholderDeviceName(' bluetooth le adapter ')).toBe(true);
    expect(isPlaceholderDeviceName('Classic Bluetooth adapter')).toBe(true);
    expect(isPlaceholderDeviceName('IOS-Vlink')).toBe(false);
    expect(isPlaceholderDeviceName(null)).toBe(false);
    expect(reportDeviceName('Wi-Fi ELM327')).toBeNull();
    expect(reportDeviceName('  ')).toBeNull();
    expect(reportDeviceName(undefined)).toBeNull();
    expect(reportDeviceName(' IOS-Vlink ')).toBe('IOS-Vlink');
  });
});

describe('groupAdapterReports', () => {
  it('groups by slug with counts, the median of medians, and a worse-grade tie-break', () => {
    const groups = groupAdapterReports([
      sampleReport({ median: 20, grade: 'good', ranAt: '2026-11-01T10:00:00.000Z' }),
      sampleReport({ median: 31, grade: 'ok', platform: 'ios', ranAt: '2026-11-04T10:00:00.000Z' }),
      sampleReport({
        deviceName: 'OBDII',
        firmware: 'ELM327 v1.5',
        median: 120,
        grade: 'poor',
        cloneSuspected: true,
      }),
    ]);
    expect(groups.map((g) => g.slug)).toEqual(['ios-vlink__elm327-v2-2', 'obdii__elm327-v1-5']);
    const [vlink, obd] = groups;
    expect(vlink.reports).toHaveLength(2);
    expect(vlink.medianMs).toBe(25.5);
    expect(vlink.typicalGrade).toBe('ok'); // one good, one ok: the worse wins the tie
    expect(vlink.platforms).toEqual(['android', 'ios']);
    expect(vlink.lastReport).toBe('2026-11-04');
    expect(vlink.nameHints).toEqual(['ios-vlink']);
    expect(obd.cloneSuspectedRatio).toBe(1);
  });

  it('has a null median when no report answered', () => {
    expect(
      groupAdapterReports([sampleReport({ median: null, grade: 'poor' })])[0].medianMs,
    ).toBeNull();
  });
});

describe('buildAdapterMatrix', () => {
  it('renders the header and "No reports yet" with zero reports', () => {
    const b = buildAdapterMatrix([]);
    expect(b.matrix.startsWith(GENERATED_MARKER)).toBe(true);
    expect(b.matrix).toContain('from 0 reports.');
    expect(b.matrix).toContain(
      '| Adapter | Firmware | Link | Reports | Typical grade | Median ms |',
    );
    expect(b.matrix).toContain('No reports yet');
    expect(b.pages).toEqual({});
    expect(b.knownAdaptersJson).toBe('[]\n');
  });

  it('renders one row and one page per adapter, plus the guide link', () => {
    const b = buildAdapterMatrix(
      [
        sampleReport({ median: 20 }),
        sampleReport({ median: 30, ranAt: '2026-11-02T09:00:00.000Z' }),
      ],
      { extraDocs: { 'ios-vlink': '../adapter-vgate-icar-pro.md' } },
    );
    expect(b.matrix).toContain('from 2 reports (latest 2026-11-02).');
    expect(b.matrix).toContain(
      '| IOS-Vlink | ELM327 v2.2 | ble | 2 | GOOD | 25 | ISO 15765-4 CAN (11-bit, 500 kbps) | android | [ios-vlink__elm327-v2-2](./ios-vlink__elm327-v2-2.md) | [guide](../adapter-vgate-icar-pro.md) |',
    );
    expect(b.matrix).not.toContain('No reports yet');
    const page = b.pages['ios-vlink__elm327-v2-2'];
    expect(page.startsWith(GENERATED_MARKER)).toBe(true);
    expect(page).toContain('# IOS-Vlink — ELM327 v2.2');
    expect(page).toContain('Median command latency 20 ms (CAN) — snappy.');
    expect(page).toContain('| 2026-11-02 |');
    expect(b.knownAdapters).toEqual([
      {
        slug: 'ios-vlink__elm327-v2-2',
        nameHints: ['ios-vlink'],
        firmware: 'ELM327 v2.2',
        link: 'ble',
        reports: 2,
        typicalGrade: 'good',
        medianMs: 25,
        cloneSuspectedRatio: 0,
      },
    ]);
    expect(JSON.parse(b.knownAdaptersJson)).toEqual(b.knownAdapters);
  });

  it('escapes pipes in table cells', () => {
    const b = buildAdapterMatrix([sampleReport({ deviceName: 'OBD|II' })]);
    expect(b.matrix).toContain('| OBD\\|II |');
  });
});
