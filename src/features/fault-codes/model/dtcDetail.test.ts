import {
  DTC_DETAIL_FOOTER,
  SEVERITY_META,
  buildDtcDetail,
  dtcShareMessage,
  dtcWebSearchUrl,
} from './dtcDetail';

describe('buildDtcDetail', () => {
  it('shows severity, system line and the VAG number for a VAG car', () => {
    const d = buildDtcDetail('P0301', 'Cylinder 1 Misfire Detected', 'vag');
    expect(d.info.severity).toBe('high');
    expect(SEVERITY_META[d.info.severity].label).toBe('High');
    expect(d.systemLine).toBe('Powertrain · Ignition system / misfire');
    expect(d.vagCode).toBe('00769'); // 0x0301
  });

  it('falls back to the database description and hides the VAG number for Fiat', () => {
    const d = buildDtcDetail('P0135', '', 'fiat');
    expect(d.description).toMatch(/O2 Sensor Heater/i);
    expect(d.vagCode).toBe('');
    expect(buildDtcDetail('U0121', undefined, undefined).vagCode).toBe('');
  });

  it('marks manufacturer-specific codes', () => {
    expect(buildDtcDetail('P1557', undefined, 'vag').info.manufacturerSpecific).toBe(true);
    expect(buildDtcDetail('P1557', undefined, 'vag').info.source).toBe('vag');
  });
});

describe('detail sheet actions', () => {
  it('builds the web search link from the code, OBD2 and the car name', () => {
    expect(dtcWebSearchUrl('P0135', 'VW Golf Plus')).toBe(
      'https://www.google.com/search?q=P0135%20OBD2%20VW%20Golf%20Plus',
    );
    expect(dtcWebSearchUrl('P0135')).toBe('https://www.google.com/search?q=P0135%20OBD2');
  });

  it('builds a plain-text share message', () => {
    const msg = dtcShareMessage(buildDtcDetail('P1557', undefined, 'vag'), 'VW Golf');
    expect(msg).toContain('P1557 (VAG 05463)');
    expect(msg).toMatch(/charge pressure/i);
    expect(msg).toContain('manufacturer-specific');
    expect(msg).toContain('Vehicle: VW Golf');
    expect(DTC_DETAIL_FOOTER).toMatch(/SAE J2012/);
  });
});
