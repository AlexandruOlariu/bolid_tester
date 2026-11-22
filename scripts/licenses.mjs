#!/usr/bin/env node
/** Third-party notices (plan 30): walk the **production** dependency tree from package.json
 *  (`dependencies` + installed `optionalDependencies`, recursively, resolved the way Node resolves
 *  them) and write
 *
 *    - docs/third-party-licenses.md                         — the published notices
 *    - src/features/settings/model/thirdPartyLicenses.json  — the same data for Settings → About →
 *                                                             Licences (`/licenses`)
 *
 *    node scripts/licenses.mjs            # regenerate both files (npm run licenses)
 *    node scripts/licenses.mjs --stdout   # print the JSON instead of writing
 *
 *  Run it after adding, removing or upgrading a dependency; `thirdPartyLicenses.test.ts` fails when
 *  a direct dependency is missing from the JSON. Packages that declare `os` / `cpu` (prebuilt
 *  native binaries for one platform, e.g. `lightningcss-win32-x64-msvc`) are left out so the output
 *  is the same on Windows, macOS and Linux; devDependencies are never included. License texts are
 *  stored once per distinct text (copyright lines removed) and each package keeps its own copyright
 *  lines, so the notices stay complete without repeating the MIT text hundreds of times.
 *  No network access: everything is read from node_modules. */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_MD = join(ROOT, 'docs', 'third-party-licenses.md');
const OUT_JSON = join(ROOT, 'src', 'features', 'settings', 'model', 'thirdPartyLicenses.json');

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

/** Packages whose package.json declares no licence although their repository does. Each entry is
 *  checked against the upstream repository's LICENSE; `textFrom` borrows the standard text of
 *  another package with the same licence. */
const OVERRIDES = [
  {
    // Tamagui's sub-packages ship without a `license` field or LICENSE file; the monorepo
    // (github.com/tamagui/tamagui) is MIT.
    match: (name) => name === 'tamagui' || name.startsWith('@tamagui/'),
    license: 'MIT',
    copyright: ['Copyright (c) Nate Wienert (Tamagui, github.com/tamagui/tamagui)'],
    textFrom: 'react',
  },
];

/** The directory of `name` as seen from `fromDir` (Node's node_modules lookup), or null. */
function resolvePackage(name, fromDir) {
  let dir = fromDir;
  for (;;) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    if (dir === ROOT) return null;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function licenseOf(pkg) {
  if (typeof pkg.license === 'string') return pkg.license;
  if (pkg.license && typeof pkg.license.type === 'string') return pkg.license.type;
  if (Array.isArray(pkg.licenses)) {
    const types = pkg.licenses.map((l) => (typeof l === 'string' ? l : l?.type)).filter(Boolean);
    if (types.length > 0) return types.length === 1 ? types[0] : `(${types.join(' OR ')})`;
  }
  return 'UNKNOWN';
}

function repositoryOf(pkg) {
  const repo = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  if (typeof repo !== 'string' || repo.length === 0) {
    return typeof pkg.homepage === 'string' ? pkg.homepage : null;
  }
  return repo
    .replace(/^git\+/, '')
    .replace(/^git:\/\//, 'https://')
    .replace(/^ssh:\/\/git@/, 'https://')
    .replace(/^git@github\.com:/, 'https://github.com/')
    .replace(/^github:/, 'https://github.com/')
    .replace(/\.git$/, '')
    .replace(/^([\w-]+\/[\w.-]+)$/, 'https://github.com/$1');
}

const LICENSE_FILE = /^(licen[cs]e|copying)([.-](md|txt|markdown|bsd|mit|apache))?$/i;

function licenseTextOf(dir) {
  const file = readdirSync(dir).find((f) => LICENSE_FILE.test(f));
  return file ? readFileSync(join(dir, file), 'utf8').replace(/\r\n?/g, '\n').trim() : null;
}

const COPYRIGHT_LINE = /^\s*(copyright\b|\(c\)\s|©)/i;

/** A licence file's copyright lines, and the rest of the text with them removed. */
function splitCopyright(text) {
  const copyright = [];
  const body = [];
  for (const line of text.split('\n')) {
    if (COPYRIGHT_LINE.test(line) && line.length < 300) copyright.push(line.trim());
    else body.push(line);
  }
  return {
    copyright,
    body: body
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
  };
}

function authorOf(pkg) {
  const a = pkg.author;
  if (typeof a === 'string')
    return a
      .replace(/\s*<[^>]*>/, '')
      .replace(/\s*\([^)]*\)/, '')
      .trim();
  if (a && typeof a.name === 'string') return a.name;
  return null;
}

function collect() {
  const rootPkg = readJson(join(ROOT, 'package.json'));
  const seen = new Map(); // "name@version" -> { pkg, text }
  const visitedDirs = new Set();
  const queue = Object.keys(rootPkg.dependencies ?? {}).map((name) => ({
    name,
    from: ROOT,
    optional: false,
  }));
  while (queue.length > 0) {
    const { name, from, optional } = queue.shift();
    const dir = resolvePackage(name, from);
    if (!dir) {
      if (optional) continue;
      throw new Error(
        `${name} (needed by ${relative(ROOT, from) || 'package.json'}) is not installed; run npm install first`,
      );
    }
    if (visitedDirs.has(dir)) continue;
    visitedDirs.add(dir);
    const pkg = readJson(join(dir, 'package.json'));
    if (pkg.os || pkg.cpu) continue; // a one-platform prebuilt binary
    const key = `${pkg.name}@${pkg.version}`;
    if (!seen.has(key)) seen.set(key, { pkg, text: licenseTextOf(dir) });
    for (const dep of Object.keys(pkg.dependencies ?? {})) {
      queue.push({ name: dep, from: dir, optional: false });
    }
    for (const dep of Object.keys(pkg.optionalDependencies ?? {})) {
      queue.push({ name: dep, from: dir, optional: true });
    }
  }
  return { rootPkg, entries: [...seen.values()] };
}

function build() {
  const { rootPkg, entries } = collect();
  const texts = {};
  const textIdOf = new Map(); // package name -> text id, for OVERRIDES.textFrom
  const packages = entries
    .map(({ pkg, text }) => {
      let textId = null;
      let copyright = [];
      if (text) {
        const split = splitCopyright(text);
        copyright = split.copyright;
        if (split.body.length > 0) {
          textId = createHash('sha256').update(split.body).digest('hex').slice(0, 12);
          texts[textId] = split.body;
        }
      }
      const author = authorOf(pkg);
      if (copyright.length === 0 && author) copyright = [`Copyright (c) ${author}`];
      if (textId) textIdOf.set(pkg.name, textId);
      const override =
        licenseOf(pkg) === 'UNKNOWN' ? OVERRIDES.find((o) => o.match(pkg.name)) : null;
      if (override) {
        if (copyright.length === 0) copyright = override.copyright;
        return {
          name: pkg.name,
          version: pkg.version,
          license: override.license,
          repository: repositoryOf(pkg),
          copyright,
          text: textId,
          textFrom: override.textFrom,
        };
      }
      return {
        name: pkg.name,
        version: pkg.version,
        license: licenseOf(pkg),
        repository: repositoryOf(pkg),
        copyright: [...new Set(copyright)],
        text: textId,
      };
    })
    .map(({ textFrom, ...p }) =>
      textFrom && !p.text ? { ...p, text: textIdOf.get(textFrom) ?? null } : p,
    )
    .sort((a, b) => a.name.localeCompare(b.name, 'en') || a.version.localeCompare(b.version, 'en'));
  const unknown = packages.filter((p) => p.license === 'UNKNOWN');
  if (unknown.length > 0) {
    throw new Error(
      `no licence declared by: ${unknown.map((p) => `${p.name}@${p.version}`).join(', ')}. ` +
        'Check the upstream repository and add an entry to OVERRIDES in scripts/licenses.mjs.',
    );
  }
  const sortedTexts = Object.fromEntries(
    Object.keys(texts)
      .sort()
      .map((id) => [id, texts[id]]),
  );
  return {
    schema: 'bolid.licenses.v1',
    app: rootPkg.name,
    direct: Object.keys(rootPkg.dependencies ?? {}).sort(),
    packages,
    texts: sortedTexts,
  };
}

function byLicence(data) {
  const counts = new Map();
  for (const p of data.packages) counts.set(p.license, (counts.get(p.license) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'en'));
}

const cell = (s) => s.replace(/\|/g, '\\|');

function renderMarkdown(data) {
  const lines = [
    '# Third-party licences',
    '',
    '<!-- Generated by `npm run licenses` (scripts/licenses.mjs) from node_modules. Do not edit by hand. -->',
    '',
    'Bolid Tester is MIT-licensed ([LICENSE](../LICENSE)). It is built on the open-source packages',
    `below: the production dependency tree of \`package.json\` (${data.packages.length} packages;`,
    'development tools are not included). The app shows the same list under **Settings → About →',
    'Licences**.',
    '',
    '## By licence',
    '',
    '| Licence | Packages |',
    '| ------- | -------- |',
    ...byLicence(data).map(([license, n]) => `| ${cell(license)} | ${n} |`),
    '',
    '## Packages',
    '',
    '| Package | Version | Licence | Copyright | Text |',
    '| ------- | ------- | ------- | --------- | ---- |',
    ...data.packages.map((p) => {
      const name = p.repository ? `[${p.name}](${p.repository})` : p.name;
      const copy = cell(p.copyright.join('; ')) || '—';
      const text = p.text ? `[${p.text}](#text-${p.text})` : '—';
      return `| ${name} | ${p.version} | ${cell(p.license)} | ${copy} | ${text} |`;
    }),
    '',
    '## Licence texts',
    '',
    'Each text applies to the packages that link to it above, together with their copyright lines.',
    '',
  ];
  for (const [id, text] of Object.entries(data.texts)) {
    lines.push(`### Text ${id}`, '', '```text', text, '```', '');
  }
  return lines.join('\n');
}

const data = build();
if (process.argv.includes('--stdout')) {
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
} else {
  writeFileSync(OUT_JSON, `${JSON.stringify(data)}\n`);
  writeFileSync(OUT_MD, renderMarkdown(data));
  const size = Math.round(readFileSync(OUT_JSON).length / 1024);
  console.log(
    `licenses: ${data.packages.length} packages, ${Object.keys(data.texts).length} distinct texts -> ` +
      `${relative(ROOT, OUT_MD)}, ${relative(ROOT, OUT_JSON)} (${size} KB)`,
  );
}
