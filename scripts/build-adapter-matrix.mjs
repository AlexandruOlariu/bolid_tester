#!/usr/bin/env node
/** Adapter compatibility matrix builder (plan 29). Reads the community adapter-health reports in
 *  `docs/adapters/reports/*.json` and regenerates:
 *
 *    docs/adapters/matrix.md              the table (GENERATED — do not edit)
 *    docs/adapters/<slug>.md              one page per adapter (GENERATED)
 *    src/shared/adapters/knownAdapters.json  the in-app Known adapters list (GENERATED)
 *
 *    node scripts/build-adapter-matrix.mjs [--check] [--reports <dir>] [--out <dir>]
 *
 *  --check          regenerate in memory; exit 1 if any committed output differs (CI runs this)
 *  --reports <dir>  read reports from <dir> instead of docs/adapters/reports
 *  --out <dir>      write (or check) every output in <dir> — the Markdown and knownAdapters.json —
 *                   instead of the repository locations (the tests use this)
 *
 *  A malformed report, a report of another schema, or a simulator report (`adapter.link: "mock"`)
 *  makes it exit 1 with one line per problem. The validation, slug, aggregation and rendering live
 *  in src/shared/adapters/adapterMatrix.ts (shared with the app), imported here through Node's
 *  built-in type stripping (Node >= 22.18 / 24 / 25). No dependencies. */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The repo's package.json has no "type": "module", so Node warns that the .ts module "is not
// specified" before re-parsing it as ESM. That notice is noise here; other warnings still print.
process.removeAllListeners('warning');
process.on('warning', (w) => {
  if (w.code === 'MODULE_TYPELESS_PACKAGE_JSON') return;
  process.stderr.write(`${w.name}: ${w.message}\n`);
});
const { buildAdapterMatrix, validateAdapterReport, GENERATED_MARKER } =
  await import('../src/shared/adapters/adapterMatrix.ts');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Hand-written adapter guides, keyed by the name part of the slug; rendered as the Guide column. */
const EXTRA_DOCS = {
  'ios-vlink': '../adapter-vgate-icar-pro.md',
};

const USAGE =
  'usage: node scripts/build-adapter-matrix.mjs [--check] [--reports <dir>] [--out <dir>]';

function fail(message, code = 1) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

let check = false;
let reportsDir = join(ROOT, 'docs', 'adapters', 'reports');
let outDir = null;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  const value = () => {
    const v = args[++i];
    if (v === undefined) fail(`${a} needs a value\n${USAGE}`, 2);
    return resolve(v);
  };
  if (a === '--check') check = true;
  else if (a === '--reports') reportsDir = value();
  else if (a === '--out') outDir = value();
  else fail(`unknown argument ${a}\n${USAGE}`, 2);
}

const docsDir = outDir ?? join(ROOT, 'docs', 'adapters');
const knownJsonPath = outDir
  ? join(outDir, 'knownAdapters.json')
  : join(ROOT, 'src', 'shared', 'adapters', 'knownAdapters.json');
const rel = (p) => relative(process.cwd(), p) || p;

// --- Read + validate ----------------------------------------------------------------------------

if (!existsSync(reportsDir)) fail(`reports directory not found: ${rel(reportsDir)}`);
const files = readdirSync(reportsDir)
  .filter((f) => f.toLowerCase().endsWith('.json'))
  .sort();
const reports = [];
const problems = [];
for (const f of files) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(join(reportsDir, f), 'utf8'));
  } catch (e) {
    problems.push(`${f}: not valid JSON (${e instanceof Error ? e.message : String(e)})`);
    continue;
  }
  const issues = validateAdapterReport(parsed);
  if (issues.length) for (const issue of issues) problems.push(`${f}: ${issue}`);
  else reports.push(parsed);
}
if (problems.length) {
  fail(
    `Rejected ${problems.length} problem(s) in ${rel(reportsDir)}:\n` +
      problems.map((p) => `  - ${p}`).join('\n') +
      '\nFix or remove the file(s); see docs/adapters/README.md.',
  );
}

// --- Render -------------------------------------------------------------------------------------

const built = buildAdapterMatrix(reports, { extraDocs: EXTRA_DOCS });
/** Every output path → its expected content. */
const outputs = new Map();
outputs.set(join(docsDir, 'matrix.md'), built.matrix);
for (const [slug, page] of Object.entries(built.pages))
  outputs.set(join(docsDir, `${slug}.md`), page);
outputs.set(knownJsonPath, built.knownAdaptersJson);

/** Generated pages already on disk that no report produces any more. */
const stale = existsSync(docsDir)
  ? readdirSync(docsDir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => join(docsDir, f))
      .filter((p) => !outputs.has(p) && readFileSync(p, 'utf8').startsWith(GENERATED_MARKER))
  : [];

const normalise = (s) => s.replace(/\r\n/g, '\n');
const summary = `${reports.length} report(s), ${Object.keys(built.pages).length} adapter(s)`;

if (check) {
  const differ = [];
  for (const [path, content] of outputs) {
    if (!existsSync(path)) differ.push(`missing: ${rel(path)}`);
    else if (normalise(readFileSync(path, 'utf8')) !== content)
      differ.push(`out of date: ${rel(path)}`);
  }
  for (const p of stale) differ.push(`stale generated page: ${rel(p)}`);
  if (differ.length) {
    fail(
      `Adapter matrix is not up to date (${summary}):\n` +
        differ.map((d) => `  - ${d}`).join('\n') +
        '\nRun `npm run adapters:build` and commit the result (never edit generated files by hand).',
    );
  }
  process.stdout.write(`Adapter matrix is up to date (${summary}).\n`);
} else {
  for (const [path, content] of outputs) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  for (const p of stale) rmSync(p);
  process.stdout.write(
    `Wrote the adapter matrix (${summary})${stale.length ? `, removed ${stale.length} stale page(s)` : ''}.\n`,
  );
}
