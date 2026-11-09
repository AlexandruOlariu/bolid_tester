/** Store listing rules (plan 30, store/README.md): the pure checks behind
 *  `scripts/store-assets.mjs`, and the committed `store/` tree run through them — so a listing text
 *  over its console limit, a missing Romanian file or a wrongly sized graphic fails `npm test` as
 *  well as `npm run check:store`. */
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import {
  GRAPHIC_SIZES,
  LISTING_LANGUAGES,
  LISTING_LIMITS,
  SCREENSHOT_SETS,
  charLength,
  checkGraphic,
  checkListing,
  checkListingParity,
  checkScreenshotPlacement,
  checkScreenshots,
  pngSize,
} from './storeAssets';

const root = join(__dirname, '..', '..', '..');
const store = join(root, 'store');

/** A minimal PNG header (signature + IHDR length/type + width/height) — enough for `pngSize`. */
function pngHeader(width: number, height: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  b.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8);
  const view = new DataView(b.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return b;
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

function listing(lang: string): Record<string, string> {
  const dir = join(store, 'listing', lang);
  const files: Record<string, string> = {};
  for (const full of walk(dir).filter((f) => f.endsWith('.txt'))) {
    files[relative(dir, full).split('\\').join('/')] = readFileSync(full, 'utf8').replace(
      /\r\n?/g,
      '\n',
    );
  }
  return files;
}

const VALID: Record<string, string> = {
  'title.txt': 'Bolid Tester – OBD2 Scanner\n',
  'subtitle.txt': 'OBD2 diagnostics for any car\n',
  'short.txt': 'Live data and fault codes.\n',
  'full.txt': 'Line one.\n\nLine two.\n',
  'keywords.txt': 'obd2,elm327\n',
  'whats-new/1.0.0.txt': 'First release.\n',
};

describe('pngSize', () => {
  it('reads width and height from the IHDR chunk', () => {
    expect(pngSize(pngHeader(1080, 2400))).toEqual({ width: 1080, height: 2400 });
    expect(pngSize(pngHeader(1024, 500))).toEqual({ width: 1024, height: 500 });
  });

  it('returns null for anything that is not a PNG', () => {
    expect(pngSize(new Uint8Array([0xff, 0xd8, 0xff]))).toBeNull(); // JPEG start, too short
    const jpegLike = pngHeader(10, 10);
    jpegLike[1] = 0x00;
    expect(pngSize(jpegLike)).toBeNull();
    const noIhdr = pngHeader(10, 10);
    noIhdr[12] = 0x58;
    expect(pngSize(noIhdr)).toBeNull();
  });
});

describe('checkListing', () => {
  it('accepts a complete listing within the limits', () => {
    expect(checkListing('en', VALID)).toEqual([]);
  });

  it('counts characters as code points, so diacritics and dashes count once', () => {
    expect(charLength('ăâîșț–')).toBe(6);
    const exactly30 = 'Ă'.repeat(30);
    expect(checkListing('ro', { ...VALID, 'title.txt': exactly30 })).toEqual([]);
    expect(checkListing('ro', { ...VALID, 'title.txt': `${exactly30}x` })).toEqual([
      'listing/ro/title.txt has 31 characters (limit 30)',
    ]);
  });

  it('enforces each console limit', () => {
    expect(LISTING_LIMITS['short.txt']).toBe(80);
    expect(LISTING_LIMITS['full.txt']).toBe(4000);
    expect(LISTING_LIMITS['keywords.txt']).toBe(100);
    expect(checkListing('en', { ...VALID, 'short.txt': 'x'.repeat(81) })).toEqual([
      'listing/en/short.txt has 81 characters (limit 80)',
    ]);
    expect(checkListing('en', { ...VALID, 'full.txt': 'x'.repeat(4001) })).toEqual([
      'listing/en/full.txt has 4001 characters (limit 4000)',
    ]);
    expect(checkListing('en', { ...VALID, 'keywords.txt': 'k,'.repeat(51) })).toEqual([
      'listing/en/keywords.txt has 102 characters (limit 100)',
    ]);
    expect(checkListing('en', { ...VALID, 'whats-new/1.0.0.txt': 'n'.repeat(501) })).toEqual([
      'listing/en/whats-new/1.0.0.txt has 501 characters (limit 500)',
    ]);
  });

  it('reports missing, empty and multi-line single-line files', () => {
    const { ['short.txt']: _short, ...noShort } = VALID;
    expect(checkListing('en', noShort)).toEqual(['listing/en/short.txt is missing']);
    expect(checkListing('en', { ...VALID, 'title.txt': '  \n' })).toEqual([
      'listing/en/title.txt is empty',
    ]);
    expect(checkListing('en', { ...VALID, 'short.txt': 'one\ntwo' })).toEqual([
      'listing/en/short.txt must be one line',
    ]);
    const { ['whats-new/1.0.0.txt']: _notes, ...noNotes } = VALID;
    expect(checkListing('en', noNotes)).toEqual(['listing/en/whats-new/<version>.txt is missing']);
  });

  it('requires the same files in every language', () => {
    expect(checkListingParity({ en: VALID, ro: VALID })).toEqual([]);
    const { ['keywords.txt']: _k, ...roMissing } = VALID;
    expect(checkListingParity({ en: VALID, ro: roMissing })).toEqual([
      'listing/ro/keywords.txt is missing',
    ]);
  });
});

describe('checkGraphic / checkScreenshots', () => {
  it('pins the store graphic sizes', () => {
    expect(GRAPHIC_SIZES['icon-512.png']).toEqual({ width: 512, height: 512 });
    expect(GRAPHIC_SIZES['feature-graphic.png']).toEqual({ width: 1024, height: 500 });
    expect(checkGraphic('icon-512.png', { width: 512, height: 512 })).toEqual([]);
    expect(checkGraphic('icon-512.png', { width: 1024, height: 1024 })).toEqual([
      'graphics/icon-512.png is 1024 × 1024, needs 512 × 512',
    ]);
    expect(checkGraphic('feature-graphic.png', undefined)).toEqual([
      'graphics/feature-graphic.png is missing',
    ]);
    expect(checkGraphic('feature-graphic.png', null)).toEqual([
      'graphics/feature-graphic.png is not a PNG',
    ]);
  });

  it('checks every screenshot against its set size, and the release minimum', () => {
    expect(SCREENSHOT_SETS['android/phone'].size).toEqual({ width: 1080, height: 2400 });
    const good = { width: 1080, height: 2400 };
    const six = Object.fromEntries(
      Array.from({ length: 6 }, (_, i) => [`0${i + 1}-screen.png`, good]),
    );
    expect(checkScreenshots('android/phone', 'en', six, true)).toEqual([]);
    expect(
      checkScreenshots(
        'android/phone',
        'en',
        { ...six, '07-bad.png': { width: 1080, height: 1920 } },
        false,
      ),
    ).toEqual(['screenshots/android/phone/en/07-bad.png is 1080 × 1920, needs 1080 × 2400']);
    expect(checkScreenshots('android/phone', 'ro', { '01.png': good }, false)).toEqual([]);
    expect(checkScreenshots('android/phone', 'ro', { '01.png': good }, true)).toEqual([
      'screenshots/android/phone/ro has 1 files, a release needs 6 (run scripts/screenshots.sh)',
    ]);
    const nine = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`${i}.png`, good]));
    expect(checkScreenshots('android/phone', 'en', nine, false)).toEqual([
      'screenshots/android/phone/en has 9 files (the store takes 8)',
    ]);
  });
});

describe('checkScreenshotPlacement', () => {
  it('accepts PNGs in <set>/<lang>/ and ignores dotfiles', () => {
    expect(
      checkScreenshotPlacement([
        'android/phone/en/01-live.png',
        'android/tablet-10/ro/01-live.png',
        'ios/6.7/en/01-live.png',
        'android/phone/.gitkeep',
        'android/phone/en/.DS_Store',
      ]),
    ).toEqual([]);
  });

  it('reports files outside a known set / language folder, and non-PNGs', () => {
    const where = '(sets: android/phone, android/tablet-10, ios/6.7; languages: en, ro)';
    expect(
      checkScreenshotPlacement([
        'android/phone/01-live.png',
        'android/phone/en-US/01-live.png',
        'android/watch/en/01.png',
        'android/phone/en/sub/01.png',
        'android/phone/en/01-live.jpg',
      ]),
    ).toEqual([
      `screenshots/android/phone/01-live.png is not in screenshots/<set>/<lang>/ ${where}`,
      `screenshots/android/phone/en-US/01-live.png is not in screenshots/<set>/<lang>/ ${where}`,
      'screenshots/android/phone/en/01-live.jpg is not a .png file',
      `screenshots/android/phone/en/sub/01.png is not in screenshots/<set>/<lang>/ ${where}`,
      `screenshots/android/watch/en/01.png is not in screenshots/<set>/<lang>/ ${where}`,
    ]);
  });
});

describe('the committed store/ tree', () => {
  it.each(LISTING_LANGUAGES)('listing/%s is complete and within the console limits', (lang) => {
    expect(checkListing(lang, listing(lang))).toEqual([]);
  });

  it('ships the same listing files in English and Romanian', () => {
    expect(
      checkListingParity(Object.fromEntries(LISTING_LANGUAGES.map((l) => [l, listing(l)]))),
    ).toEqual([]);
  });

  it('has the 512 icon and the 1024 × 500 feature graphic', () => {
    for (const name of Object.keys(GRAPHIC_SIZES)) {
      const file = join(store, 'graphics', name);
      expect(existsSync(file)).toBe(true);
      expect(checkGraphic(name, pngSize(readFileSync(file)))).toEqual([]);
    }
  });

  it('every committed screenshot sits in a <set>/<lang>/ folder', () => {
    const dir = join(store, 'screenshots');
    const paths = walk(dir).map((f) => relative(dir, f).split('\\').join('/'));
    expect(checkScreenshotPlacement(paths)).toEqual([]);
  });

  it('every committed screenshot has its set size', () => {
    for (const set of Object.keys(SCREENSHOT_SETS)) {
      for (const lang of LISTING_LANGUAGES) {
        const dir = join(store, 'screenshots', ...set.split('/'), lang);
        const files = Object.fromEntries(
          walk(dir)
            .filter((f) => f.endsWith('.png'))
            .map((f) => [relative(dir, f), pngSize(readFileSync(f))]),
        );
        expect(checkScreenshots(set, lang, files, false)).toEqual([]);
      }
    }
  });

  it('keeps the listing honest: metric, local-first, and clear about what it is not', () => {
    const full = listing('en')['full.txt'];
    expect(full).toMatch(/not a replacement for VCDS/);
    expect(full).toMatch(/No account, no advertising, no analytics, no tracking/);
    expect(full).toMatch(/experimental/i);
    // The experimental module scan reads ABS / cluster faults (screenshot 05), so the listing may
    // not claim there is no such diagnosis at all — only no full one.
    expect(full).toMatch(/no full ABS, airbag, transmission or instrument-cluster diagnosis/);
    expect(full).not.toMatch(/there are no ABS/);
    expect(full).toMatch(/km\/h/);
    for (const lang of LISTING_LANGUAGES) {
      for (const text of Object.values(listing(lang))) {
        expect(text).not.toMatch(/\b(mph|mpg|miles?|°F|psi|gallons?)\b/i);
      }
    }
  });
});
