import {
  DEFAULT_WIFI_ENDPOINT,
  formatEndpoint,
  isValidEndpoint,
  isValidHost,
  parseEndpoint,
} from './endpoint';

describe('Wi-Fi endpoint parsing (plan 26)', () => {
  it('defaults to the WiFi_OBDII address 192.168.0.10:35000', () => {
    expect(DEFAULT_WIFI_ENDPOINT).toEqual({ host: '192.168.0.10', port: 35000 });
    expect(formatEndpoint(DEFAULT_WIFI_ENDPOINT)).toBe('192.168.0.10:35000');
    expect(parseEndpoint(formatEndpoint(DEFAULT_WIFI_ENDPOINT))).toEqual(DEFAULT_WIFI_ENDPOINT);
  });

  it('parses IPv4 addresses and host names with a port', () => {
    expect(parseEndpoint('192.168.0.10:35000')).toEqual({ host: '192.168.0.10', port: 35000 });
    expect(parseEndpoint('  10.0.0.1:23 ')).toEqual({ host: '10.0.0.1', port: 23 });
    expect(parseEndpoint('obd.local:35000')).toEqual({ host: 'obd.local', port: 35000 });
    expect(parseEndpoint('wifi-obd:1')).toEqual({ host: 'wifi-obd', port: 1 });
    expect(parseEndpoint('192.168.4.1:65535')).toEqual({ host: '192.168.4.1', port: 65535 });
  });

  it('rejects invalid hosts', () => {
    for (const text of [
      ':35000',
      '192.168.0.256:35000',
      '192.168.0:35000',
      '1.2.3.4.5:35000',
      '-obd:35000',
      'obd-:35000',
      'obd..local:35000',
      'my obd:35000',
      'obd_1:35000',
      '[::1]:35000',
    ]) {
      expect(parseEndpoint(text)).toBeNull();
    }
    expect(isValidHost('')).toBe(false);
    expect(isValidHost('a'.repeat(64))).toBe(false);
  });

  it('rejects missing or out-of-range ports', () => {
    for (const text of [
      '192.168.0.10',
      '192.168.0.10:',
      '192.168.0.10:0',
      '192.168.0.10:65536',
      '192.168.0.10:123456',
      '192.168.0.10:-1',
      '192.168.0.10:35 000',
      '192.168.0.10:3.5',
      '192.168.0.10:port',
      '',
    ]) {
      expect(parseEndpoint(text)).toBeNull();
    }
  });

  it('validates stored endpoints', () => {
    expect(isValidEndpoint({ host: '192.168.0.10', port: 35000 })).toBe(true);
    expect(isValidEndpoint({ host: '192.168.0.10', port: 0 })).toBe(false);
    expect(isValidEndpoint({ host: '192.168.0.10', port: '35000' })).toBe(false);
    expect(isValidEndpoint({ host: 'bad host', port: 35000 })).toBe(false);
    expect(isValidEndpoint(null)).toBe(false);
    expect(isValidEndpoint('192.168.0.10:35000')).toBe(false);
  });
});
