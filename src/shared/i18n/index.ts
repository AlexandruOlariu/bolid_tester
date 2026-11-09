/** App localization (plan 11, docs/i18n.md): i18next + react-i18next with statically bundled JSON
 *  resources, English and Romanian. Initialised synchronously in English at import, so the first
 *  render (and every test) has strings; `initI18n` then switches to the resolved language while the
 *  splash is still up (see `useLanguageSync`), so there is no English flash.
 *
 *  Components: `const { t } = useTranslation('<namespace>')`. Outside React (notifications, model
 *  helpers): `i18n.t('<ns>:<key>')`. Core strings (PID names, DTC descriptions, protocol labels, AT
 *  commands) stay English — they are technical identifiers, not UI copy. */
// Hermes ships no Intl.PluralRules; i18next needs it for `_one` / `_few` / `_other`. The polyfill
// installs itself only when the runtime lacks it (Node and browsers keep their own).
import 'intl-pluralrules';
import i18n, { type TOptions } from 'i18next';
import { initReactI18next } from 'react-i18next';
import { NAMESPACES, resources } from './locales';
import {
  DEFAULT_LANG,
  SUPPORTED,
  resolveLanguage,
  type Lang,
  type LanguagePref,
} from '@/shared/lib/i18nResolve';
import { setFormatLocale } from '@/shared/lib/format';

export { SUPPORTED, resolveLanguage, type Lang, type LanguagePref };

void i18n.use(initReactI18next).init({
  resources,
  lng: DEFAULT_LANG,
  fallbackLng: DEFAULT_LANG,
  supportedLngs: [...SUPPORTED],
  ns: [...NAMESPACES],
  defaultNS: 'common',
  // Resources are in memory: initialise synchronously so `t` works on the first render.
  initAsync: false,
  interpolation: { escapeValue: false },
  returnNull: false,
  react: { useSuspense: false },
});
setFormatLocale(i18n.language);
i18n.on('languageChanged', (lng) => setFormatLocale(lng));

interface LocalizationModule {
  getLocales: () => { languageTag: string }[];
}

/** The device's preferred locale tags, most preferred first; `[]` when expo-localization is absent
 *  (tests, a build without the module). Loaded with a variable specifier like other optional native
 *  modules. */
export async function deviceLanguageTags(): Promise<string[]> {
  try {
    const mod = (await import('expo-localization' as string)) as LocalizationModule;
    return mod.getLocales().map((l) => l.languageTag);
  } catch {
    return [];
  }
}

/** Switch the UI language (live, no restart). */
export async function setLanguage(lang: Lang): Promise<void> {
  if (i18n.language !== lang) await i18n.changeLanguage(lang);
}

/** Resolve the Settings preference (`system` → the device language) and apply it. */
export async function initI18n(pref: LanguagePref): Promise<Lang> {
  const tags = pref === 'system' ? await deviceLanguageTags() : [];
  const lang = resolveLanguage(pref, tags);
  await setLanguage(lang);
  return lang;
}

/** `i18n.t` for code outside React (services, model helpers, notifications): a plain
 *  `(key, values) → string` so callers need no i18next option types. `key` is `ns:dotted.key`. */
export function translate(key: string, values?: Record<string, unknown>): string {
  return String(i18n.t(key, (values ?? {}) as TOptions));
}

/** The language currently shown. */
export function currentLanguage(): Lang {
  return (SUPPORTED as readonly string[]).includes(i18n.language)
    ? (i18n.language as Lang)
    : DEFAULT_LANG;
}

/** Re-exported so every component imports it from here: importing this module is what initialises
 *  i18next, so a screen rendered on its own (a test, a lazy route) always has its strings. */
export { useTranslation, Trans } from 'react-i18next';
export type { TFunction } from 'i18next';

export { i18n };
export default i18n;
