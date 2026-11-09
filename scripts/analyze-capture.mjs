#!/usr/bin/env node
/** Capture analyzer CLI (plan 25): turn a sniffer CSV (docs/captures/README.md) into a Markdown (or
 *  JSON) report — ISO-TP reassembly, UDS / KWP decoding, request fingerprints, a TP2.0 summary.
 *
 *    node scripts/analyze-capture.mjs <capture.csv> [--around <t_ms> --window <ms>] [--id 7E0]
 *                                     [--json] [--all-ids] [--expect <text>]
 *
 *  --around / --window  keep requests within ±window ms (default 5000) of t_ms
 *  --id                 keep pairs whose request or response is on this CAN id
 *  --json               print the report as JSON instead of Markdown
 *  --all-ids            also treat non-diagnostic ids (below 0x600) as ISO-TP
 *  --expect <text>      exit 1 unless the output contains <text> (the CI smoke uses this)
 *  --quiet              print nothing (useful with --expect)
 *
 *  It imports the analyzer's TypeScript source directly: the module has no imports and only
 *  erasable types, so Node's built-in type stripping runs it (Node >= 22.18 / 24 / 25). */
import { readFileSync } from 'node:fs';

// The repo's package.json has no "type": "module" (the app is CommonJS-bundled), so Node warns
// that the .ts module "is not specified" before re-parsing it as ESM. That notice is noise here;
// every other warning is still printed.
process.removeAllListeners('warning');
process.on('warning', (w) => {
  if (w.code === 'MODULE_TYPELESS_PACKAGE_JSON') return;
  process.stderr.write(`${w.name}: ${w.message}
`);
});
const { analyzeCapture, parseCaptureCsv, renderReportMarkdown } =
  await import('../src/shared/obd-core/analysis/captureAnalyzer.ts');

const USAGE =
  'usage: node scripts/analyze-capture.mjs <capture.csv> [--around <t_ms> --window <ms>] [--id 7E0] [--json] [--all-ids] [--expect <text>] [--quiet]';

function fail(message, code = 2) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

const args = process.argv.slice(2);
const opts = {};
let file = null;
let json = false;
let expectText = null;
let quiet = false;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  const value = () => {
    const v = args[++i];
    if (v === undefined) fail(`${a} needs a value\n${USAGE}`);
    return v;
  };
  const number = () => {
    const v = Number(value());
    if (!Number.isFinite(v)) fail(`${a} needs a number\n${USAGE}`);
    return v;
  };
  if (a === '--around') opts.aroundMs = number();
  else if (a === '--window') opts.windowMs = number();
  else if (a === '--id') opts.onlyId = value();
  else if (a === '--json') json = true;
  else if (a === '--all-ids') opts.allIds = true;
  else if (a === '--expect') expectText = value();
  else if (a === '--quiet') quiet = true;
  else if (a === '--help' || a === '-h') {
    process.stdout.write(`${USAGE}\n`);
    process.exit(0);
  } else if (a.startsWith('--')) fail(`unknown option ${a}\n${USAGE}`);
  else if (file === null) file = a;
  else fail(`one capture file at a time\n${USAGE}`);
}
if (file === null) fail(USAGE);

let text;
try {
  text = readFileSync(file, 'utf8');
} catch (e) {
  fail(`cannot read ${file}: ${e instanceof Error ? e.message : String(e)}`);
}

const report = analyzeCapture(parseCaptureCsv(text), opts);
const output = json ? `${JSON.stringify(report, null, 2)}\n` : renderReportMarkdown(report);
if (!quiet) process.stdout.write(output);
if (expectText !== null && !output.includes(expectText)) {
  fail(`expected the report to contain "${expectText}"`, 1);
}
