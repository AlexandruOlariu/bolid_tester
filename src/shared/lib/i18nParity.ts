/** Locale completeness checks (plan 11, docs/i18n.md): every key of the reference language
 *  (English) exists in each translation and vice versa, no value is empty, `{{placeholders}}` match
 *  per key, and plural keys carry exactly the plural categories each language needs
 *  (`Intl.PluralRules`): English `_one` / `_other`, Romanian `_one` / `_few` / `_other`. Pure, so
 *  the core tests run it over the real resource files (`i18nParity.test.ts`). */

export type LocaleTree = { [key: string]: string | LocaleTree };
/** namespace → tree, as bundled by `src/shared/i18n/locales`. */
export type LocaleBundle = Record<string, LocaleTree>;

const PLURAL_RE = /_(zero|one|two|few|many|other)$/;

/** Flatten to `ns:dotted.key → value`. A non-string leaf is reported as `''` (caught as empty). */
export function flattenBundle(bundle: LocaleBundle): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (prefix: string, node: unknown) => {
    if (typeof node === 'string') {
      out.set(prefix, node);
      return;
    }
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        walk(prefix.endsWith(':') ? `${prefix}${k}` : `${prefix}.${k}`, v);
      }
      return;
    }
    out.set(prefix, '');
  };
  for (const [ns, tree] of Object.entries(bundle)) walk(`${ns}:`, tree);
  return out;
}

/** The `{{name}}` placeholders in a value, sorted. */
export function placeholders(value: string): string[] {
  return [...value.matchAll(/\{\{\s*([\w.]+)[^}]*\}\}/g)].map((m) => m[1]).sort();
}

/** The plural categories `lang` uses (one / other when Intl.PluralRules is missing). */
export function pluralCategories(lang: string): string[] {
  try {
    return [...new Intl.PluralRules(lang).resolvedOptions().pluralCategories].sort();
  } catch {
    return ['one', 'other'];
  }
}

/** Plural keys grouped by base (`a.b_one`, `a.b_other` → `a.b` → {one, other}). A key counts as
 *  plural only when its base also has an `_other` form, so `x.only_one` alone stays a plain key. */
function pluralGroups(keys: Iterable<string>): Map<string, Set<string>> {
  const all = new Set(keys);
  const groups = new Map<string, Set<string>>();
  for (const key of all) {
    const m = PLURAL_RE.exec(key);
    if (!m) continue;
    const base = key.slice(0, -m[0].length);
    if (!all.has(`${base}_other`)) continue;
    const set = groups.get(base) ?? new Set<string>();
    set.add(m[1]);
    groups.set(base, set);
  }
  return groups;
}

function pluralBase(key: string, groups: Map<string, Set<string>>): string | null {
  const m = PLURAL_RE.exec(key);
  if (!m) return null;
  const base = key.slice(0, -m[0].length);
  return groups.has(base) ? base : null;
}

const sorted = (s: Iterable<string>) => [...s].sort().join(',');

/** Every problem found comparing `target` (language `targetLang`) with the reference `ref`
 *  (language `refLang`). An empty list means the translation is complete. */
export function checkLocaleParity(
  ref: LocaleBundle,
  target: LocaleBundle,
  refLang = 'en',
  targetLang = 'ro',
): string[] {
  const problems: string[] = [];
  const a = flattenBundle(ref);
  const b = flattenBundle(target);
  const aPlural = pluralGroups(a.keys());
  const bPlural = pluralGroups(b.keys());

  for (const [k, v] of a) {
    if (!v.trim()) problems.push(`${refLang} ${k}: empty value`);
    if (pluralBase(k, aPlural) === null && !b.has(k))
      problems.push(`${targetLang} is missing ${k}`);
  }
  for (const [k, v] of b) {
    if (!v.trim()) problems.push(`${targetLang} ${k}: empty value`);
    if (pluralBase(k, bPlural) === null && !a.has(k))
      problems.push(`${targetLang} has extra key ${k} (not in ${refLang})`);
  }

  const refCats = sorted(pluralCategories(refLang));
  const targetCats = sorted(pluralCategories(targetLang));
  for (const [base, cats] of aPlural) {
    if (sorted(cats) !== refCats)
      problems.push(`${refLang} ${base}: plural forms ${sorted(cats)}, expected ${refCats}`);
    const other = bPlural.get(base);
    if (!other) problems.push(`${targetLang} is missing plural ${base}`);
    else if (sorted(other) !== targetCats)
      problems.push(`${targetLang} ${base}: plural forms ${sorted(other)}, expected ${targetCats}`);
  }
  for (const base of bPlural.keys()) {
    if (!aPlural.has(base)) problems.push(`${targetLang} has extra plural ${base}`);
  }

  // Placeholders per key; a plural form is compared with the reference's `_other` form.
  for (const [k, v] of b) {
    const base = pluralBase(k, bPlural);
    const refValue = base !== null ? a.get(`${base}_other`) : a.get(k);
    if (refValue === undefined) continue;
    const want = placeholders(refValue).filter((p) => p !== 'count');
    const got = placeholders(v).filter((p) => p !== 'count');
    if (want.join(',') !== got.join(','))
      problems.push(`${targetLang} ${k}: placeholders {{${got}}}, ${refLang} has {{${want}}}`);
  }
  return problems;
}
