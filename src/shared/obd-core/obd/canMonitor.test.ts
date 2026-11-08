import {
  parseMonitorLine,
  CanFrameAggregator,
  formatCaptureCsv,
  formatCaptureRaw,
  type CaptureHeader,
} from './canMonitor';
import type { CapturedLine } from './captureBuffer';

describe('CAN monitor parsing', () => {
  it('parses 11-bit and 29-bit id lines', () => {
    expect(parseMonitorLine('7E8 04 41 0C 0C D0')).toEqual({
      id: '7E8',
      bytes: [0x04, 0x41, 0x0c, 0x0c, 0xd0],
      raw: '7E8 04 41 0C 0C D0',
    });
    expect(parseMonitorLine('18DAF110 03 7F 19 78')?.id).toBe('18DAF110');
  });

  it('rejects notices and junk', () => {
    expect(parseMonitorLine('SEARCHING...')).toBeNull();
    expect(parseMonitorLine('BUFFER FULL')).toBeNull();
    expect(parseMonitorLine('>')).toBeNull();
    expect(parseMonitorLine('')).toBeNull();
  });

  it('aggregates per id with counts and rate', () => {
    const agg = new CanFrameAggregator();
    agg.add('7E8 01 AA', 1000);
    agg.add('7E8 01 BB', 2000);
    agg.add('1A0 02 CC DD', 1500);
    const snap = agg.snapshot();
    expect(snap[0].id).toBe('7E8');
    expect(snap[0].count).toBe(2);
    expect(snap[0].rate).toBe(2); // 2 frames over 1s window
    expect(snap[0].lastBytes).toEqual([0x01, 0xbb]);
    expect(snap[1].id).toBe('1A0');
    agg.clear();
    expect(agg.snapshot()).toEqual([]);
  });
});

describe('capture formats', () => {
  const START = Date.UTC(2026, 10, 8, 10, 0, 0);
  const header: CaptureHeader = {
    vehicleId: 'golf-plus-2009-20tdi',
    protocol: 'ISO_15765_4_CAN_11_500',
    adapter: 'ELM327 v1.5',
    startedAt: START,
    note: 'VCDS Group 121 basic settings,\nengine idle',
    appVersion: '0.1.0',
    dropped: 3,
  };
  const lines: CapturedLine[] = [
    { t: START + 12, raw: '7E0 02 10 03', frame: parseMonitorLine('7E0 02 10 03') },
    { t: START + 40, raw: 'BUFFER FULL', frame: null },
    {
      t: START + 45.6,
      raw: '7e8 06 50 03 00 32 01 f4',
      frame: parseMonitorLine('7e8 06 50 03 00 32 01 f4'),
    },
    { t: START + 70, raw: '04 41 0C 0C D0', frame: parseMonitorLine('04 41 0C 0C D0') },
  ];

  it('CSV: header comments, column row, one row per frame with relative t_ms and upper hex', () => {
    const csv = formatCaptureCsv(header, lines);
    const rows = csv.trimEnd().split('\n');
    expect(rows[0]).toBe('# bolid-tester bus capture (csv)');
    expect(rows).toContain('# vehicle: golf-plus-2009-20tdi');
    expect(rows).toContain('# protocol: ISO_15765_4_CAN_11_500');
    expect(rows).toContain('# adapter: ELM327 v1.5');
    expect(rows).toContain('# started: 2026-11-08T10:00:00.000Z');
    // A multi-line note stays inside its comment.
    expect(rows).toContain('# note: VCDS Group 121 basic settings, engine idle');
    expect(rows).toContain('# app: 0.1.0');
    expect(rows).toContain('# lines: 4 (frames 3, unparsed 1)');
    expect(rows).toContain('# dropped: 3');

    const col = rows.indexOf('t_ms,id,dlc,bytes');
    expect(col).toBeGreaterThan(0);
    expect(rows.slice(0, col).every((r) => r.startsWith('# '))).toBe(true);
    const data = rows.slice(col + 1).filter((r) => !r.startsWith('#'));
    expect(data).toEqual([
      '12,7E0,3,02 10 03',
      '46,7E8,7,06 50 03 00 32 01 F4',
      '70,,5,04 41 0C 0C D0',
    ]);
  });

  it('CSV: unparsed lines land in a trailing # raw: block', () => {
    const rows = formatCaptureCsv(header, lines).trimEnd().split('\n');
    const raw = rows.findIndex((r) => r.startsWith('# raw:'));
    expect(raw).toBeGreaterThan(rows.indexOf('t_ms,id,dlc,bytes'));
    expect(rows[raw]).toBe('# raw: 1 line(s) that did not parse as frames');
    expect(rows[raw + 1]).toBe('# 40\tBUFFER FULL');
    expect(rows.slice(raw + 1).every((r) => r.startsWith('# '))).toBe(true);
  });

  it('CSV: no raw block when everything parsed; unknown fields and an empty note are explicit', () => {
    const csv = formatCaptureCsv({ vehicleId: 'generic', startedAt: START }, [lines[0]]);
    expect(csv).not.toContain('# raw:');
    expect(csv).toContain('# protocol: unknown\n');
    expect(csv).toContain('# adapter: unknown\n');
    expect(csv).toContain('# note: \n');
    expect(csv).toContain('# dropped: 0\n');
    expect(csv).not.toContain('# app:');
    expect(csv.endsWith('12,7E0,3,02 10 03\n')).toBe(true);
  });

  it('raw dump: header, then one line per input exactly as printed, prefixed by t_ms', () => {
    const rows = formatCaptureRaw(header, lines).trimEnd().split('\n');
    expect(rows[0]).toBe('# bolid-tester bus capture (raw)');
    expect(rows).toContain('# note: VCDS Group 121 basic settings, engine idle');
    const body = rows.filter((r) => !r.startsWith('#'));
    expect(body).toEqual([
      '12\t7E0 02 10 03',
      '40\tBUFFER FULL',
      '46\t7e8 06 50 03 00 32 01 f4',
      '70\t04 41 0C 0C D0',
    ]);
  });
});
