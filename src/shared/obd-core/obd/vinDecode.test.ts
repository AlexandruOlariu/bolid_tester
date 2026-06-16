import { decodeVin, decodeModelYear, computeCheckDigit, vinCheckDigit } from './vinDecode';

describe('VIN decode', () => {
  it('decodes the Golf Plus VIN (VW, Germany, 2009)', () => {
    const d = decodeVin('WVWZZZ1KZ9W903398');
    expect(d.validFormat).toBe(true);
    expect(d.wmi).toBe('WVW');
    expect(d.manufacturer).toBe('Volkswagen');
    expect(d.region).toBe('Europe');
    expect(d.country).toBe('Germany');
    expect(d.modelYear).toBe(2009);
    // ROW VIN — check digit is not mandated, so it's reported as not-applicable.
    expect(d.checkDigit.applicable).toBe(false);
  });

  it('decodes the Passat B5.5 VIN (VW, 2004)', () => {
    const d = decodeVin('WVWZZZ3BZ4E342958');
    expect(d.manufacturer).toBe('Volkswagen');
    expect(d.modelYear).toBe(2004);
  });

  it('decodes the Grande Punto VIN (Fiat, Italy)', () => {
    const d = decodeVin('ZFA19900000438592');
    expect(d.wmi).toBe('ZFA');
    expect(d.manufacturer).toBe('Fiat');
    expect(d.country).toBe('Italy');
    // char-10 is not a valid year code on this European VIN → year unknown (honest).
    expect(d.modelYear).toBeNull();
  });

  it('validates a North-American check digit (Honda, char 9 = 3)', () => {
    expect(computeCheckDigit('1HGCM82633A004352')).toBe('3');
    const cd = vinCheckDigit('1HGCM82633A004352');
    expect(cd.applicable).toBe(true);
    expect(cd.valid).toBe(true);
    const d = decodeVin('1HGCM82633A004352');
    expect(d.manufacturer).toBe('Honda');
    expect(d.country).toBe('United States');
    expect(d.modelYear).toBe(2003);
  });

  it('flags malformed VINs and the forbidden letters I/O/Q', () => {
    expect(decodeVin('NOT-A-VIN').validFormat).toBe(false);
    expect(decodeVin('WVWZZZ1KZ9W90339I').validFormat).toBe(false); // contains I
    expect(decodeVin('').validFormat).toBe(false);
  });

  it('decodeModelYear applies the char-7 rule', () => {
    expect(decodeModelYear('WVWZZZ1KZ9W903398')).toBe(2009); // numeric char-7 ⇒ 1980–2009
    expect(decodeModelYear('1HGCM82633A004352')).toBe(2003);
  });
});
