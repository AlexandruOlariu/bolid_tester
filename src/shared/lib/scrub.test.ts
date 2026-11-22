import {
  CRASH_REPORT_TAGS,
  findVins,
  looksLikeVin,
  looksLikeVinInText,
  maskDeviceId,
  maskKnownVins,
  maskVin,
  scrubBreadcrumb,
  scrubCrashText,
  scrubEvent,
  scrubText,
} from './scrub';

const VIN = 'WVWZZZ1KZ9W903398';

describe('scrubText', () => {
  it('masks a VIN to *** + its last five characters', () => {
    expect(scrubText(`VIN: ${VIN}.`)).toBe('VIN: ***03398.');
  });

  it('keeps a 16-character not-a-VIN and an 18-character run, and a 17-digit number', () => {
    expect(scrubText('WVWZZZ1KZ9W90339')).toBe('WVWZZZ1KZ9W90339');
    expect(scrubText('WVWZZZ1KZ9W9033981')).toBe('WVWZZZ1KZ9W9033981');
    expect(scrubText('12345678901234567')).toBe('12345678901234567');
    // I, O and Q are never in a VIN.
    expect(scrubText('WVWZZZ1KZ9W90339O')).toBe('WVWZZZ1KZ9W90339O');
  });

  it('masks a MAC inside a sentence and an iOS UUID', () => {
    expect(scrubText('connect to AA:BB:CC:DD:EE:FF failed')).toBe('connect to <device-id> failed');
    expect(scrubText('id 8f14e45f-ceea-467a-9575-2d6c3f1a3b2c gone')).toBe('id <device-id> gone');
    // Five groups are not a MAC.
    expect(scrubText('AA:BB:CC:DD:EE')).toBe('AA:BB:CC:DD:EE');
  });

  it('replaces URLs, with a port and a path, by <url>', () => {
    expect(scrubText('POST http://192.168.1.20:1234/v1/chat failed')).toBe('POST <url> failed');
    expect(scrubText('see https://api.openai.com/v1')).toBe('see <url>');
    expect(scrubText('ftp://example.org stays')).toBe('ftp://example.org stays');
  });

  it('replaces a scheme-less network address (the Wi-Fi adapter host:port) by <address>', () => {
    expect(
      scrubText('No answer from the Wi-Fi adapter at 192.168.0.10:35000 within 5 s (ETIMEDOUT)'),
    ).toBe('No answer from the Wi-Fi adapter at <address> within 5 s (ETIMEDOUT)');
    expect(scrubText('Could not reach the Wi-Fi adapter at obd.local:35000: refused')).toBe(
      'Could not reach the Wi-Fi adapter at <address>: refused',
    );
    expect(scrubText('The Wi-Fi adapter at myobd:35000 closed the connection')).toBe(
      'The Wi-Fi adapter at <address> closed the connection',
    );
    expect(scrubText('host 10.0.0.2 down')).toBe('host <address> down');
    // Not an address: a clock time, an ISO timestamp, a multi-frame index, a version.
    expect(scrubText('at 12:30:45')).toBe('at 12:30:45');
    expect(scrubText('2026-11-09T12:30:45.123Z')).toBe('2026-11-09T12:30:45.123Z');
    expect(scrubText('0: 49 02 01 31')).toBe('0: 49 02 01 31');
    expect(scrubText('app 1.2.3 failed')).toBe('app 1.2.3 failed');
  });

  it('replaces API keys and bearer tokens by <token>', () => {
    expect(scrubText('key sk-abcdEFGH1234 bad')).toBe('key <token> bad');
    expect(scrubText('key sk-ant-api03-AbCdEf_123 bad')).toBe('key <token> bad');
    expect(scrubText('Authorization: Bearer abc.def.ghi')).toBe('Authorization: <token>');
    expect(scrubText('sk-short')).toBe('sk-short');
  });

  it('replaces GPS coordinate pairs by <coords>', () => {
    expect(scrubText('at 44.4268, 26.1025 stopped')).toBe('at <coords> stopped');
    expect(scrubText('-33.86882,151.20929')).toBe('<coords>');
    expect(scrubText('12.3, 45.6')).toBe('12.3, 45.6');
  });

  it('does not take a word of hex digits only for a VIN (an adapter frame)', () => {
    expect(scrubText('7E8064100BE3FA813')).toBe('7E8064100BE3FA813');
    expect(findVins('reply 7E8064100BE3FA813')).toEqual([]);
  });

  it('keepIdentifiers keeps VINs and device ids but still hides URLs, tokens and coordinates', () => {
    const raw = `VIN ${VIN} via AA:BB:CC:DD:EE:FF to http://10.0.0.2:8080 key sk-abcdEFGH1234 at 44.4268, 26.1025`;
    expect(scrubText(raw, { keepIdentifiers: true })).toBe(
      `VIN ${VIN} via AA:BB:CC:DD:EE:FF to <url> key <token> at <coords>`,
    );
    // The Wi-Fi adapter's address is an adapter address too: kept.
    expect(scrubText('adapter at 192.168.0.10:35000', { keepIdentifiers: true })).toBe(
      'adapter at 192.168.0.10:35000',
    );
  });

  it('is idempotent', () => {
    const raw = `VIN ${VIN} via AA:BB:CC:DD:EE:FF (Wi-Fi 192.168.0.10:35000) to http://10.0.0.2:8080 key sk-abcdEFGH1234 at 44.4268, 26.1025`;
    const once = scrubText(raw);
    expect(scrubText(once)).toBe(once);
    expect(once).not.toContain(VIN);
  });
});

describe('VIN helpers', () => {
  it('looksLikeVin needs the VIN alphabet, a letter and a digit', () => {
    expect(looksLikeVin(VIN)).toBe(true);
    expect(looksLikeVin('ABCDEFGHJKLMNPRST')).toBe(false);
    expect(looksLikeVin('WVWZZZ1KZ9W90339')).toBe(false);
  });

  it('looksLikeVinInText also needs a letter outside A-F', () => {
    expect(looksLikeVinInText(VIN)).toBe(true);
    expect(looksLikeVin('7E8064100BE3FA813')).toBe(true);
    expect(looksLikeVinInText('7E8064100BE3FA813')).toBe(false);
  });

  it('maskVin keeps the last five', () => {
    expect(maskVin(VIN)).toBe('***03398');
  });

  it('findVins lists each VIN once', () => {
    expect(findVins(`${VIN} and ${VIN} and ZFA19900001234567`)).toEqual([VIN, 'ZFA19900001234567']);
  });

  it('maskKnownVins also masks a VIN glued to other text, case-insensitively', () => {
    expect(maskKnownVins(`vin=x${VIN.toLowerCase()}y`, [VIN])).toBe('vin=x***03398y');
  });
});

describe('maskDeviceId', () => {
  it('keeps a MAC maker prefix and hides the rest', () => {
    expect(maskDeviceId('aa:bb:cc:dd:ee:ff')).toBe('AA:BB:CC:**:**:**');
  });
  it('hides any other id and passes null through', () => {
    expect(maskDeviceId('8f14e45f-ceea-467a-9575-2d6c3f1a3b2c')).toBe('<device-id>');
    expect(maskDeviceId('192.168.0.10:35000')).toBe('<device-id>');
    expect(maskDeviceId(null)).toBeNull();
  });
});

describe('scrubCrashText (plan 31)', () => {
  it('adds e-mail addresses to the scrubText rules', () => {
    expect(scrubCrashText('mail owner.name+obd@example.co.uk failed')).toBe('mail <email> failed');
    // Not an address: no domain dot, or an @ handle.
    expect(scrubCrashText('user@localhost and @golf')).toBe('user@localhost and @golf');
    expect(scrubCrashText(`VIN ${VIN} at http://me@10.0.0.2:8080`)).toBe('VIN ***03398 at <url>');
  });

  it('removes the Wi-Fi adapter address that the TCP transport puts in its errors', () => {
    expect(
      scrubCrashText(
        'The Wi-Fi adapter at 192.168.0.10:35000 closed the connection before it opened (ECONNREFUSED)',
      ),
    ).toBe('The Wi-Fi adapter at <address> closed the connection before it opened (ECONNREFUSED)');
  });

  it('masks known VINs even when the word rule would not (hex letters only)', () => {
    const hexVin = '1FADB40A1CF000001';
    expect(scrubCrashText(`car ${hexVin}`)).toBe(`car ${hexVin}`);
    expect(scrubCrashText(`car ${hexVin}`, { knownVins: [hexVin] })).toBe('car ***00001');
  });
});

describe('scrubBreadcrumb (plan 31)', () => {
  it('keeps nav and connection breadcrumbs, scrubbed and without data', () => {
    expect(
      scrubBreadcrumb({
        category: 'connection',
        message: `connected to AA:BB:CC:DD:EE:FF (${VIN})`,
        data: { deviceName: 'OBDII' },
        level: 'info',
      }),
    ).toEqual({
      category: 'connection',
      message: 'connected to <device-id> (***03398)',
      level: 'info',
    });
    expect(scrubBreadcrumb({ category: 'nav', message: '/faults' })).toEqual({
      category: 'nav',
      message: '/faults',
    });
  });

  it('drops every other breadcrumb (console, fetch, touch, adapter I/O)', () => {
    for (const category of [
      'console',
      'fetch',
      'xhr',
      'touch',
      'navigation',
      'adapter',
      undefined,
    ]) {
      expect(scrubBreadcrumb({ category, message: '> 0902' })).toBeNull();
    }
    expect(scrubBreadcrumb(null)).toBeNull();
  });
});

describe('scrubEvent (plan 31)', () => {
  const raw = () => ({
    event_id: 'abc',
    level: 'error',
    release: '0.1.0',
    message: `VIN ${VIN} via http://192.168.1.20:1234/v1 key sk-abcdEFGH1234`,
    logentry: { message: `vin ${VIN}`, params: [VIN] },
    exception: {
      values: [
        {
          type: 'Error',
          value: `connect to AA:BB:CC:DD:EE:FF failed at 44.4268, 26.1025`,
          stacktrace: { frames: [{ filename: 'app:///index.android.bundle', lineno: 1 }] },
        },
      ],
    },
    breadcrumbs: [
      { category: 'nav', message: '/dashboard' },
      { category: 'console', message: `> 0902 ${VIN}` },
      { category: 'connection', message: 'connected', data: { id: 'AA:BB:CC:DD:EE:FF' } },
    ],
    user: { id: 'install-1', email: 'owner@example.com', ip_address: '{{auto}}' },
    request: { url: 'http://10.0.0.2' },
    server_name: "Alex's Pixel",
    contexts: {
      device: { name: "Alex's Pixel", model: 'Pixel 7', family: 'Pixel', id: 'dev-1' },
      os: { name: 'Android', version: '15' },
      app: { app_version: '0.1.0', app_build: '7', device_app_hash: 'h4sh' },
      culture: { timezone: 'Europe/Bucharest' },
    },
    tags: { source: 'connection', severity: 'error', deviceName: 'OBDII', vin: VIN, protocol: '6' },
    extra: { componentStack: `in Foo (${VIN})`, count: 2, nested: { vin: VIN } },
  });

  it('scrubs the message, the log entry and nested exception values', () => {
    const out = scrubEvent(raw());
    expect(out.message).toBe('VIN ***03398 via <url> key <token>');
    expect(out.logentry).toEqual({ message: 'vin ***03398' });
    expect(out.exception.values[0].value).toBe('connect to <device-id> failed at <coords>');
    expect(out.exception.values[0].stacktrace).toEqual(raw().exception.values[0].stacktrace);
  });

  it('removes user, request and server_name; keeps device model, os and app version only', () => {
    const out = scrubEvent(raw());
    expect(out).not.toHaveProperty('user');
    expect(out).not.toHaveProperty('request');
    expect(out).not.toHaveProperty('server_name');
    expect(out.contexts).toEqual({
      device: { model: 'Pixel 7', family: 'Pixel' },
      os: { name: 'Android', version: '15' },
      app: { app_version: '0.1.0', app_build: '7' },
    });
    expect(JSON.stringify(out)).not.toContain("Alex's Pixel");
    expect(JSON.stringify(out)).not.toContain('owner@example.com');
  });

  it('whitelists tags, keeps nav / connection breadcrumbs and flattens extra', () => {
    const out = scrubEvent(raw());
    expect(Object.keys(out.tags).every((k) => CRASH_REPORT_TAGS.includes(k))).toBe(true);
    expect(out.tags).toEqual({ source: 'connection', severity: 'error', protocol: '6' });
    expect(out.breadcrumbs).toEqual([
      { category: 'nav', message: '/dashboard' },
      { category: 'connection', message: 'connected' },
    ]);
    expect(out.extra).toEqual({ componentStack: 'in Foo (***03398)', count: 2 });
  });

  it('leaves no VIN or device id anywhere, keeps the rest, and does not change its input', () => {
    const input = raw();
    const out = scrubEvent(input);
    const json = JSON.stringify(out);
    expect(json).not.toContain(VIN);
    expect(json).not.toContain('AA:BB:CC:DD:EE:FF');
    expect(out).toMatchObject({ event_id: 'abc', level: 'error', release: '0.1.0' });
    expect(input).toEqual(raw());
  });

  it('is idempotent', () => {
    const once = scrubEvent(raw());
    expect(scrubEvent(once)).toEqual(once);
  });
});
