import { formatDate, formatFixed, formatNumber, getFormatLocale, setFormatLocale } from './format';

afterEach(() => setFormatLocale('en'));

describe('locale-aware number formatting (plan 11)', () => {
  it('uses a decimal point in English and a comma in Romanian', () => {
    setFormatLocale('en');
    expect(`${formatNumber(12.5, 1)} l/100 km`).toBe('12.5 l/100 km');
    setFormatLocale('ro');
    expect(getFormatLocale()).toBe('ro');
    expect(`${formatNumber(12.5, 1)} l/100 km`).toBe('12,5 l/100 km');
  });

  it('rounds to the given fraction digits, without grouping by default', () => {
    expect(formatNumber(1234.567, 1, { locale: 'en' })).toBe('1234.6');
    expect(formatNumber(1234.567, 0, { locale: 'ro' })).toBe('1235');
    expect(formatNumber(1234.5, 1, { locale: 'en', grouping: true })).toBe('1,234.5');
  });

  it('formatFixed keeps trailing zeros like toFixed', () => {
    expect(formatFixed(12, 2, 'en')).toBe('12.00');
    expect(formatFixed(3.1, 2, 'ro')).toBe('3,10');
  });

  it('non-finite values show a dash', () => {
    expect(formatNumber(Number.NaN)).toBe('—');
    expect(formatNumber(Number.POSITIVE_INFINITY)).toBe('—');
  });

  it('dates follow the language', () => {
    const ts = new Date(2026, 10, 9, 12).getTime();
    expect(formatDate(ts, 'en')).toMatch(/Nov/);
    expect(formatDate(ts, 'ro')).toMatch(/nov/);
    expect(formatDate(Number.NaN, 'en')).toBe('—');
  });
});
