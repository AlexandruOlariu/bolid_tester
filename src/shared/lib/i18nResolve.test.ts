import { isLanguagePref, resolveLanguage, SUPPORTED } from './i18nResolve';

describe('resolveLanguage (plan 11)', () => {
  it('follows a Romanian device', () => {
    expect(resolveLanguage('system', ['ro-RO'])).toBe('ro');
    expect(resolveLanguage('system', ['ro'])).toBe('ro');
    expect(resolveLanguage('system', ['ro_MD', 'en-US'])).toBe('ro');
  });

  it('falls back to English for an unsupported device language', () => {
    expect(resolveLanguage('system', ['de-DE'])).toBe('en');
    expect(resolveLanguage('system', [])).toBe('en');
  });

  it('takes the first supported tag in the device preference order', () => {
    expect(resolveLanguage('system', ['de-DE', 'ro-RO', 'en-GB'])).toBe('ro');
    expect(resolveLanguage('system', ['fr-FR', 'en-GB', 'ro-RO'])).toBe('en');
  });

  it('an explicit preference wins over the device', () => {
    expect(resolveLanguage('en', ['ro-RO'])).toBe('en');
    expect(resolveLanguage('ro', ['de-DE'])).toBe('ro');
  });

  it('ships English and Romanian; validates stored preferences', () => {
    expect([...SUPPORTED]).toEqual(['en', 'ro']);
    expect(isLanguagePref('system')).toBe(true);
    expect(isLanguagePref('ro')).toBe(true);
    expect(isLanguagePref('de')).toBe(false);
    expect(isLanguagePref(undefined)).toBe(false);
  });
});
