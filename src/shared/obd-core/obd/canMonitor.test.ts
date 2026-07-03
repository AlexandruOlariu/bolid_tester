import { parseMonitorLine, CanFrameAggregator } from './canMonitor';

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
