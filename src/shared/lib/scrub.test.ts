import {
  findVins,
  looksLikeVin,
  looksLikeVinInText,
  maskDeviceId,
  maskKnownVins,
  maskVin,
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
  });

  it('is idempotent', () => {
    const raw = `VIN ${VIN} via AA:BB:CC:DD:EE:FF to http://10.0.0.2:8080 key sk-abcdEFGH1234 at 44.4268, 26.1025`;
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
