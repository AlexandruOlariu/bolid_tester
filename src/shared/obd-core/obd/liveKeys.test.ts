import { didOfKey, extendedKey, isExtendedKey, labelForLiveKey, splitPollKeys } from './liveKeys';

describe('live keys', () => {
  it('round-trips an extended key', () => {
    expect(extendedKey('170d')).toBe('22:170D');
    expect(isExtendedKey('22:1701')).toBe(true);
    expect(isExtendedKey('010C')).toBe(false);
    expect(didOfKey(extendedKey('1701'))).toBe('1701');
  });

  it('splits a mixed key list, order preserved and de-duplicated', () => {
    expect(splitPollKeys(['010C', '22:1701', '010C', '22:1701'])).toEqual({
      pids: ['010C'],
      dids: ['1701'],
    });
    expect(splitPollKeys(['22:170D', '0105', '22:1701', '010C'])).toEqual({
      pids: ['0105', '010C'],
      dids: ['170D', '1701'],
    });
    expect(splitPollKeys([])).toEqual({ pids: [], dids: [] });
  });

  it('labels Mode 01 PIDs from the registry and extended keys from the definitions', () => {
    const defs = [
      { did: '1701', name: 'DPF soot mass', unit: 'g' },
      { did: '1705', name: 'Successful regenerations', unit: '' },
    ];
    expect(labelForLiveKey('010C')).toBe('Engine RPM (rpm)');
    expect(labelForLiveKey('01FF')).toBe('01FF');
    expect(labelForLiveKey('22:1701', defs)).toBe('DPF soot mass (g) · 1701');
    expect(labelForLiveKey('22:1705', defs)).toBe('Successful regenerations · 1705');
    expect(labelForLiveKey('22:9999', defs)).toBe('DID 9999');
  });
});
