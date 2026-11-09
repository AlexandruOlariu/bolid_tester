/** Translation completeness (plan 11): every language has every key, no value is empty, the
 *  `{{placeholders}}` agree and plural keys carry each language's plural forms. Runs over the real
 *  bundled resources, so removing a key from one language fails CI. */
import fs from 'fs';
import path from 'path';
import { checkLocaleParity, flattenBundle, placeholders, pluralCategories } from './i18nParity';
import { NAMESPACES, resources } from '../i18n/locales';
import { SUPPORTED } from './i18nResolve';

const LOCALES_DIR = path.join(__dirname, '..', 'i18n', 'locales');

describe('bundled locales (plan 11)', () => {
  it('registers every JSON file on disk, for every supported language', () => {
    for (const lang of SUPPORTED) {
      const onDisk = fs
        .readdirSync(path.join(LOCALES_DIR, lang))
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.replace(/\.json$/, ''))
        .sort();
      expect({ lang, namespaces: onDisk }).toEqual({ lang, namespaces: [...NAMESPACES].sort() });
      expect(Object.keys(resources[lang]).sort()).toEqual([...NAMESPACES].sort());
    }
  });

  it('every English key exists in Romanian and vice versa, with matching placeholders', () => {
    expect(checkLocaleParity(resources.en, resources.ro, 'en', 'ro')).toEqual([]);
  });

  it('has a substantial amount of copy (the whole UI, not a stub)', () => {
    expect(flattenBundle(resources.en).size).toBeGreaterThan(1000);
  });

  it('Romanian uses comma-below diacritics (ș ț), never the cedilla forms (ş ţ)', () => {
    const bad = [...flattenBundle(resources.ro)].filter(([, v]) => /[şţŞŢ]/.test(v));
    expect(bad.map(([k]) => k)).toEqual([]);
  });
});

describe('checkLocaleParity', () => {
  const en = {
    common: {
      title: 'Settings',
      greet: 'Hello {{name}}',
      codes_one: '{{count}} code',
      codes_other: '{{count}} codes',
    },
  };
  const ro = {
    common: {
      title: 'Setări',
      greet: 'Salut {{name}}',
      codes_one: '{{count}} cod',
      codes_few: '{{count}} coduri',
      codes_other: '{{count}} de coduri',
    },
  };

  it('passes a complete translation', () => {
    expect(checkLocaleParity(en, ro)).toEqual([]);
  });

  it('fails when an English key is missing in Romanian', () => {
    const { title: _title, ...rest } = ro.common;
    expect(checkLocaleParity(en, { common: rest })).toContain('ro is missing common:title');
  });

  it('fails on an extra key, an empty value and a changed placeholder', () => {
    const problems = checkLocaleParity(en, {
      common: { ...ro.common, extra: 'x', title: ' ', greet: 'Salut {{nume}}' },
    });
    expect(problems).toContain('ro has extra key common:extra (not in en)');
    expect(problems).toContain('ro common:title: empty value');
    expect(problems.some((p) => p.startsWith('ro common:greet: placeholders'))).toBe(true);
  });

  it('demands each language’s plural forms (Romanian needs one / few / other)', () => {
    const { codes_few: _few, ...noFew } = ro.common;
    expect(checkLocaleParity(en, { common: noFew }).join('\n')).toMatch(
      /ro common:codes: plural forms/,
    );
    expect(pluralCategories('ro')).toEqual(['few', 'one', 'other']);
    expect(pluralCategories('en')).toEqual(['one', 'other']);
  });

  it('reads placeholders', () => {
    expect(placeholders('{{b}} and {{ a }}')).toEqual(['a', 'b']);
  });
});
