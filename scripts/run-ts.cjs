#!/usr/bin/env node
/** Minimal TypeScript runner for repo scripts, built on the `typescript` devDependency (no tsx /
 *  ts-node needed): every `.ts` file required from here on is transpiled to CommonJS in memory with
 *  `ts.transpileModule` (no type check — `npm run typecheck` does that) and extensionless relative
 *  imports resolve to `.ts`, like the core's own imports. Usage: `node scripts/run-ts.cjs <file.ts>
 *  [args…]`. Used by `npm run fixtures:sim` (scripts/record-sim-fixtures.ts). */
const fs = require('fs');
const path = require('path');
const Module = require('module');
const ts = require('typescript');

const compilerOptions = {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2020,
  esModuleInterop: true,
  resolveJsonModule: true,
  sourceMap: false,
};

Module._extensions['.ts'] = function compileTs(module, filename) {
  const source = fs.readFileSync(filename, 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions, fileName: filename });
  module._compile(outputText, filename);
};

const [, , entry, ...rest] = process.argv;
if (!entry) {
  console.error('usage: node scripts/run-ts.cjs <file.ts> [args...]');
  process.exit(2);
}
const target = path.resolve(entry);
process.argv = [process.argv[0], target, ...rest];
require(target);
