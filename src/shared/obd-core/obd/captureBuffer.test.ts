import { CaptureBuffer, DEFAULT_CAPTURE_CAPACITY } from './captureBuffer';

describe('CaptureBuffer', () => {
  it('defaults to a 20 000-line capacity', () => {
    expect(new CaptureBuffer().capacity).toBe(DEFAULT_CAPTURE_CAPACITY);
    expect(DEFAULT_CAPTURE_CAPACITY).toBe(20_000);
  });

  it('keeps lines in arrival order with their timestamps and parsed frames', () => {
    const buf = new CaptureBuffer(10);
    buf.push('7E8 04 41 0C 0C D0', 1000);
    buf.push('1A0 02 CC DD', 1010);
    const lines = buf.lines();
    expect(lines.map((l) => l.t)).toEqual([1000, 1010]);
    expect(lines[0].raw).toBe('7E8 04 41 0C 0C D0');
    expect(lines[0].frame).toEqual({
      id: '7E8',
      bytes: [0x04, 0x41, 0x0c, 0x0c, 0xd0],
      raw: '7E8 04 41 0C 0C D0',
    });
    expect(lines[1].frame?.id).toBe('1A0');
    expect(buf.size).toBe(2);
    expect(buf.dropped).toBe(0);
  });

  it('keeps unparsed lines with frame: null', () => {
    const buf = new CaptureBuffer(10);
    buf.push('BUFFER FULL', 5);
    buf.push('7E8 0', 6); // odd hex digit count — not a frame
    expect(buf.size).toBe(2);
    expect(buf.lines().map((l) => [l.raw, l.frame])).toEqual([
      ['BUFFER FULL', null],
      ['7E8 0', null],
    ]);
  });

  it('evicts the oldest past capacity and counts what it dropped', () => {
    const cap = 50;
    const buf = new CaptureBuffer(cap);
    for (let i = 0; i < cap + 5; i++)
      buf.push(`7E8 01 ${(i % 256).toString(16).padStart(2, '0')}`, i);
    expect(buf.size).toBe(cap);
    expect(buf.dropped).toBe(5);
    const ts = buf.lines().map((l) => l.t);
    // Chronological after wrapping: lines 5..54, oldest first.
    expect(ts[0]).toBe(5);
    expect(ts[ts.length - 1]).toBe(cap + 4);
    expect(ts).toEqual([...ts].sort((a, b) => a - b));
  });

  it('handles 25 000 lines at the default capacity', () => {
    const buf = new CaptureBuffer();
    for (let i = 0; i < 25_000; i++) buf.push('7E8 03 41 0D 00', i);
    expect(buf.size).toBe(20_000);
    expect(buf.dropped).toBe(5_000);
    expect(buf.lines()[0].t).toBe(5_000);
  });

  it('returns a copy, and clear() empties it and resets dropped', () => {
    const buf = new CaptureBuffer(2);
    buf.push('7E8 01 AA', 1);
    buf.push('7E8 01 BB', 2);
    buf.push('7E8 01 CC', 3);
    const copy = buf.lines();
    copy.pop();
    expect(buf.size).toBe(2);
    buf.clear();
    expect(buf.size).toBe(0);
    expect(buf.dropped).toBe(0);
    expect(buf.lines()).toEqual([]);
    buf.push('7E8 01 DD', 4);
    expect(buf.lines().map((l) => l.t)).toEqual([4]);
  });

  it('rejects a non-positive capacity', () => {
    expect(() => new CaptureBuffer(0)).toThrow(RangeError);
  });
});
