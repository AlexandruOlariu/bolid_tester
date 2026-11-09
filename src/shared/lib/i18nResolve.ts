/** Pure language resolution for the app's localization (plan 11, docs/i18n.md). Kept free of
 *  i18next / React Native so the core test project can check it; the runtime wiring lives in
 *  `src/shared/i18n/`. */

/** The languages the app ships, in picker order. Adding one: copy `locales/en/`, translate, add the
 *  code here — the parity test (`i18nParity.test.ts`) then demands every key. */
export const SUPPORTED = ['en', 'ro'] as const;
export type Lang = (typeof SUPPORTED)[number];

/** The user's choice in Settings → General → Language: follow the device, or a fixed language. */
export type LanguagePref = 'system' | Lang;

export const DEFAULT_LANG: Lang = 'en';

export function isLang(v: unknown): v is Lang {
  return typeof v === 'string' && (SUPPORTED as readonly string[]).includes(v);
}

export function isLanguagePref(v: unknown): v is LanguagePref {
  return v === 'system' || isLang(v);
}

/** The language to show. An explicit preference wins; `'system'` takes the first device locale tag
 *  (BCP 47, most preferred first, e.g. `ro-RO`, `en-GB`) whose language part is supported, else
 *  English. */
export function resolveLanguage(pref: LanguagePref, deviceTags: readonly string[]): Lang {
  if (pref !== 'system') return pref;
  for (const tag of deviceTags) {
    const base = tag.trim().toLowerCase().split(/[-_]/)[0];
    if (isLang(base)) return base;
  }
  return DEFAULT_LANG;
}
