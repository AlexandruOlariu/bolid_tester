#!/usr/bin/env node
/** Store assets (plan 30, store/README.md).
 *
 *    node scripts/store-assets.mjs              # check (default; npm run check:store, CI verify)
 *    node scripts/store-assets.mjs --release    # check + every release minimum (≥ 6 phone
 *                                               # screenshots per language) — before a store upload
 *    node scripts/store-assets.mjs --generate   # (re)build the generated graphics, resize
 *                                               # screenshots, then check (npm run store:assets)
 *
 *  Check: listing text per language within the console limits and the same files in every
 *  language; `graphics/icon-512.png` 512 × 512 and `graphics/feature-graphic.png` 1024 × 500;
 *  every file under `screenshots/` in a `<set>/<lang>/` folder and every screenshot at its set's
 *  size (PNG headers only — no image library, so CI runs
 *  it after `npm install --ignore-scripts`). Exit 1 with one line per problem.
 *
 *  Generate (needs the `sharp` devDependency): `icon-512.png` from assets/icon.png, the feature
 *  graphic from its hand-editable source `graphics/feature-graphic.svg`, and every screenshot that
 *  is not at its set's size resized in place (cover + centre crop; Maestro writes them at the
 *  emulator's resolution — scripts/screenshots.sh).
 *
 *  The rules live in src/shared/lib/storeAssets.ts (imported through Node's type stripping, like
 *  scripts/analyze-capture.mjs), where Jest tests them. */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

process.removeAllListeners('warning');
process.on('warning', (w) => {
  if (w.code === 'MODULE_TYPELESS_PACKAGE_JSON') return;
  process.stderr.write(`${w.name}: ${w.message}\n`);
});
const {
  GRAPHIC_SIZES,
  LISTING_LANGUAGES,
  SCREENSHOT_SETS,
  checkGraphic,
  checkListing,
  checkListingParity,
  checkScreenshotPlacement,
  checkScreenshots,
  pngSize,
} = await import('../src/shared/lib/storeAssets.ts');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STORE = join(ROOT, 'store');
const args = new Set(process.argv.slice(2));
const release = args.has('--release');
const generate = args.has('--generate');

/** Every file under `dir`, as paths relative to it with forward slashes. */
function walk(dir, base = dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory()
      ? walk(full, base)
      : [relative(base, full).split('\\').join('/')];
  });
}

const sizeOf = (file) => pngSize(readFileSync(file));

async function generateAssets() {
  let sharp;
  try {
    sharp = (await import('sharp')).default;
  } catch {
    console.error('store-assets: --generate needs the sharp devDependency (npm install).');
    process.exit(1);
  }
  const graphics = join(STORE, 'graphics');
  await sharp(join(ROOT, 'assets', 'icon.png'))
    .resize(512, 512, { kernel: 'lanczos3' })
    .png({ compressionLevel: 9 })
    .toFile(join(graphics, 'icon-512.png'));
  console.log('store-assets: graphics/icon-512.png');

  const fg = GRAPHIC_SIZES['feature-graphic.png'];
  await sharp(join(graphics, 'feature-graphic.svg'), { density: 144 })
    .resize(fg.width, fg.height)
    .flatten({ background: '#2bb673' }) // the console rejects transparency
    .png({ compressionLevel: 9 })
    .toFile(join(graphics, 'feature-graphic.png'));
  console.log('store-assets: graphics/feature-graphic.png');

  // Only the folders the check reads; a misplaced file is left alone and reported by check().
  for (const [set, rule] of Object.entries(SCREENSHOT_SETS)) {
    for (const lang of LISTING_LANGUAGES) {
      const dir = join(STORE, 'screenshots', ...set.split('/'), lang);
      for (const file of walk(dir).filter((f) => f.endsWith('.png') && !f.includes('/'))) {
        const full = join(dir, file);
        const size = sizeOf(full);
        if (size && size.width === rule.size.width && size.height === rule.size.height) continue;
        const out = await sharp(readFileSync(full))
          .resize(rule.size.width, rule.size.height, { fit: 'cover', position: 'centre' })
          .png({ compressionLevel: 9 })
          .toBuffer();
        await sharp(out).toFile(full);
        console.log(`store-assets: resized screenshots/${set}/${lang}/${file}`);
      }
    }
  }
}

function check() {
  const problems = [];

  // Listing text.
  const byLang = {};
  for (const lang of LISTING_LANGUAGES) {
    const dir = join(STORE, 'listing', lang);
    const files = {};
    for (const f of walk(dir).filter((x) => x.endsWith('.txt'))) {
      files[f] = readFileSync(join(dir, ...f.split('/')), 'utf8').replace(/\r\n?/g, '\n');
    }
    byLang[lang] = files;
    problems.push(...checkListing(lang, files));
  }
  problems.push(...checkListingParity(byLang));

  // Graphics.
  for (const name of Object.keys(GRAPHIC_SIZES)) {
    const file = join(STORE, 'graphics', name);
    problems.push(...checkGraphic(name, existsSync(file) ? sizeOf(file) : undefined));
  }

  // Screenshots: store/screenshots/<set>/<lang>/*.png — anything elsewhere is reported, since the
  // size check below reads only those folders.
  problems.push(...checkScreenshotPlacement(walk(join(STORE, 'screenshots'))));
  let shots = 0;
  for (const set of Object.keys(SCREENSHOT_SETS)) {
    for (const lang of LISTING_LANGUAGES) {
      const dir = join(STORE, 'screenshots', ...set.split('/'), lang);
      const files = {};
      for (const f of walk(dir).filter((x) => x.endsWith('.png'))) {
        files[f] = sizeOf(join(dir, ...f.split('/')));
      }
      shots += Object.keys(files).length;
      problems.push(...checkScreenshots(set, lang, files, release));
    }
  }

  if (problems.length > 0) {
    for (const p of problems) console.error(`store-assets: ${p}`);
    process.exit(1);
  }
  console.log(
    `store-assets: OK — ${LISTING_LANGUAGES.length} listing languages, ${Object.keys(GRAPHIC_SIZES).length} graphics, ${shots} screenshots${release ? ' (release minimums met)' : ''}`,
  );
}

if (generate) await generateAssets();
check();
