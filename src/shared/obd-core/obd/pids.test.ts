import { decodePid, PID_REGISTRY, isMarkerPid } from './pids';

describe('PID decoders', () => {
  it('decodes representative PIDs', () => {
    expect(decodePid('010C', [0x0c, 0xd0])).toBe(820); // RPM
    expect(decodePid('0105', [0x7d])).toBe(85); // coolant °C
    expect(decodePid('010D', [0x32])).toBe(50); // speed km/h
    expect(decodePid('0104', [0xff])).toBeCloseTo(100, 5); // load %
    expect(decodePid('0110', [0x01, 0x5e])).toBeCloseTo(3.5, 5); // MAF g/s
    expect(decodePid('010F', [0x46])).toBe(30); // IAT °C
    expect(decodePid('010E', [0x94])).toBe(10); // timing °
    expect(decodePid('0142', [0x36, 0xb0])).toBeCloseTo(14, 5); // voltage V
    expect(decodePid('0106', [0x80])).toBe(0); // fuel trim %
  });

  it('returns null for unknown or short data', () => {
    expect(decodePid('01FF', [0x00])).toBeNull();
    expect(decodePid('010C', [0x0c])).toBeNull();
  });

  it('identifies range-marker pseudo-PIDs', () => {
    expect(isMarkerPid('0120')).toBe(true);
    expect(isMarkerPid('0140')).toBe(true);
    expect(isMarkerPid('0160')).toBe(true);
    expect(isMarkerPid('010C')).toBe(false);
    expect(isMarkerPid('0100')).toBe(false);
  });

  it('exposes names and units', () => {
    expect(PID_REGISTRY['010C'].name).toMatch(/RPM/i);
    expect(PID_REGISTRY['0105'].unit).toBe('°C');
  });
});
