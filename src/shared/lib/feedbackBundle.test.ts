import { buildLoggedError, type LoggedError } from './errorLog';
import {
  ISSUE_URL_MAX_CHARS,
  bundleToJson,
  bundleToMarkdown,
  findVinsInAdapterLog,
  formatBytes,
  issueTitle,
  issueUrl,
  mailtoUrl,
  maskVinInAdapterLog,
  platformLabel,
  redactBundle,
  utf8ByteLength,
  type BundleInput,
  type BundleLogEntry,
} from './feedbackBundle';

const VIN = 'WVWZZZ1KZ9W903398';
const VIN_HEX = [...VIN].map((c) => c.charCodeAt(0).toString(16).toUpperCase()).join('');
const T0 = Date.UTC(2026, 10, 9, 10, 0, 0);

function err(i: number, extra: Partial<LoggedError> = {}): LoggedError {
  return {
    ...buildLoggedError(
      { source: 'connection', error: new Error(`ATZ timed out #${i}`) },
      { id: `e${i}`, ts: T0 + i },
    ),
    stack: undefined,
    ...extra,
  };
}

function input(over: Partial<BundleInput> = {}): BundleInput {
  return {
    description: 'Live data froze after 5 minutes.',
    app: {
      version: '0.1.0',
      adapterSource: 'mock',
      platform: 'android',
      osVersion: '34',
      locale: 'en-GB',
    },
    vehicle: {
      profileId: 'golf-plus-2009-20tdi',
      name: 'VW Golf Plus 2009 2.0 TDI 81 kW (2009)',
      vin: VIN,
      protocol: 'ISO 15765-4 CAN (11-bit, 500 kbps)',
      supportedPidCount: 32,
    },
    adapter: { deviceId: 'AA:BB:CC:DD:EE:FF', deviceName: 'IOS-Vlink', version: 'ELM327 v2.2' },
    errors: [
      err(2, {
        message: `VIN mismatch: read ${VIN}`,
        context: {
          apiKey: 'sk-abcdEFGH1234',
          baseUrl: 'http://192.168.1.20:1234',
          vin: VIN,
          attempt: 2,
        },
      }),
      err(1),
    ],
    adapterLog: [
      { dir: 'tx', text: '0902', ts: T0 },
      { dir: 'rx', text: `490201${VIN_HEX}`, ts: T0 + 1 },
      { dir: 'tx', text: '010C', ts: T0 + 2 },
      { dir: 'rx', text: '410C1AF8', ts: T0 + 3 },
    ],
    lastScanReport: `Auto-Scan\nVehicle: VW Golf Plus\nVIN: ${VIN}\n01-Engine: 1 fault`,
    createdAt: T0,
    ...over,
  };
}

describe('redactBundle', () => {
  it('masks the VIN everywhere: vehicle, error message and context, scan report, VIN frame', () => {
    const b = redactBundle(input());
    const json = bundleToJson(b);
    expect(b.redacted).toBe(true);
    expect(b.vehicle.vin).toBe('***03398');
    expect(b.errors[0].message).toBe('VIN mismatch: read ***03398');
    expect(b.errors[0].context?.vin).toBe('***03398');
    expect(b.lastScanReport).toContain('VIN: ***03398');
    expect(json).toContain('***03398');
    expect(json).not.toContain(VIN);
    expect(json).not.toContain(VIN_HEX);
    // The VIN reply keeps its last five bytes (03398) and hides the first twelve.
    expect(b.adapterLog[1].text).toBe(`490201${'*'.repeat(24)}${VIN_HEX.slice(24)}`);
    // Other traffic is untouched.
    expect(b.adapterLog[3].text).toBe('410C1AF8');
  });

  it('masks a spaced, multi-frame VIN reply split across BLE chunks (headers on)', () => {
    const bytes = VIN_HEX.match(/../g)!;
    const frames = [
      `7E8 10 14 49 02 01 ${bytes.slice(0, 3).join(' ')}\r`,
      `7E8 21 ${bytes.slice(3, 10).join(' ')}\r`,
      `7E8 22 ${bytes.slice(10, 17).join(' ')}\r\r>`,
    ].join('');
    // Split the reply at arbitrary points, mid-byte included, like BLE notifications do.
    const chunks = [frames.slice(0, 20), frames.slice(20, 43), frames.slice(43)];
    const log: BundleLogEntry[] = chunks.map((text, i) => ({ dir: 'rx', text, ts: T0 + i }));
    const masked = maskVinInAdapterLog(log, VIN)
      .map((e) => e.text)
      .join('');
    const keptBytes = masked.match(/\b[0-9A-F]{2}\b/g)!.join('');
    expect(keptBytes).not.toContain(VIN_HEX.slice(0, 24));
    expect(masked).toContain(bytes.slice(12, 17).join(' ')); // last five stay
    expect(masked.match(/\*/g)).toHaveLength(24);
    // Through the bundle too, with the VIN known only from the session.
    const b = redactBundle(input({ adapterLog: log, errors: [], lastScanReport: null }));
    expect(b.adapterLog.map((e) => e.text).join('')).toBe(masked);
  });

  it('finds a VIN carried only in the adapter log (multi-frame, no session VIN) and masks it', () => {
    const frames = `014\r0:490201${VIN_HEX.slice(0, 8)}\r1:${VIN_HEX.slice(8, 22)}\r2:${VIN_HEX.slice(22)}\r\r>`;
    const log: BundleLogEntry[] = [{ dir: 'rx', text: frames, ts: T0 }];
    expect(findVinsInAdapterLog(log)).toEqual([VIN]);
    const b = redactBundle(
      input({
        vehicle: { profileId: 'generic', name: 'Auto / Generic OBD2', vin: null },
        errors: [],
        lastScanReport: null,
        adapterLog: log,
      }),
    );
    expect(b.vehicle.vin).toBeNull();
    expect(b.adapterLog[0].text.replace(/[^*]/g, '')).toHaveLength(24);
    expect(b.adapterLog[0].text).toContain(VIN_HEX.slice(24));
  });

  it('finds a VIN carried only in a headers-on reply (11-bit, 29-bit CAN and K-line)', () => {
    const b = VIN_HEX.match(/../g)!;
    const sp = (bytes: string[]) => bytes.join(' ');
    const can11 = [
      `7E8 10 14 49 02 01 ${sp(b.slice(0, 3))}\r`,
      `7E8 21 ${sp(b.slice(3, 10))}\r`,
      `7E8 22 ${sp(b.slice(10, 17))}\r\r>`,
    ].join('');
    const can29 = [
      `18 DA F1 10 10 14 49 02 01 ${sp(b.slice(0, 3))}\r`,
      `18 DA F1 10 21 ${sp(b.slice(3, 10))}\r`,
      `18 DA F1 10 22 ${sp(b.slice(10, 17))}\r\r>`,
    ].join('');
    // ISO 9141 / KWP: five messages of 4 bytes, the first padded with three zeros.
    const kBytes = ['00', '00', '00', ...b];
    const kHeadersOn = [0, 1, 2, 3, 4]
      .map((n) => `48 6B 10 49 02 0${n + 1} ${sp(kBytes.slice(n * 4, n * 4 + 4))} A5\r`)
      .join('');
    const kHeadersOff = [0, 1, 2, 3, 4]
      .map((n) => `49 02 0${n + 1} ${sp(kBytes.slice(n * 4, n * 4 + 4))}\r`)
      .join('');
    // 11-bit headers-on without spaces (ATS0), split mid-line like BLE chunks.
    const can11NoSpaces = can11.replace(/ /g, '');
    for (const text of [can11, can29, kHeadersOn, kHeadersOff]) {
      expect(findVinsInAdapterLog([{ dir: 'rx', text, ts: T0 }])).toEqual([VIN]);
    }
    const chunks = [can11NoSpaces.slice(0, 9), can11NoSpaces.slice(9, 30), can11NoSpaces.slice(30)];
    expect(
      findVinsInAdapterLog(chunks.map((text, i) => ({ dir: 'rx', text, ts: T0 + i }))),
    ).toEqual([VIN]);
    // Masked through the bundle with no session, garage or origin VIN.
    const red = redactBundle(
      input({
        vehicle: { profileId: 'generic', name: 'Auto / Generic OBD2', vin: null },
        errors: [],
        lastScanReport: null,
        adapterLog: [{ dir: 'rx', text: can11, ts: T0 }],
      }),
    );
    expect(red.adapterLog[0].text.replace(/[^*]/g, '')).toHaveLength(24);
    expect(red.adapterLog[0].text).toContain(sp(b.slice(12, 17)));
  });

  it('masks the adapter MAC, drops the apiKey context key and hides URLs', () => {
    const b = redactBundle(input());
    expect(b.adapter.deviceId).toBe('AA:BB:CC:**:**:**');
    expect(b.adapter.deviceName).toBe('IOS-Vlink');
    expect(b.errors[0].context).not.toHaveProperty('apiKey');
    expect(b.errors[0].context?.baseUrl).toBe('<url>');
    expect(b.errors[0].context?.attempt).toBe(2);
    const json = bundleToJson(b);
    expect(json).not.toContain('sk-abcd');
    expect(json).not.toMatch(/https?:\/\//);
    expect(json).not.toContain('AA:BB:CC:DD:EE:FF');
  });

  it('keeps the description untouched', () => {
    const b = redactBundle(input({ description: 'See http://example.org' }));
    expect(b.description).toBe('See http://example.org');
  });

  it('keepIdentifiers: true keeps the VIN and the adapter address, nothing else', () => {
    const src = input({ keepIdentifiers: true });
    const b = redactBundle(src);
    expect(b.redacted).toBe(false);
    expect(b.vehicle.vin).toBe(VIN);
    expect(b.adapter.deviceId).toBe('AA:BB:CC:DD:EE:FF');
    expect(b.errors[0].message).toContain(VIN);
    expect(b.errors[0].context?.vin).toBe(VIN);
    expect(b.adapterLog).toEqual(src.adapterLog);
    expect(b.lastScanReport).toBe(src.lastScanReport);
    expect(bundleToJson(b)).toContain(VIN);
  });

  it('keepIdentifiers: true still drops secrets and hides URLs, tokens and coordinates', () => {
    const b = redactBundle(
      input({
        keepIdentifiers: true,
        errors: [
          err(3, {
            message:
              'POST http://192.168.1.20:1234/v1/chat with sk-abcdEFGH1234 at 44.4268, 26.1025',
            stack: 'Error\n    at fetch (https://example.org/app.js:1:2)',
            context: {
              apiKey: 'sk-abcdEFGH1234',
              token: 'abc',
              baseUrl: 'http://192.168.1.20:1234',
              device: 'AA:BB:CC:DD:EE:FF',
            },
          }),
        ],
        adapterLog: [{ dir: 'rx', text: 'see http://10.0.0.2:35000', ts: T0 }],
        lastScanReport: 'Auto-Scan\nPOST https://api.openai.com/v1',
      }),
    );
    const e = b.errors[0];
    expect(e.message).toBe('POST <url> with <token> at <coords>');
    expect(e.stack).toContain('<url>');
    expect(e.context).not.toHaveProperty('apiKey');
    expect(e.context).not.toHaveProperty('token');
    expect(e.context?.baseUrl).toBe('<url>');
    // The adapter address the user chose to keep stays, in the context too.
    expect(e.context?.device).toBe('AA:BB:CC:DD:EE:FF');
    expect(b.adapterLog[0].text).toBe('see <url>');
    expect(b.lastScanReport).toBe('Auto-Scan\nPOST <url>');
    const json = bundleToJson(b);
    expect(json).not.toContain('sk-abcd');
    expect(json).not.toMatch(/https?:\/\//);
  });

  it('leaves a 17-hex-digit CAN frame (spaces off, headers on) in the adapter log and errors alone', () => {
    const frame = '7E8064100BE3FA813';
    const b = redactBundle(
      input({
        errors: [err(4, { message: `Unexpected reply ${frame}` })],
        adapterLog: [
          { dir: 'tx', text: 'ATMA', ts: T0 },
          { dir: 'rx', text: `${frame}\r`, ts: T0 + 1 },
        ],
      }),
    );
    expect(b.adapterLog[1].text).toBe(`${frame}\r`);
    expect(b.errors[0].message).toBe(`Unexpected reply ${frame}`);
  });

  it('does not change its input', () => {
    const src = input();
    const before = JSON.stringify(src);
    redactBundle(src);
    expect(JSON.stringify(src)).toBe(before);
  });
});

describe('bundleToJson', () => {
  it('is stable: the same input gives the same text, whatever the context key order', () => {
    const a = bundleToJson(redactBundle(input()));
    const reordered = input();
    reordered.errors[0].context = {
      attempt: 2,
      vin: VIN,
      baseUrl: 'http://192.168.1.20:1234',
      apiKey: 'x',
    };
    expect(bundleToJson(redactBundle(input()))).toBe(a);
    expect(bundleToJson(redactBundle(reordered))).toBe(a);
    const parsed = JSON.parse(a);
    expect(Object.keys(parsed)).toEqual([
      'schema',
      'createdAt',
      'createdAtIso',
      'redacted',
      'description',
      'app',
      'vehicle',
      'adapter',
      'errors',
      'adapterLog',
      'lastScanReport',
    ]);
    expect(parsed.createdAtIso).toBe('2026-11-09T10:00:00.000Z');
  });
});

function manyErrors(n: number): LoggedError[] {
  return Array.from({ length: n }, (_, i) => err(n - i));
}
function manyLines(n: number): BundleLogEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    dir: i % 2 ? 'rx' : 'tx',
    text: i % 2 ? `41 0C ${i}` : `010C #${i}`,
    ts: T0 + i,
  }));
}

describe('bundleToMarkdown', () => {
  it('caps the errors and the adapter log lines', () => {
    const md = bundleToMarkdown(
      redactBundle(input({ errors: manyErrors(30), adapterLog: manyLines(100) })),
      { maxErrors: 5, maxLogLines: 7 },
    );
    expect(md).toContain('### Errors (newest 5 of 30)');
    expect(md.match(/^- `/gm)).toHaveLength(5);
    expect(md).toContain('### Adapter log (last 7 of 100 lines)');
    const block = md.split('```text')[1].split('```')[0];
    expect(block.trim().split('\n')).toHaveLength(7);
    expect(block).toContain('41 0C 99');
    expect(block).not.toContain('#92');
  });

  it('has the header table and description, and a <details> block only with a scan report', () => {
    const md = bundleToMarkdown(redactBundle(input()));
    expect(md).toContain('| Device | Android 14 (API 34) · en-GB |');
    expect(md).toContain('| VIN | ***03398 |');
    expect(md).toContain('| Identifiers | removed |');
    expect(md).toContain('Live data froze after 5 minutes.');
    expect(md).toContain('<details><summary>Last module scan</summary>');
    const none = bundleToMarkdown(redactBundle(input({ lastScanReport: null })));
    expect(none).not.toContain('<details>');
  });
});

describe('issueUrl', () => {
  it('opens a new issue on the repository with the title and the summary encoded', () => {
    const b = redactBundle(input());
    const url = issueUrl(b);
    expect(
      url.startsWith('https://github.com/AlexandruOlariu/bolid_tester/issues/new?title='),
    ).toBe(true);
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.get('title')).toBe('Problem report: Live data froze after 5 minutes.');
    expect(params.get('body')).toContain('| VIN | ***03398 |');
    expect(params.get('body')).not.toContain('truncated');
  });

  it('stays under 8 000 characters for a 500-error bundle and says the summary was cut', () => {
    const long = 'Überlänge – ş ț ă 🚗 '.repeat(20);
    const b = redactBundle(
      input({
        description: long.repeat(5),
        errors: manyErrors(500).map((e) => ({ ...e, message: long })),
        adapterLog: manyLines(300),
      }),
    );
    const url = issueUrl(b);
    expect(url.length).toBeLessThanOrEqual(ISSUE_URL_MAX_CHARS);
    const body = new URLSearchParams(url.split('?')[1]).get('body')!;
    expect(body).toContain('full bundle is attached separately');
  });

  it('never splits an emoji when cutting the title or a Markdown line (no URIError)', () => {
    const b = redactBundle(
      input({
        description: `${'a'.repeat(78)}🚗 more text here`,
        errors: [err(1, { message: `${'x'.repeat(298)}🚗 tail` })],
        adapterLog: [{ dir: 'rx', text: `${'4'.repeat(198)}🚗 tail`, ts: T0 }],
      }),
    );
    const title = issueTitle(b);
    expect(title).toBe(`Problem report: ${'a'.repeat(78)}…`);
    const url = issueUrl(b);
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.get('title')).toBe(title);
    expect(params.get('body')).toContain(`${'x'.repeat(298)}…`);
    expect(() => mailtoUrl(b, 'maintainer@example.org')).not.toThrow();
  });

  it('encodes a lone surrogate already in an error message instead of throwing', () => {
    const b = redactBundle(input({ errors: [err(1, { message: 'broken \uD83D reply' })] }));
    const body = new URLSearchParams(issueUrl(b).split('?')[1]).get('body')!;
    expect(body).toContain('broken � reply');
  });

  it('titles a report without a description by the app version', () => {
    expect(issueTitle(redactBundle(input({ description: '  ' })))).toBe(
      'Problem report (app 0.1.0)',
    );
  });
});

describe('mailtoUrl', () => {
  it('has a subject and a short body with no log lines', () => {
    const url = mailtoUrl(redactBundle(input()), 'maintainer@example.org');
    expect(url.startsWith('mailto:maintainer@example.org?subject=')).toBe(true);
    const body = decodeURIComponent(url.split('&body=')[1]);
    expect(body).toContain('Live data froze after 5 minutes.');
    expect(body).toContain('Errors: 2 · adapter log lines: 4 · last module scan: yes');
    expect(body).not.toContain('410C1AF8');
    expect(body).not.toContain('ATZ timed out');
    expect(body).not.toContain(VIN);
  });
});

describe('helpers', () => {
  it('platformLabel names Android releases, iOS and the web', () => {
    expect(platformLabel('android', '34')).toBe('Android 14 (API 34)');
    expect(platformLabel('android', '99')).toBe('Android (API 99)');
    expect(platformLabel('ios', '17.2')).toBe('iOS 17.2');
    expect(platformLabel('web', '')).toBe('Web');
  });

  it('utf8ByteLength and formatBytes', () => {
    expect(utf8ByteLength('abc')).toBe(3);
    expect(utf8ByteLength('ă')).toBe(2);
    expect(utf8ByteLength('–')).toBe(3);
    expect(utf8ByteLength('🚗')).toBe(4);
    expect(formatBytes(812)).toBe('812 B');
    expect(formatBytes(14540)).toBe('14.2 KB');
  });
});
