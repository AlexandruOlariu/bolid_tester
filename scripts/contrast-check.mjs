#!/usr/bin/env node
/** Palette contrast check (plan 20, docs/accessibility.md):
 *
 *    node scripts/contrast-check.mjs [--palette <file.json>] [--verbose]   (npm run check:contrast)
 *
 *  Reads src/shared/ui/palette.json (the only colour source for on-screen UI) and exits 1 when a
 *  text token is under 4.5:1 or a graphic token under 3:1 against any surface of its theme, when the
 *  onFill text colour is under 4.5:1 on a token used as a fill, or when the splash title and
 *  subtitle (brand ink on brand green, both fully opaque) are under 4.5:1. The rules and the WCAG formula come from
 *  src/shared/lib/contrast.ts, transpiled in memory with the `typescript` devDependency — the same
 *  code the unit test runs. `--palette` checks another file (to prove a bad token fails). */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const at = args.indexOf('--palette');
const palettePath =
  at >= 0 ? resolve(args[at + 1] ?? '') : resolve(ROOT, 'src/shared/ui/palette.json');
const verbose = args.includes('--verbose');

function loadContrastModule() {
  const file = resolve(ROOT, 'src/shared/lib/contrast.ts');
  const { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: file,
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', outputText)(module, module.exports, require);
  return module.exports;
}

const { checkPalette, failures } = loadContrastModule();
let palette;
try {
  palette = JSON.parse(readFileSync(palettePath, 'utf8'));
} catch (e) {
  console.error(`Cannot read ${palettePath}: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(2);
}

const checks = checkPalette(palette);
const failed = failures(checks);
if (verbose) {
  for (const c of checks) {
    console.log(
      `${c.pass ? 'ok  ' : 'FAIL'} ${c.ratio.toFixed(2).padStart(5)} ≥ ${c.min}  ${c.pair}`,
    );
  }
}
if (failed.length > 0) {
  console.error(`Contrast check failed: ${failed.length} of ${checks.length} pair(s) too low.`);
  for (const c of failed) {
    console.error(`  ${c.pair}: ${c.ratio.toFixed(2)}:1, needs ${c.min}:1`);
  }
  process.exit(1);
}
console.log(`Contrast check passed: ${checks.length} pair(s), WCAG AA.`);
