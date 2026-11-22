#!/usr/bin/env node
/** Community contribution validator (plan 33). Checks the data a contribution PR can touch and
 *  exits 1 with a grouped report when something is wrong:
 *
 *    node scripts/validate-contrib.mjs [--root <dir>]      (npm run validate:contrib)
 *
 *  1. Vehicle docs      docs/vehicles/*.md — front-matter keys, id = file name, known protocol,
 *                       the "Validated on the car" rules.
 *  2. Replay fixtures   src/shared/obd-core/transport/fixtures/<id>/*.json — parses, `pairs`,
 *                       `meta.vehicleId` names a vehicle, `meta.flow`, at most 200 KB.
 *  3. Label packs       src/shared/labels/packs/*.ts — ids unique, prefixes not claimed twice,
 *                       DID keys, names, groups, every pack registered in LABEL_PACKS.
 *  4. DTC database      src/shared/obd-core/obd/dtcDatabase/<family>/*.ts — keys, no code in two
 *                       files, no empty text, a `License:` line in each header (skipped when the
 *                       directory does not exist).
 *  5. Sniffer captures  docs/captures/**\/*.csv — the header names a registry vehicle.
 *  6. Licence hygiene   profiles, packs and DTC tables never take data from GPL / python-OBD.
 *
 *  --root <dir>  check another checkout (the tests point it at a temp copy). The rules themselves
 *                always come from this repository's src/shared/lib/contribChecks.ts.
 *
 *  The TypeScript data files are transpiled in memory with the `typescript` devDependency
 *  (`ts.transpileModule`, no type check — `npm run typecheck:app` does that) and evaluated in this
 *  process. DTC tables and packs are evaluated one file at a time with their relative imports
 *  stubbed, so a composed family (P0 = the four parts) is never counted twice. No other deps. */
import { createRequire } from 'node:module';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const Module = require('node:module');
const ts = require('typescript');

const SCRIPT_REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = 'usage: node scripts/validate-contrib.mjs [--root <dir>]';

let root = SCRIPT_REPO;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--root' && args[i + 1] !== undefined) root = resolve(args[++i]);
  else {
    process.stderr.write(`unknown argument ${args[i]}\n${USAGE}\n`);
    process.exit(2);
  }
}
if (!existsSync(root)) {
  process.stderr.write(`root not found: ${root}\n`);
  process.exit(2);
}

// --- TypeScript loading ---------------------------------------------------------------------------

const compilerOptions = {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2020,
  esModuleInterop: true,
  sourceMap: false,
};
const transpile = (file) =>
  ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions, fileName: file }).outputText;

// `require('<file>.ts')` and extensionless relative imports between .ts files (like run-ts.cjs).
if (!Module._extensions['.ts']) {
  Module._extensions['.ts'] = function compileTs(module, filename) {
    module._compile(transpile(filename), filename);
  };
}

/** Evaluate one .ts file on its own: relative imports resolve to `{}`, so only the values the
 *  file itself defines are real. */
function evalIsolated(file) {
  const module = { exports: {} };
  const stubRequire = (spec) => (spec.startsWith('.') ? {} : require(spec));
  const wrapper = vm.runInThisContext(
    `(function (exports, require, module, __filename, __dirname) {${transpile(file)}\n})`,
    { filename: file },
  );
  wrapper(module.exports, stubRequire, module, file, dirname(file));
  return module.exports;
}

const exportsOf = (mod) => Object.entries(mod).filter(([name]) => name !== '__esModule');
const isRecord = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

const checks = require(join(SCRIPT_REPO, 'src', 'shared', 'lib', 'contribChecks.ts'));

// --- Helpers --------------------------------------------------------------------------------------

const rel = (abs) => relative(root, abs).split('\\').join('/');
const at = (...parts) => join(root, ...parts);
const listFiles = (dir, test) =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => statSync(join(dir, f)).isFile() && test(f))
        .sort()
        .map((f) => join(dir, f))
    : [];
const listDirs = (dir) =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => statSync(join(dir, f)).isDirectory())
        .sort()
        .map((f) => join(dir, f))
    : [];
function walk(dir, test) {
  const out = listFiles(dir, test);
  for (const sub of listDirs(dir)) out.push(...walk(sub, test));
  return out;
}
const isTsSource = (f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.endsWith('.d.ts');

const problems = [];
const checked = new Set();
const record = (file, found) => {
  checked.add(file);
  problems.push(...found);
};
const fail = (area, file, message) => record(file, [{ area, level: 'error', file, message }]);

// --- 1. Vehicle docs -------------------------------------------------------------------------------

let protocolIds = [];
const protocolsFile = at('src', 'shared', 'obd-core', 'obd', 'protocols.ts');
if (existsSync(protocolsFile)) {
  protocolIds = Object.keys(evalIsolated(protocolsFile).PROTOCOL_LABELS ?? {});
} else {
  fail('vehicle-docs', rel(protocolsFile), 'not found (the list of known protocols)');
}

const vehicleDocs = listFiles(
  at('docs', 'vehicles'),
  (f) => f.endsWith('.md') && f !== 'README.md',
);
const docIds = vehicleDocs.map((f) => f.split(/[\\/]/).pop().replace(/\.md$/, ''));
// `generic` is the built-in profile: it has fixtures but no doc.
const knownVehicleIds = [...docIds, 'generic'];

// --- 2. Replay fixtures (read first: the vehicle docs need the car fixtures) ----------------------

const fixturesDir = at('src', 'shared', 'obd-core', 'transport', 'fixtures');
const carFixtures = new Map();
for (const file of walk(fixturesDir, (f) => f.endsWith('.json'))) {
  const r = relative(fixturesDir, file).split('\\').join('/');
  const text = readFileSync(file, 'utf8');
  record(
    rel(file),
    checks
      .checkFixtureFile(r, text, statSync(file).size, knownVehicleIds)
      .map((p) => ({ ...p, file: rel(file) })),
  );
  try {
    const fx = JSON.parse(text);
    if (fx?.meta?.source === 'car') {
      const dir = r.split('/')[0];
      carFixtures.set(dir, [...(carFixtures.get(dir) ?? []), r.split('/').pop()]);
    }
  } catch {
    // reported by checkFixtureFile
  }
}

vehicleDocs.forEach((file, i) => {
  const md = readFileSync(file, 'utf8');
  record(
    rel(file),
    checks.checkVehicleDoc(rel(file), md, protocolIds, carFixtures.get(docIds[i]) ?? []),
  );
});

// --- 3. Label packs -------------------------------------------------------------------------------

const packFiles = listFiles(at('src', 'shared', 'labels', 'packs'), isTsSource);
const packs = [];
for (const file of packFiles) {
  checked.add(rel(file));
  try {
    for (const [, value] of exportsOf(evalIsolated(file))) {
      if (isRecord(value) && ('partNumberPrefixes' in value || 'module' in value)) {
        packs.push({ file: rel(file), pack: value });
      }
    }
  } catch (e) {
    fail('label-packs', rel(file), `could not be evaluated (${e.message})`);
  }
}
let registeredIds = [];
const registryFile = at('src', 'shared', 'labels', 'registry.ts');
if (existsSync(registryFile)) {
  try {
    registeredIds = (require(registryFile).LABEL_PACKS ?? []).map((p) => p.id);
  } catch (e) {
    fail('label-packs', rel(registryFile), `could not be evaluated (${e.message})`);
  }
}
problems.push(...checks.checkLabelPacks(packs, registeredIds));

// --- 4. DTC database ------------------------------------------------------------------------------

const dtcDir = at('src', 'shared', 'obd-core', 'obd', 'dtcDatabase');
const dtcFiles = listDirs(dtcDir).flatMap((d) => listFiles(d, isTsSource));
const dtcTables = [];
for (const file of dtcFiles) {
  const source = readFileSync(file, 'utf8');
  const found = [...checks.checkDtcFileHeader(rel(file), source)];
  for (const key of checks.duplicateKeysInSource(source)) {
    found.push({
      area: 'dtc-database',
      level: 'error',
      file: rel(file),
      message: `${key} is listed twice in this file`,
    });
  }
  record(rel(file), found);
  try {
    for (const [name, value] of exportsOf(evalIsolated(file))) {
      if (isRecord(value) && Object.values(value).every((v) => typeof v === 'string')) {
        dtcTables.push({ file: rel(file), exportName: name, table: value });
      }
    }
  } catch (e) {
    fail('dtc-database', rel(file), `could not be evaluated (${e.message})`);
  }
}
problems.push(...checks.checkDtcTables(dtcTables));

// --- 5. Sniffer captures --------------------------------------------------------------------------

for (const file of walk(at('docs', 'captures'), (f) => f.toLowerCase().endsWith('.csv'))) {
  record(rel(file), checks.checkCapture(rel(file), readFileSync(file, 'utf8'), docIds));
}

// --- 6. Licence hygiene ---------------------------------------------------------------------------

const profileFiles = listFiles(at('src', 'shared', 'vehicles'), isTsSource);
for (const file of [...profileFiles, ...packFiles, ...dtcFiles]) {
  record(rel(file), checks.checkLicenceHygiene(rel(file), readFileSync(file, 'utf8')));
}

// --- Report ---------------------------------------------------------------------------------------

const report = checks.formatContribReport(problems, checked.size);
if (checks.hasContribErrors(problems)) {
  process.stderr.write(report);
  process.exit(1);
}
process.stdout.write(report);
