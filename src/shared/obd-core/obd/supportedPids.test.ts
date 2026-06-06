import { encodeSupportedPids, decodeSupportedPids } from './supportedPids';
import { isMarkerPid } from './pids';

describe('supported-PID bitmaps', () => {
  it('round-trips a simple set with no marker', () => {
    const data = encodeSupportedPids('0100', [0x04, 0x05, 0x0c]);
    expect(decodeSupportedPids('0100', data)).toEqual(['0104', '0105', '010C']);
  });

  it('sets the range marker when PIDs exist beyond the range', () => {
    const data = encodeSupportedPids('0100', [0x04, 0x42]);
    const decoded = decodeSupportedPids('0100', data);
    expect(decoded).toContain('0104');
    expect(decoded.some(isMarkerPid)).toBe(true);
  });

  it('applies the correct offset for higher ranges', () => {
    const data = encodeSupportedPids('0120', [0x21, 0x2f]);
    expect(decodeSupportedPids('0120', data)).toEqual(['0121', '012F']);
  });
});
