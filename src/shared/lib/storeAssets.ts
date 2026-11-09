/** Store listing rules (plan 30, store/README.md): the size of every graphic and screenshot set,
 *  the character limits of the listing text, and the checks `scripts/store-assets.mjs` runs on the
 *  committed `store/` tree. Pure and dependency-free with only erasable types, so the script imports
 *  this file directly through Node's type stripping and Jest tests it in the core project. */

export interface PixelSize {
  width: number;
  height: number;
}

/** Listing text files per language (`store/listing/<lang>/`) and their limits in characters
 *  (Unicode code points, the way both consoles count). `keywords.txt` is the App Store keyword
 *  field (comma-separated). Release notes live in `whats-new/<version>.txt`. */
export const LISTING_LIMITS: Readonly<Record<string, number>> = {
  'title.txt': 30,
  'short.txt': 80,
  'full.txt': 4000,
  'keywords.txt': 100,
  'subtitle.txt': 30,
};

/** Play "What's new" (500) is stricter than App Store "What's New" (4000). */
export const WHATS_NEW_LIMIT = 500;

/** The languages every listing ships in (plan 11). */
export const LISTING_LANGUAGES = ['en', 'ro'] as const;

/** Fixed-size graphics under `store/graphics/`. */
export const GRAPHIC_SIZES: Readonly<Record<string, PixelSize>> = {
  'icon-512.png': { width: 512, height: 512 },
  'feature-graphic.png': { width: 1024, height: 500 },
};

/** Screenshot sets under `store/screenshots/<set>/<lang>/*.png`, the size every file in a set must
 *  have, and how many a release needs per language (0 = optional set). */
export const SCREENSHOT_SETS: Readonly<
  Record<string, { size: PixelSize; minForRelease: number; maxPerLanguage: number }>
> = {
  'android/phone': { size: { width: 1080, height: 2400 }, minForRelease: 6, maxPerLanguage: 8 },
  'android/tablet-10': { size: { width: 1600, height: 2560 }, minForRelease: 0, maxPerLanguage: 8 },
  'ios/6.7': { size: { width: 1290, height: 2796 }, minForRelease: 0, maxPerLanguage: 10 },
};

/** Characters as the consoles count them (code points, so "ă" or "–" is one). */
export function charLength(text: string): number {
  return Array.from(text).length;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Width and height from a PNG's IHDR chunk (the first chunk, bytes 16–23), or null when the bytes
 *  are not a PNG. Reads the header only, so the check needs no image library. */
export function pngSize(bytes: Uint8Array): PixelSize | null {
  if (bytes.length < 24) return null;
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return null;
  }
  // Chunk type "IHDR" at 12..15.
  if (bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) {
    return null;
  }
  const u32 = (o: number) =>
    ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0;
  return { width: u32(16), height: u32(20) };
}

/** The text of one listing language: file name (relative to `store/listing/<lang>/`, e.g.
 *  `full.txt` or `whats-new/1.0.0.txt`) → content. */
export type ListingFiles = Readonly<Record<string, string>>;

/** Problems with one language's listing text: a required file missing or empty, or over its limit.
 *  Trailing newlines are not counted (editors add one). */
export function checkListing(lang: string, files: ListingFiles): string[] {
  const problems: string[] = [];
  for (const [name, limit] of Object.entries(LISTING_LIMITS)) {
    const raw = files[name];
    if (raw === undefined) {
      problems.push(`listing/${lang}/${name} is missing`);
      continue;
    }
    const text = raw.replace(/\s+$/, '');
    if (text.length === 0) problems.push(`listing/${lang}/${name} is empty`);
    const n = charLength(text);
    if (n > limit) problems.push(`listing/${lang}/${name} has ${n} characters (limit ${limit})`);
    if (name !== 'full.txt' && /\n/.test(text)) {
      problems.push(`listing/${lang}/${name} must be one line`);
    }
  }
  const notes = Object.keys(files).filter((f) => /^whats-new\/\d+\.\d+\.\d+\.txt$/.test(f));
  if (notes.length === 0) problems.push(`listing/${lang}/whats-new/<version>.txt is missing`);
  for (const f of notes) {
    const n = charLength(files[f].replace(/\s+$/, ''));
    if (n > WHATS_NEW_LIMIT) {
      problems.push(`listing/${lang}/${f} has ${n} characters (limit ${WHATS_NEW_LIMIT})`);
    }
  }
  return problems;
}

/** Problems when the languages do not ship the same files (a Romanian file without its English
 *  counterpart, or the other way round). */
export function checkListingParity(byLang: Readonly<Record<string, ListingFiles>>): string[] {
  const langs = Object.keys(byLang);
  const all = new Set(langs.flatMap((l) => Object.keys(byLang[l])));
  const problems: string[] = [];
  for (const lang of langs) {
    for (const f of all) {
      if (byLang[lang][f] === undefined) problems.push(`listing/${lang}/${f} is missing`);
    }
  }
  return problems;
}

/** Problems with one graphic: absent, not a PNG, or the wrong size. */
export function checkGraphic(name: string, size: PixelSize | null | undefined): string[] {
  const want = GRAPHIC_SIZES[name];
  if (!want) return [`graphics/${name} is not a known store graphic`];
  if (size === undefined) return [`graphics/${name} is missing`];
  if (size === null) return [`graphics/${name} is not a PNG`];
  return size.width === want.width && size.height === want.height
    ? []
    : [`graphics/${name} is ${size.width} × ${size.height}, needs ${want.width} × ${want.height}`];
}

/** Problems with where files sit under `store/screenshots/`: every file (paths relative to that
 *  folder, forward slashes) must be a `.png` directly in `<set>/<lang>/` of a known set and listing
 *  language. The size check reads only those folders, so a screenshot dropped straight into
 *  `android/phone/` or into a misnamed `en-US/` would otherwise never be checked. Dotfiles
 *  (`.gitkeep`, `.DS_Store`) are ignored. */
export function checkScreenshotPlacement(paths: readonly string[]): string[] {
  const langs: readonly string[] = LISTING_LANGUAGES;
  const problems: string[] = [];
  for (const path of [...paths].sort()) {
    const parts = path.split('/');
    const name = parts[parts.length - 1];
    if (name.startsWith('.')) continue;
    const where = `screenshots/${path}`;
    const placed =
      parts.length === 4 &&
      SCREENSHOT_SETS[`${parts[0]}/${parts[1]}`] !== undefined &&
      langs.includes(parts[2]);
    if (!placed) {
      problems.push(
        `${where} is not in screenshots/<set>/<lang>/ (sets: ${Object.keys(SCREENSHOT_SETS).join(', ')}; languages: ${langs.join(', ')})`,
      );
    } else if (!name.endsWith('.png')) {
      problems.push(`${where} is not a .png file`);
    }
  }
  return problems;
}

/** Problems with one screenshot set in one language: a file of the wrong size or not a PNG, too
 *  many files, and — with `release` — fewer than the set's release minimum. `files` maps a file
 *  name to its PNG size (null = not a PNG). */
export function checkScreenshots(
  set: string,
  lang: string,
  files: Readonly<Record<string, PixelSize | null>>,
  release: boolean,
): string[] {
  const rule = SCREENSHOT_SETS[set];
  if (!rule) return [`screenshots/${set} is not a known screenshot set`];
  const problems: string[] = [];
  const names = Object.keys(files).sort();
  for (const name of names) {
    const size = files[name];
    const where = `screenshots/${set}/${lang}/${name}`;
    if (size === null) problems.push(`${where} is not a PNG`);
    else if (size.width !== rule.size.width || size.height !== rule.size.height) {
      problems.push(
        `${where} is ${size.width} × ${size.height}, needs ${rule.size.width} × ${rule.size.height}`,
      );
    }
  }
  if (names.length > rule.maxPerLanguage) {
    problems.push(
      `screenshots/${set}/${lang} has ${names.length} files (the store takes ${rule.maxPerLanguage})`,
    );
  }
  if (release && names.length < rule.minForRelease) {
    problems.push(
      `screenshots/${set}/${lang} has ${names.length} files, a release needs ${rule.minForRelease} (run scripts/screenshots.sh)`,
    );
  }
  return problems;
}
